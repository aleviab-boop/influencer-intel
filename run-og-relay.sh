#!/usr/bin/env bash
# ============================================================
# og: proxy runner — the FREE way to make the profile drawer work on prod.
#
# Instagram serves the public og: preview data (follower/post counts, name, pic,
# per-post likes/comments) only to residential IPs, so it comes back blank from
# Vercel. This runs a tiny home-IP proxy (tools/og-relay.mjs) that forwards ONLY
# the og: profile/post PAGE fetch — never the throttled API, never a cookie — and
# exposes it via a free Cloudflare tunnel. The tunnel URL is written to the DB
# (system_config.og_proxy_url) so the deployed drawer self-updates with no Vercel
# edit or redeploy.
#
# SAFE vs the old relay: this can ONLY hit un-throttled link-preview pages and
# strips cookies, so it can never rate-limit your accounts or your IP.
#
# Usage:   ./run-og-relay.sh      (from the influencer-intel folder)
# Stop:    Ctrl+C   (no launchd; the supervisor loop only self-heals the tunnel/
#          proxy WHILE this stays running — it does not respawn after you quit)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

OG_PORT=8788
# Key is OPTIONAL. Left unset by default so this works with ZERO Vercel config —
# the tunnel URL self-publishes to the DB and the drawer picks it up in ~60s. The
# proxy is already locked to IG profile/post pages + strips cookies, and the
# tunnel URL is random, so open is low-risk. To lock it down: set OG_RELAY_KEY
# here AND the SAME value as IG_OG_RELAY_KEY in Vercel.
OG_RELAY_KEY="${OG_RELAY_KEY:-}"
export OG_PORT OG_RELAY_KEY

if [ -n "$OG_RELAY_KEY" ]; then
  echo "[og-relay] locked with OG_RELAY_KEY — set IG_OG_RELAY_KEY=$OG_RELAY_KEY in Vercel"
else
  echo "[og-relay] running open (no key) — zero Vercel config needed"
fi

# Keep the Mac awake so the tunnel never drops mid-session.
exec caffeinate -i bash -c '
  CF_PID=""
  TUNNEL_URL=""
  cleanup() { echo "[og-relay] stopping…"; kill "$PROXY_PID" 2>/dev/null || true; kill "$CF_PID" 2>/dev/null || true; pkill -f "cloudflared tunnel .*localhost:'"$OG_PORT"'" 2>/dev/null || true; exit 0; }
  trap cleanup INT TERM

  # start the proxy if not already listening
  if ! curl -s -m2 "http://localhost:'"$OG_PORT"'" >/dev/null 2>&1; then
    echo "[og-relay] starting og proxy on :'"$OG_PORT"'…"
    node tools/og-relay.mjs >> /tmp/og-relay.log 2>&1 &
    PROXY_PID=$!
    sleep 2
  fi

  # (start_tunnel) (re)launch cloudflared in the BACKGROUND and publish the fresh
  # public URL to the DB. Deliberately NOT a blocking foreground `| while read`
  # pipe: cloudflared can sit alive-but-registered while the edge silently drops
  # (hostname goes NXDOMAIN / HTTP 000 / 530), producing NO further log lines — a
  # foreground pipe just blocks there forever on the dead URL and never republishes.
  # Backgrounding it lets the supervisor loop below health-check the LIVE url and
  # cycle the tunnel when the edge dies. --protocol http2: default QUIC is flaky on
  # this network and silently drops.
  start_tunnel() {
    pkill -f "cloudflared tunnel .*localhost:'"$OG_PORT"'" 2>/dev/null || true
    sleep 1
    echo "[og-relay] starting cloudflare tunnel ($(date "+%F %T"))…"
    : > /tmp/og-cf.log
    cloudflared tunnel --protocol http2 --url "http://localhost:'"$OG_PORT"'" >> /tmp/og-cf.log 2>&1 &
    CF_PID=$!
    TUNNEL_URL=""
    for _ in $(seq 1 30); do
      TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/og-cf.log | grep -v "://api\." | head -1)
      [ -n "$TUNNEL_URL" ] && break
      sleep 1
    done
    if [ -n "$TUNNEL_URL" ]; then
      node scripts/set-og-proxy-url.mjs "$TUNNEL_URL" >> /tmp/og-proxy-url-write.log 2>&1 \
        && echo "[og-relay] og_proxy_url -> $TUNNEL_URL  (drawer self-updates in ~60s)"
    else
      echo "[og-relay] tunnel produced no URL in 30s — will retry next tick"
    fi
  }

  start_tunnel

  # ONE supervisor loop. Health-checks the PUBLISHED url end-to-end every 30s:
  # cloudflared process-liveness alone never catches a dead edge, so we curl the
  # real URL and cycle on any non-2xx/3xx (curl -f) or NXDOMAIN (000). Also revives
  # the proxy itself if it dies.
  while true; do
    sleep 30

    # catch a late URL if cloudflared was slow to print its banner
    if [ -z "$TUNNEL_URL" ] && kill -0 "$CF_PID" 2>/dev/null; then
      TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/og-cf.log | grep -v "://api\." | head -1)
      if [ -n "$TUNNEL_URL" ]; then
        node scripts/set-og-proxy-url.mjs "$TUNNEL_URL" >> /tmp/og-proxy-url-write.log 2>&1 \
          && echo "[og-relay] og_proxy_url (late) -> $TUNNEL_URL"
      fi
    fi

    # (1) tunnel health: process dead OR published URL failing → full restart
    if ! kill -0 "$CF_PID" 2>/dev/null; then
      echo "[og-relay] cloudflared exited — restarting"
      start_tunnel
    elif [ -n "$TUNNEL_URL" ] && ! curl -sf -m10 "$TUNNEL_URL" >/dev/null 2>&1; then
      echo "[og-relay] URL $TUNNEL_URL failed health-check (HTTP 000 / 530 / NXDOMAIN) — cycling cloudflared"
      start_tunnel
    fi

    # (2) proxy health: revive :'"$OG_PORT"' if it died
    if ! curl -s -m3 "http://localhost:'"$OG_PORT"'" >/dev/null 2>&1; then
      echo "[og-relay] og proxy down — restarting on :'"$OG_PORT"'…"
      node tools/og-relay.mjs >> /tmp/og-relay.log 2>&1 &
      PROXY_PID=$!
      sleep 2
    fi
  done
'

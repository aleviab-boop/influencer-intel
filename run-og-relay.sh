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
# Stop:    Ctrl+C   (nothing auto-respawns — no launchd, unlike the old relay)
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
  cleanup() { echo "[og-relay] stopping…"; kill "$PROXY_PID" 2>/dev/null || true; pkill -f "cloudflared tunnel .*localhost:'"$OG_PORT"'" 2>/dev/null || true; exit 0; }
  trap cleanup INT TERM

  # 1) start the proxy if not already listening
  if ! curl -s -m2 "http://localhost:'"$OG_PORT"'" >/dev/null 2>&1; then
    echo "[og-relay] starting og proxy on :'"$OG_PORT"'…"
    node tools/og-relay.mjs >> /tmp/og-relay.log 2>&1 &
    PROXY_PID=$!
    sleep 2
  fi

  # 2) drop any stale tunnel on this port so we supervise exactly one
  pkill -f "cloudflared tunnel .*localhost:'"$OG_PORT"'" 2>/dev/null || true
  sleep 1

  # 3) run the tunnel in the foreground; capture + publish the fresh URL.
  #    --protocol http2: default QUIC is flaky on this network and silently drops.
  while true; do
    echo "[og-relay] starting cloudflare tunnel ($(date "+%F %T"))…"
    cloudflared tunnel --protocol http2 --url "http://localhost:'"$OG_PORT"'" 2>&1 | while IFS= read -r line; do
      echo "$line"
      case "$line" in
        *trycloudflare.com*)
          url=$(echo "$line" | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" | grep -v "://api\." | head -1)
          if [ -n "$url" ]; then
            node scripts/set-og-proxy-url.mjs "$url" >> /tmp/og-proxy-url-write.log 2>&1 \
              && echo "[og-relay] og_proxy_url -> $url  (drawer self-updates in ~60s)"
          fi
          ;;
      esac
    done
    echo "[og-relay] tunnel exited — restarting in 5s…"
    sleep 5
  done
'

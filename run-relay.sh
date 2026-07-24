#!/usr/bin/env bash
# ============================================================
# Relay + tunnel keeper — run this from Terminal (NOT launchd).
#
# launchd can't run scripts in ~/Downloads on a managed Mac (TCC blocks it), so
# this is the Terminal-run equivalent. It:
#   - keeps the Mac awake (caffeinate -i) so it never sleeps mid-crawl
#   - starts the IG relay on :8787 if it isn't already up
#   - runs the Cloudflare tunnel and AUTO-RESTARTS it whenever it drops
#   - writes each fresh tunnel URL to the DB (system_config.relay_url) so the
#     deployed platform picks it up in ~60s — no Vercel edit, no redeploy
#
# Usage:  ./run-relay.sh    (leave it running in its own Terminal tab)
# Stop:   Ctrl+C
# ============================================================
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
RELAY_KEY="ii-relay-7k2m9x"
REPO="$PWD"

exec caffeinate -i bash -c '
  cd "'"$REPO"'" || exit 1
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

  # start the relay if it is not already listening on :8787
  if ! curl -s -m3 http://localhost:8787 >/dev/null 2>&1; then
    echo "[relay] starting relay on :8787…"
    RELAY_KEY="'"$RELAY_KEY"'" node tools/ig-relay.mjs >> /tmp/ig-relay.log 2>&1 &
    sleep 2
  fi

  # (start_tunnel) (re)launch cloudflared in the BACKGROUND and publish the fresh
  # public URL to the DB. Kept as a function so the single supervisor loop below
  # can cycle the tunnel on demand.
  #
  # --protocol http2: the default QUIC transport registers the tunnel and passes
  # prechecks, then the edge silently terminates the datagram session
  # ("Application error 0x0 (remote)"), so the hostname never serves publicly.
  # HTTP/2 is stable on this network and serves 200 immediately.
  start_tunnel() {
    pkill -f "cloudflared tunnel --url http://localhost:8787" 2>/dev/null; sleep 1
    echo "[relay] starting tunnel ($(date "+%H:%M:%S"))…"
    : > /tmp/ig-cf.log
    cloudflared tunnel --url http://localhost:8787 --protocol http2 >> /tmp/ig-cf.log 2>&1 &
    CF_PID=$!
    TUNNEL_URL=""
    for _ in $(seq 1 30); do
      TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/ig-cf.log | head -1)
      [ -n "$TUNNEL_URL" ] && break
      sleep 1
    done
    if [ -n "$TUNNEL_URL" ]; then
      echo "$TUNNEL_URL" > /tmp/ig-tunnel-url.txt
      node scripts/set-relay-url.mjs "$TUNNEL_URL" >> /tmp/relay-url-write.log 2>&1
      echo "[relay] URL -> $TUNNEL_URL  (written to DB; platform self-updates in ~60s)"
    else
      echo "[relay] tunnel produced no URL in 30s — will retry next tick"
    fi
  }

  # ONE foreground supervisor loop drives everything (health-check + monitor +
  # enrich). It is deliberately NOT a set of detached `( … ) &` subshells: under a
  # non-interactive launch (nohup/launchd) those get orphaned and silently die, so
  # the tunnel could sit stalled at HTTP 530 with nothing left to cycle it. A single
  # foreground loop survives any launch method.
  start_tunnel
  tick=0
  while true; do
    sleep 30
    tick=$((tick + 1))

    # Catch a late URL if cloudflared was slow to print its banner.
    if [ -z "$TUNNEL_URL" ] && kill -0 "$CF_PID" 2>/dev/null; then
      TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/ig-cf.log | head -1)
      if [ -n "$TUNNEL_URL" ]; then
        echo "$TUNNEL_URL" > /tmp/ig-tunnel-url.txt
        node scripts/set-relay-url.mjs "$TUNNEL_URL" >> /tmp/relay-url-write.log 2>&1
        echo "[relay] URL (late) -> $TUNNEL_URL"
      fi
    fi

    # (1) Health-check the PUBLISHED URL end-to-end every 30s. cloudflared can sit
    # "Registered" while the edge returns HTTP 530 (origin unreachable) or the
    # hostname goes NXDOMAIN — process-liveness alone never catches that. curl -f
    # fails on any non-2xx/3xx (and 000 on NXDOMAIN), forcing a full restart.
    if ! kill -0 "$CF_PID" 2>/dev/null; then
      echo "[relay] cloudflared exited — restarting"
      start_tunnel
    elif [ -n "$TUNNEL_URL" ] && ! curl -sf -m10 "$TUNNEL_URL" >/dev/null 2>&1; then
      echo "[relay] URL $TUNNEL_URL failed health-check (HTTP 530 / NXDOMAIN) — cycling cloudflared"
      start_tunnel
    fi

    # (2) Every ~2 min: operational monitor (Slack alerts) + background stub
    # enrichment. Both self-gate/self-dedup, so this is the trigger regardless of
    # Vercel cron plan limits. Enrichment pauses itself when fewer than 2 accounts
    # are healthy and backs off on any throttle.
    if [ $((tick % 4)) -eq 0 ]; then
      curl -s -m20 "https://influencer-intel-platform.vercel.app/api/cron/monitor" >/dev/null 2>&1
      curl -s -m30 "https://influencer-intel-platform.vercel.app/api/cron/enrich"  >/dev/null 2>&1
    fi
  done
'

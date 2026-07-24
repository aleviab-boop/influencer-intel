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

  # Every 5 min while this keeper runs: (1) the operational monitor (Slack alerts),
  # and (2) background stub-enrichment — both self-gate/self-dedup, so this is the
  # trigger regardless of Vercel cron plan limits. Enrichment pauses itself when
  # fewer than 2 accounts are healthy and backs off on any throttle.
  ( while true; do
      curl -s -m20 "https://influencer-intel-platform.vercel.app/api/cron/monitor" >/dev/null 2>&1
      curl -s -m30 "https://influencer-intel-platform.vercel.app/api/cron/enrich"  >/dev/null 2>&1
      sleep 120
    done ) &

  # Tunnel URL health-check. A Cloudflare quick-tunnel can lose its public
  # hostname (NXDOMAIN) while the local cloudflared keeps its edge connection
  # open — so the loop below never sees the process exit, never restarts it, and
  # the DB keeps serving a dead URL (prod silently falls back to DB-only). Every
  # 3 min, verify the published URL still resolves/serves; if not, kill
  # cloudflared so the loop regenerates a fresh URL and republishes it.
  ( while true; do
      sleep 180
      url=$(cat /tmp/ig-tunnel-url.txt 2>/dev/null)
      [ -z "$url" ] && continue
      if ! curl -sf -m10 "$url" >/dev/null 2>&1; then
        echo "[relay] tunnel URL $url failed health-check (likely NXDOMAIN) — cycling cloudflared"
        pkill -f "cloudflared tunnel --url http://localhost:8787" 2>/dev/null
      fi
    done ) &

  # keep a tunnel alive; on every (re)start, publish the fresh URL to the DB
  while true; do
    pkill -f "cloudflared tunnel --url http://localhost:8787" 2>/dev/null; sleep 1
    echo "[relay] starting tunnel ($(date "+%H:%M:%S"))…"
    cloudflared tunnel --url http://localhost:8787 2>&1 | while IFS= read -r line; do
      echo "$line"
      case "$line" in
        *trycloudflare.com*)
          url=$(echo "$line" | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" | head -1)
          if [ -n "$url" ]; then
            echo "$url" > /tmp/ig-tunnel-url.txt
            node scripts/set-relay-url.mjs "$url" >> /tmp/relay-url-write.log 2>&1
            echo "[relay] URL -> $url  (written to DB; platform self-updates in ~60s)"
          fi
          ;;
      esac
    done
    echo "[relay] tunnel exited — restarting in 3s… (Ctrl+C to stop)"
    sleep 3
  done
'

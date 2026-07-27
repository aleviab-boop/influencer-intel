#!/usr/bin/env bash
# ============================================================
# Relay + tunnel daemon — supervised by launchd (see
# scripts/com.influencerintel.relay.plist).
#
# Keeps the IG relay (tools/ig-relay.mjs) and a Cloudflare tunnel alive so live
# data flows after a reboot/sleep without anyone restarting anything by hand.
# launchd's KeepAlive relaunches this script whenever it exits — so when the
# quick-tunnel drops (cloudflared exits), the whole thing comes right back.
#
# NOTE: a Cloudflare *quick* tunnel gets a NEW random URL each start, so after a
# restart you must repoint Vercel's IG_RELAY at the fresh URL (printed in the log
# below and echoed to /tmp/ig-tunnel-url.txt). A *named* tunnel (stable URL) is
# the permanent fix — swap the cloudflared line for `cloudflared tunnel run <name>`.
# ============================================================
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="/Users/aleviabandyopadhyay/Downloads/influencer-intel"
RELAY_KEY="ii-relay-7k2m9x"
cd "$REPO" || exit 1

# 1) start the relay if it isn't already listening on :8787
if ! curl -s -m2 http://localhost:8787 >/dev/null 2>&1; then
  echo "[daemon] starting relay on :8787…"
  RELAY_KEY="$RELAY_KEY" node tools/ig-relay.mjs >> /tmp/ig-relay.log 2>&1 &
  sleep 2
fi

# 2) drop any stale tunnel so launchd supervises exactly one
pkill -f "cloudflared tunnel --url http://localhost:8787" 2>/dev/null
sleep 1

# 3) run the tunnel in the foreground. When it dies, this script exits and
#    launchd (KeepAlive) restarts everything. Capture the fresh URL for Vercel.
#    --protocol http2: the default QUIC transport is flaky on this network and
#    silently drops the tunnel (edge then serves HTTP 530 / NXDOMAIN while the
#    worker keeps crawling locally). Forcing http2 keeps the tunnel stable.
echo "[daemon] starting cloudflare tunnel ($(date '+%F %T'))…"
cloudflared tunnel --protocol http2 --url http://localhost:8787 2>&1 | while IFS= read -r line; do
  echo "$line"
  case "$line" in
    *trycloudflare.com*)
      url=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
      if [ -n "$url" ]; then
        echo "$url" > /tmp/ig-tunnel-url.txt
        # Write the fresh URL to the DB so the deployed platform picks it up
        # automatically (cached ~60s) — no Vercel edit, no redeploy needed.
        node scripts/set-relay-url.mjs "$url" >> /tmp/relay-url-write.log 2>&1
        echo "[daemon] tunnel URL -> $url  (written to DB → platform self-updates)"
      fi
      ;;
  esac
done

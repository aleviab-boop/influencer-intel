#!/bin/bash
# Started BY Terminal (which has permission to read ~/Downloads) when the watchdog detects the relay
# keeper has died. Cleans any orphaned cloudflared / stray keepers first so we never stack
# duplicates, then starts exactly ONE keeper.
#
# NOTE: install.sh rewrites the REPO line below to this machine's actual repo path when it copies
# this file to ~/relay-launch.command. The default assumes ~/Downloads/influencer-intel.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$HOME/Downloads/influencer-intel"
cd "$REPO" || exit 1

# Kill any orphaned cloudflared + any stray keeper loops (prevents duplicate-keeper churn).
pkill -9 -x cloudflared 2>/dev/null
for pid in $(ps ax -o pid,command | grep -F 'cloudflared tunnel --url http://localhost:8787' | grep -vE ' cloudflared tunnel|grep' | awk '{print $1}'); do
  kill -9 "$pid" 2>/dev/null
done
sleep 1

exec ./run-relay.sh

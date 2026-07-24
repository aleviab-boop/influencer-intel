#!/bin/bash
# Installs the relay watchdog on THIS machine with correct absolute paths.
#   - copies relay-watchdog.sh          -> ~/relay-watchdog.sh
#   - writes relay-launch.command       -> ~/relay-launch.command   (with this repo's path baked in)
#   - writes the LaunchAgent plist       -> ~/Library/LaunchAgents/com.influencerintel.relaywatch.plist
#   - loads the agent (runs every 120s; restarts the relay keeper if it ever dies)
#
# Safe to re-run (idempotent). Requires Terminal.app to have permission to read ~/Downloads
# (it does if you've ever run ./run-relay.sh from Terminal). Usage:  bash scripts/watchdog/install.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"                # repo root = two levels up from scripts/watchdog
LABEL="com.influencerintel.relaywatch"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "repo:  $REPO"

# 1) watchdog checker (portable as-is)
cp "$HERE/relay-watchdog.sh" "$HOME/relay-watchdog.sh"
chmod +x "$HOME/relay-watchdog.sh"

# 2) launcher, with THIS repo's path baked in
sed "s|^REPO=.*|REPO=\"$REPO\"|" "$HERE/relay-launch.command" > "$HOME/relay-launch.command"
chmod +x "$HOME/relay-launch.command"

# 3) LaunchAgent plist, with the real watchdog path
mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__WATCHDOG_PATH__|$HOME/relay-watchdog.sh|" "$HERE/com.influencerintel.relaywatch.plist" > "$AGENT"

# 4) (re)load
launchctl unload "$AGENT" 2>/dev/null || true
launchctl load "$AGENT"

echo "installed + loaded:"
launchctl list | grep relaywatch || echo "  (warning: not showing in launchctl list)"
echo "done. It checks every 2 min; log at /tmp/relay-watchdog.out.log"
echo "turn off with:  bash $HERE/uninstall.sh"

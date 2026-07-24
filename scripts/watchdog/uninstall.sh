#!/bin/bash
# Removes the relay watchdog (stops the auto-restart; does NOT touch the relay itself).
set -euo pipefail
AGENT="$HOME/Library/LaunchAgents/com.influencerintel.relaywatch.plist"
launchctl unload "$AGENT" 2>/dev/null || true
rm -f "$AGENT" "$HOME/relay-watchdog.sh" "$HOME/relay-launch.command"
echo "watchdog removed. (The relay keeper, if running, keeps running.)"

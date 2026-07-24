#!/bin/bash
# Relay watchdog — run by a LaunchAgent every ~2 min (installed to ~/relay-watchdog.sh).
# Job: make sure the relay KEEPER (run-relay.sh) is alive. If it is, the keeper self-heals the
# cloudflared tunnel on its own, so we do nothing. If the keeper has died (crash / sleep-wake /
# reboot), we relaunch a single fresh one — via Terminal, because macOS TCC blocks launchd from
# reading ~/Downloads directly.
#
# The keeper's process argv contains 'cloudflared tunnel --url http://localhost:8787' (so does the
# cloudflared BINARY). We want the keeper (a bash/caffeinate process), so we match the full argv
# with `pgrep -f` (NOT `ps -o command`, which truncates) and exclude the cloudflared binary by comm.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

keeper_alive() {
  for pid in $(pgrep -f 'cloudflared tunnel --url http://localhost:8787' 2>/dev/null); do
    c=$(ps -p "$pid" -o comm= 2>/dev/null)
    case "$c" in
      *cloudflared*) : ;;   # the tunnel binary itself — not the keeper
      "")            : ;;   # process already gone
      *)             return 0 ;;  # bash / caffeinate keeper loop is alive
    esac
  done
  return 1
}

if keeper_alive; then
  exit 0   # keeper is up — it owns (re)starting the tunnel. Nothing to do.
fi

# Keeper is gone → relaunch one via Terminal (which can read ~/Downloads).
echo "[watchdog $(date '+%F %T')] keeper down -> relaunching via Terminal" >> /tmp/relay-watchdog.out.log
open -a Terminal "$HOME/relay-launch.command"

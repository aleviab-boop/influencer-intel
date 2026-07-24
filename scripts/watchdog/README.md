# Relay watchdog

Auto-restarts the relay keeper (`run-relay.sh`) if it ever dies, so live search stops needing manual
`./run-relay.sh`. macOS `launchd` can't run scripts from `~/Downloads` (TCC), so the watchdog runs a
small checker from `~/` that relaunches the keeper **via Terminal** (which has `~/Downloads` access).

## Install (on any machine)

```bash
bash scripts/watchdog/install.sh
```

This bakes in this machine's repo path and loads the LaunchAgent. It runs every 2 min: if the keeper
is alive it does nothing; if it died it cleans orphans and starts exactly one fresh keeper.

## Controls

```bash
launchctl list | grep relaywatch          # is it on?
cat /tmp/relay-watchdog.out.log            # what has it done? (empty = relay stayed healthy)
bash scripts/watchdog/uninstall.sh         # turn it off
```

## Files it installs (outside the repo)

| Installed to | From | What |
|---|---|---|
| `~/relay-watchdog.sh` | `relay-watchdog.sh` | the 2-min health check |
| `~/relay-launch.command` | `relay-launch.command` (repo path baked in) | Terminal-run launcher |
| `~/Library/LaunchAgents/com.influencerintel.relaywatch.plist` | the `.plist` (watchdog path baked in) | the 2-min schedule |

## Notes

- Terminal.app must be allowed to read `~/Downloads` (it is if you've run `./run-relay.sh` from
  Terminal before). A small Terminal window pops up when it restarts the relay — leave it open.
- After a reboot it starts once you **log in** (LaunchAgents need a login session). For fully
  hands-off across reboots, also enable auto-login.
- Pairs with an **UptimeRobot** ping on `/api/cron/monitor` (every 5 min) for keeper-independent Slack
  alerts — watchdog *fixes* the relay, UptimeRobot *notifies* you.

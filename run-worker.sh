#!/usr/bin/env bash
# ============================================================
# Resilient worker runner.
#
# Run this INSTEAD of `npm run scraper:dev`. It:
#   - keeps the Mac awake while running (caffeinate -i), so it never sleeps
#     mid-crawl and drops the account
#   - runs the NON-watch worker (`scraper:start`), so editing code does NOT
#     hot-reload / bounce the worker the way `scraper:dev` (watch mode) does
#   - auto-restarts the worker if it ever crashes or exits
#
# Usage:   ./run-worker.sh        (from the influencer-intel folder)
# Stop:    Ctrl+C
# ============================================================

cd "$(dirname "$0")" || exit 1

# Load the root .env so the worker's config is reproducible and picks up
# SLACK_WEBHOOK_URL for dead-account alerts. .env is the canonical config, so it
# overrides the shell env. Values are read literally (no shell interpretation),
# so URLs containing ? & = are safe.
if [ -f .env ]; then
  set -a
  while IFS='=' read -r key val; do
    case "$key" in ''|\#*) continue ;; esac
    export "$key=$val"
  done < .env
  set +a
fi

exec caffeinate -i bash -c '
  # Restart backoff. A flat 5s restart turns a *persistent* failure (DNS/DB
  # down, bad config) into a machine-gun: the worker relaunches every 5s and
  # each launch re-hits Instagram’s login endpoint, which is what got the egress
  # IP rate-limited. So: a run that lasted a healthy while resets to 5s, but
  # rapid consecutive crashes back off exponentially (5→10→20…→300s cap).
  delay=5
  max_delay=300
  while true; do
    echo "[run-worker] starting scraper worker ($(date "+%H:%M:%S"))…"
    start=$(date +%s)
    npm run scraper:start
    code=$?
    ran=$(( $(date +%s) - start ))
    if [ "$ran" -ge 60 ]; then
      delay=5   # real session, not a crash-loop → reset backoff
    fi
    echo "[run-worker] worker exited (code $code) after ${ran}s — restarting in ${delay}s… (Ctrl+C to stop)"
    sleep "$delay"
    if [ "$ran" -lt 60 ]; then
      delay=$(( delay * 2 ))
      [ "$delay" -gt "$max_delay" ] && delay=$max_delay
    fi
  done
'

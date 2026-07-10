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
  while true; do
    echo "[run-worker] starting scraper worker ($(date "+%H:%M:%S"))…"
    npm run scraper:start
    code=$?
    echo "[run-worker] worker exited (code $code) — restarting in 5s… (Ctrl+C to stop)"
    sleep 5
  done
'

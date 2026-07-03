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

exec caffeinate -i bash -c '
  while true; do
    echo "[run-worker] starting scraper worker ($(date "+%H:%M:%S"))…"
    npm run scraper:start
    code=$?
    echo "[run-worker] worker exited (code $code) — restarting in 5s… (Ctrl+C to stop)"
    sleep 5
  done
'

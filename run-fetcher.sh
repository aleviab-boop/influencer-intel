#!/usr/bin/env bash
# ============================================================
# Continuous engagement Fetcher.
#
# Runs scripts/fetch-engagement.mjs in gentle batches with a rest between each
# so Instagram's rate limit stays cool, steadily filling the ~5k creators that
# have no engagement data — no babysitting. Mirrors run-worker.sh.
#
#   - keeps the Mac awake (caffeinate -i) so it doesn't sleep mid-batch
#   - one batch, then rests, then repeats (forever); the fetcher only touches
#     creators still missing ER, so it always picks up where it left off
#   - stops touching Instagram if the cookie dies (fetcher exits) — it'll just
#     do a quick no-op each cycle until you refresh IG_SESSIONID
#
# Usage:   ./run-fetcher.sh          (from the influencer-intel folder)
# Stop:    Ctrl+C
# Tune:    FETCH_BATCH (default 200)  REST_SECONDS (default 1800 = 30min)
# Needs:   IG_SESSIONID (+ friends) in platform/.env, run on a residential IP.
# ============================================================

cd "$(dirname "$0")/platform" || exit 1

BATCH="${FETCH_BATCH:-200}"
REST="${REST_SECONDS:-1800}"

exec caffeinate -i bash -c '
  while true; do
    echo "[run-fetcher] batch of '"$BATCH"' starting ($(date "+%H:%M:%S"))…"
    FETCH_BATCH='"$BATCH"' node --env-file=.env scripts/fetch-engagement.mjs
    echo "[run-fetcher] batch done — resting '"$REST"'s to cool the rate limit… (Ctrl+C to stop)"
    sleep '"$REST"'
  done
'

#!/usr/bin/env bash
# Wrapper invoked by crontab on 2026-05-18 to run the CarPlay port_uid
# analytics. Writes output to logs/carplay-port-uid-analysis-<date>.log so
# the user can read it any time after that day.
#
# Cron has a minimal environment, so we explicitly source nvm and cd into
# the project before running the script.

set -u

REPO=/home/randy-vollrath/ticketless-chicago
NVM_DIR=/home/randy-vollrath/.nvm
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
LOG=$REPO/logs/carplay-port-uid-analysis-$TS.log

mkdir -p $REPO/logs

# Load nvm so npx + node are on PATH.
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

{
  echo "==== run-carplay-analysis-cron.sh started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
  cd "$REPO" || { echo "FATAL: cd $REPO failed"; exit 1; }
  npx tsx scripts/analyze-carplay-port-uid.ts
  echo "==== completed at $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
} >"$LOG" 2>&1

# Drop a marker the user will see when they next look at the repo.
ln -sf "$LOG" "$REPO/logs/carplay-port-uid-analysis-LATEST.log"

# Self-remove the cron entry so this is truly one-shot (won't fire again
# on 2027-05-18). Match by the exact wrapper path so we leave any other
# crontab entries alone.
crontab -l 2>/dev/null | grep -vF "$REPO/scripts/run-carplay-analysis-cron.sh" | crontab - 2>>"$LOG" || true
echo "==== removed cron entry; this was a one-shot ====" >>"$LOG"

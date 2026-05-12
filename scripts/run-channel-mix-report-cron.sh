#!/usr/bin/env bash
# Auto-installed 2026-05-03 by Claude Code: one-shot channel-mix report after first
# Wednesday mail batch (Wed 2026-05-06 at 15:00 UTC). Fires Thu 2026-05-07 at 14:00 UTC.
# Self-removes on completion.
#
# Output: ~/ticketless-chicago/reports/channel-mix-YYYYMMDD.log

set -u

PROJECT=/home/randy-vollrath/ticketless-chicago
TS="$(date -u +%Y%m%d-%H%M%S)"
LOG="$PROJECT/reports/channel-mix-$TS.log"
LATEST="$PROJECT/reports/channel-mix-LATEST.log"
NVM_DIR="/home/randy-vollrath/.nvm"

mkdir -p "$PROJECT/reports"

# Load nvm so npm/node are available under cron
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

cd "$PROJECT" || exit 1

{
  echo "=== channel-mix report run $TS UTC ==="
  echo "host: $(hostname)"
  echo "node: $(node --version 2>/dev/null || echo 'no node')"
  echo
  npm run report:channel-mix
  RC=$?
  echo
  echo "=== exit: $RC ==="
} > "$LOG" 2>&1

ln -sf "$LOG" "$LATEST"

# Self-remove this cron entry so it only fires once
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'run-channel-mix-report-cron.sh' | grep -v 'channel-mix one-shot' > "$TMP"
crontab "$TMP"
rm -f "$TMP"

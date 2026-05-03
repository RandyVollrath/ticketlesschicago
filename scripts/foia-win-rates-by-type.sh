#!/usr/bin/env bash
# FOIA Administrative Hearings — dismissal rate by violation bucket, 2023-2025.
# Source: ~/Documents/FOIA/foia.db, table `hearings` (1.2M rows, 2006-2025).
# Methodology: Not Liable / (Not Liable + Liable), filtered to contest_method='Mail'
# because that is the contest method our product uses (Lob letters).
# These numbers back the per-type win rates shown in:
#   - pages/settings.tsx  (TICKET_TYPES.winRate)
#   - TicketlessChicagoMobile/src/screens/NativeAlertsScreen.tsx (TICKET_TYPES.winRate)
#   - pages/start.tsx Step 11 (city-sticker / expired-plate callouts)
#
# Run: bash scripts/foia-win-rates-by-type.sh
set -euo pipefail

DB="${FOIA_DB:-$HOME/Documents/FOIA/foia.db}"
[ -f "$DB" ] || { echo "FOIA DB not found at $DB" >&2; exit 1; }

sqlite3 "$DB" "
WITH y AS (
  SELECT *,
    CAST(substr(issue_datetime, instr(issue_datetime, '/')+1+instr(substr(issue_datetime, instr(issue_datetime,'/')+1), '/'), 4) AS INTEGER) AS yr
  FROM hearings
),
buckets AS (
  SELECT
    CASE
      WHEN UPPER(violation_desc) LIKE 'EXPIRED PLATE%' OR UPPER(violation_desc) LIKE '%EXP. PLATE%' THEN 'expired_plates'
      WHEN UPPER(violation_desc) LIKE 'NO CITY STICKER%' THEN 'no_city_sticker'
      WHEN UPPER(violation_desc) LIKE 'EXP. METER%' OR UPPER(violation_desc) LIKE 'EXPIRED METER%' THEN 'expired_meter'
      WHEN UPPER(violation_desc) LIKE 'DISABLED PARKING ZONE%' THEN 'disabled_zone'
      WHEN UPPER(violation_desc) LIKE 'NO STANDING/PARKING TIME%' THEN 'no_standing_time_restricted'
      WHEN UPPER(violation_desc) LIKE 'PARKING/STANDING PROHIBITED%' THEN 'parking_prohibited'
      WHEN UPPER(violation_desc) LIKE 'RESIDENTIAL PERMIT%' THEN 'residential_permit'
      WHEN UPPER(violation_desc) LIKE 'MISSING/NON-COMPLIANT%' OR UPPER(violation_desc) LIKE 'NON-COMPLIANT PLATE%' THEN 'missing_plate'
      WHEN UPPER(violation_desc) LIKE 'NON PYMT/NON-COM VEH PARKED IN COM%' OR UPPER(violation_desc) LIKE 'CURB LOADING%' THEN 'commercial_loading'
      WHEN UPPER(violation_desc) LIKE 'WITHIN 15%FIRE HYDRANT%' OR UPPER(violation_desc) LIKE '%FIRE HYDRANT%' THEN 'fire_hydrant'
      WHEN UPPER(violation_desc) = 'STREET CLEANING' THEN 'street_cleaning'
      WHEN UPPER(violation_desc) LIKE '%BUS LANE%' THEN 'bus_lane'
      WHEN UPPER(violation_desc) = 'RED LIGHT VIOLATION' THEN 'red_light'
      WHEN UPPER(violation_desc) LIKE 'SPEED VIOLATION%' THEN 'speed_camera'
      WHEN UPPER(violation_desc) LIKE 'DOUBLE PARKING%' THEN 'double_parking'
      WHEN UPPER(violation_desc) LIKE '%SNOW ROUTE%' THEN 'snow_route'
      ELSE NULL
    END AS bucket,
    disposition
  FROM y
  WHERE yr BETWEEN 2023 AND 2025
    AND disposition IN ('Not Liable','Liable')
    AND contest_method = 'Mail'
)
SELECT
  printf('%-30s', bucket) AS type,
  printf('%6d', SUM(CASE WHEN disposition='Not Liable' THEN 1 ELSE 0 END)) AS dismissed,
  printf('%6d', SUM(CASE WHEN disposition='Liable'    THEN 1 ELSE 0 END)) AS liable,
  printf('%7d', COUNT(*))                                                  AS total,
  printf('%5.1f%%', 100.0 * SUM(CASE WHEN disposition='Not Liable' THEN 1 ELSE 0 END) / COUNT(*)) AS pct
FROM buckets
WHERE bucket IS NOT NULL
GROUP BY bucket
ORDER BY total DESC;
"

# Violation System - Quick Reference

## The 4 Implemented Restrictions

```
PARKING DETECTED (Bluetooth or CoreMotion)
                    ↓
        Call /api/mobile/check-parking
                    ↓
    ┌───────────────┼───────────────┐
    ↓               ↓               ↓               ↓
  STREET        WINTER BAN      SNOW BAN        PERMIT
  CLEANING      (3am-7am)       (2" snow)       ZONES
  
  Spatial:      Address:        Spatial:        Spatial:
  30m search    Dec1-Apr1       active check    30m search
  by line       Mon-Fri check   if weather      by polygon
  
  Data:         Data:           Data:           Data:
  ward          street name     route found     zone #
  section       hours           snow inches     zone type
  day/time      severity        severity        permit req
  season        message         message         schedule
```

## The 10 Unimplemented (But Designed For)

```
❌ Tow Zones          | Framework type exists | No DB table | No API query
❌ Metered Parking    | Framework type exists | No DB table | No API query
❌ Time Limits        | Framework type exists | No DB table | No API query
❌ Loading Zones      | Framework type exists | No DB table | No API query
❌ Color Curbs        | Framework type exists | No DB table | No API query
❌ No-Parking Ever    | Framework type exists | No DB table | No API query
❌ Proximity Rules    | Framework type exists | No DB table | No API query
❌ Event Restrictions | Framework type exists | No DB table | No API query
❌ Alternate Side     | Framework type exists | No DB table | No API query
❌ Red Light Tickets  | Stub file only       | No DB table | No API query
```

## Code Locations

| Component | Location | Purpose |
|-----------|----------|---------|
| Parking detection trigger | `BackgroundTaskService.ts:handleCarDisconnection()` | Called when BT disconnects or CoreMotion detects stop |
| GPS + API call | `LocationService.ts:checkParkingLocation()` | Gets location, calls /api/mobile/check-parking |
| Mobile API endpoint | `pages/api/mobile/check-parking.ts` | Main API that checks all 4 restrictions |
| Backend checker | `lib/unified-parking-checker.ts` | Executes RPC queries, parses results, formats response |
| Camera alerts (while driving) | `CameraAlertService.ts` | NOT a parking check - alerts while DRIVING |
| Red light tracking (stub) | `RedLightReceiptService.ts` | Empty file, no implementation |
| Notifications | `LocalNotificationService.ts` | Sends notification to user |
| History storage | `ParkingHistoryService.ts` | Saves to AsyncStorage + server |
| Permit zones display logic | `FilterOwnPermitZone()` in BackgroundTaskService | Hides notification if in home zone |
| Parking map visualization | `parking-map/compute.ts` | SEPARATE - for map UI, not detection |

## Database Tables

| Table | Type | Columns | Purpose |
|-------|------|---------|---------|
| `street_cleaning_segments` | Spatial lines | geometry, ward, section, day, time, season | Street cleaning zones |
| `snow_routes` | Spatial lines | geometry | 2" ban routes |
| `snow_route_status` | Status | is_active, snow_amount_inches | Current snow conditions |
| `parking_permit_zones` | Spatial polygons | geometry, zone_name, type, hours | Permit zone boundaries |
| `parking_industrial_zones` | Spatial polygons | geometry, zone_name, hours | Industrial permit zones |
| `winter_overnight_ban_streets_temp` | Address list | street_number, direction, name | Winter ban street registry |

## API Response Fields

```json
{
  "streetCleaning": {
    "hasRestriction": boolean,
    "timing": "NOW" | "TODAY" | "UPCOMING" | "NONE",
    "message": string,
    "schedule": string,
    "nextDate": string,
    "severity": "critical" | "warning" | "info" | "none"
  },
  "winterOvernightBan": {
    "active": boolean,
    "message": string,
    "severity": string,
    "startTime": "3:00 AM",
    "endTime": "7:00 AM"
  },
  "twoInchSnowBan": {
    "active": boolean,
    "message": string,
    "severity": string,
    "reason": "X\" snowfall"
  },
  "permitZone": {
    "inPermitZone": boolean,
    "message": string,
    "zoneName": string,
    "permitRequired": boolean,
    "severity": string,
    "restrictionSchedule": string
  },
  "enforcementRisk": {
    "risk_score": 0-100,
    "urgency": "low" | "medium" | "high",
    "insight": string
  }
}
```

## Notification Flow

```
Parking Detected
    ↓
If restrictions found:
    • Send notification with rule summary
    • Save to history (AsyncStorage + Supabase)
    • Save to user_parked_vehicles table
    • Trigger cron reminders (9pm, 8pm/7am, 7am)
    ↓
User Drives Away
    • Record departure time in history
    • Stop rescan timer
    • Stop snow monitoring
    • Resume camera alerts
```

## Testing a Parking Check

```bash
# Call the API directly
curl -X GET "http://localhost:3000/api/mobile/check-parking?lat=41.8781&lng=-87.6298"

# Returns all 4 restrictions for that coordinate
```

## To Add a New Restriction Type

1. Create Supabase migration to add table with spatial geometry
2. Write RPC function in Supabase (e.g., `get_tow_zones_at_location`)
3. Add RPC call to `unified-parking-checker.ts`
4. Add field to `UnifiedParkingResult` interface
5. Transform response in `pages/api/mobile/check-parking.ts`
6. Update `LocationService.ts` to parse new rule type
7. Update `BackgroundTaskService.ts` to handle new rule in notifications
8. Update mobile app UI to display new rule type

Estimated: 1-2 weeks per restriction type depending on data complexity.

## Historical Data Available But NOT Used

- FOIA ticket analysis (1.18M tickets, by address/hour/dow)
  - Used for: enforcement risk scoring (informational only)
  - Not used for: enforcement predictions, proactive warnings

- Camera locations (300+ speed & red light cameras)
  - Used for: real-time alerts while DRIVING
  - Not used for: parking restriction warnings

- Red light violations
  - Captured: yes (in CameraPassHistoryService)
  - Checked at parking: no
  - Historical lookup: no

---

**Summary:** The system is clean, efficient, and ready for expansion. The 4 current restrictions cover most of Chicago's parking enforcement. Adding more would require data sourcing + 1-2 weeks implementation per type.

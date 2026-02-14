# Parking Check API - Documentation Index

This directory contains comprehensive documentation about how the parking check system works.

## Quick Start (Read These First)

1. **PARKING_API_SUMMARY.md** (11 KB)
   - Executive summary of the entire system
   - Data flow diagram
   - Key data structures explained
   - Quick integration points for adding metered parking
   - Start here if you have 10 minutes

2. **PARKING_API_CODE_SECTIONS.md** (20 KB)
   - Exact code sections from each file
   - Full function implementations with line numbers
   - Interface definitions
   - Easiest to copy/paste from

3. **PARKING_CHECK_API_ANALYSIS.md** (16 KB)
   - Detailed breakdown of each component
   - File paths and line numbers
   - Complete integration guide for metered parking
   - Best for understanding the full context

## Detailed Documentation

4. **PARKING_SYSTEM_SUMMARY.md** (18 KB)
   - Comprehensive system overview
   - Architecture decisions explained
   - Restriction types and enforcement
   - Testing strategies

5. **PARKING_DETECTION_ANALYSIS.md** (33 KB)
   - Deep dive into parking detection mechanics
   - State machine behavior
   - Race conditions and edge cases
   - Troubleshooting guide

6. **PARKING_DETECTION_FLOWS.md** (27 KB)
   - Detailed flow diagrams in ASCII
   - State transitions
   - Event sequences
   - Timeline illustrations

## File Reference

### Mobile App Files

**BackgroundTaskService.ts** (TicketlessChicagoMobile/src/services/)
- `triggerParkingCheck()` - Lines 1122-1347
- `scheduleRestrictionReminders()` - Lines 1530-1709
- What it does: Orchestrates parking detection, API calls, and reminder scheduling

**LocationService.ts** (TicketlessChicagoMobile/src/services/)
- `checkParkingLocation()` - Lines 808-929 (CALLS API)
- `saveParkedLocationToServer()` - Lines 942-983
- Interfaces - Lines 14-75
- What it does: Bridges mobile app to backend API

**LocalNotificationService.ts** (TicketlessChicagoMobile/src/services/)
- `scheduleNotificationsForParking()` - Lines 126-267
- `scheduleRestrictionNotification()` - Lines 156-267
- Interfaces - Lines 45-66
- What it does: Schedules timed notifications via notifee

### Backend Files

**check-parking-location-enhanced.ts** (pages/api/)
- Full handler - Lines 1-92
- What it does: Checks street cleaning, winter ban, snow ban, permit zones
- Called via: `GET /api/mobile/check-parking?lat=X&lng=Y&accuracy=Z&confidence=C`

## Key Concepts

### The Data Flow
```
Bluetooth Disconnect
  → triggerParkingCheck()
  → checkParkingLocation() [calls API]
  → API returns restrictions
  → scheduleRestrictionReminders() [calculates 9pm, 7am, etc.]
  → LocalNotificationService [notifee schedules native notifications]
  → User gets notification at exact time (survives app kill)
```

### Critical Implementation Details

1. **Notification times are pre-computed by BackgroundTaskService**
   - Not offsets, but actual times (9pm, 7am, etc.)
   - Passed to LocalNotificationService as Date objects
   - LocalNotificationService converts to Unix timestamp for notifee

2. **rawApiData is essential**
   - Contains restriction details needed for reminder scheduling
   - Must be preserved through entire chain
   - If missing, reminder scheduling fails silently

3. **Two-phase GPS strategy**
   - Phase 1: Fast single fix (1-3s) for immediate notification
   - Phase 2: Background burst sampling (5 samples over 6s)
   - If phase 2 drifts >25m, silently re-checks and updates notification

4. **Notifications are cancelled on departure**
   - When car reconnects (user leaves parking)
   - Uses NOTIFICATION_PREFIX filters to avoid touching other notifications
   - Must stay in sync with new restriction types

## Adding New Restriction Types (Metered Parking Example)

The documentation includes step-by-step integration points in:
- PARKING_API_SUMMARY.md (Quick version - 8 steps)
- PARKING_CHECK_API_ANALYSIS.md (Detailed version - with code sections)

Key files to modify:
1. API endpoint (check-parking-location-enhanced.ts)
2. LocationService.checkParkingLocation() (parse new field)
3. BackgroundTaskService.scheduleRestrictionReminders() (calculate time)
4. LocalNotificationService (add case, prefix, preferences)
5. saveParkedLocationToServer() (include new data)

## Testing

All documentation includes testing checklists:
- PARKING_API_SUMMARY.md (Lines ~300-310)
- PARKING_SYSTEM_SUMMARY.md (Testing section)

Key tests:
- API returns correct structure
- LocationService parses correctly
- Notification times are correct
- Notifications cancel on departure
- Both Android and iOS

## Code Samples

Each documentation file includes code samples, but for the fastest copy/paste:
- Use **PARKING_API_CODE_SECTIONS.md** for exact code
- Use **PARKING_API_SUMMARY.md** for integration templates

## Quick Reference

### API Endpoint
```
GET /api/mobile/check-parking?lat=41.8781&lng=-87.6298&accuracy=8.5&confidence=high
```

### Response Structure
```json
{
  "success": true,
  "location": { "latitude": X, "longitude": Y, "address": "..." },
  "restrictions": { "found": boolean, "details": [] },
  "raw_data": { "streetCleaning": {...}, "winterOvernightBan": {...}, ... }
}
```

### Notification Times
- **Street Cleaning**: 9pm night before + 7am morning of
- **Winter Ban**: 9pm (before 3am-7am ban)
- **Permit Zone**: 7am next weekday (before 8am enforcement)
- **Snow Ban**: Immediate (weather-dependent)

## For Different Use Cases

**I want to understand the parking API quickly:**
→ Read PARKING_API_SUMMARY.md

**I want to add metered parking:**
→ Read PARKING_CHECK_API_ANALYSIS.md (has integration guide)

**I want to debug a notification issue:**
→ Read PARKING_DETECTION_ANALYSIS.md (has troubleshooting)

**I want exact code to copy/paste:**
→ Read PARKING_API_CODE_SECTIONS.md

**I want to understand the complete system architecture:**
→ Read PARKING_SYSTEM_SUMMARY.md

## File Locations

All parking API files:
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocalNotificationService.ts`
- `/home/randy-vollrath/ticketless-chicago/pages/api/check-parking-location-enhanced.ts`

All documentation files are in the repository root:
- `/home/randy-vollrath/ticketless-chicago/PARKING_API_*.md`

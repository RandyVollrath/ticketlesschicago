# Ticketless Chicago Mobile - Documentation Index

This directory contains comprehensive documentation of the mobile app architecture and implementation.

## Documentation Files

### 1. ARCHITECTURE_SUMMARY.md (27 KB - Recommended Starting Point)
**Complete technical reference for all components**

Contains:
- Bluetooth car detection system (BluetoothService)
- Location detection and GPS strategies (LocationService)
- Parking rule types supported (4 types)
- Complete car disconnect data flow with timing
- Notification systems (Firebase + local)
- All API endpoints called by the app
- Critical gaps and missing functionality
- Configuration constants
- Authentication & security
- Storage schema
- Data type definitions

Best for: Understanding the entire system architecture and how components interact.

---

### 2. QUICK_REFERENCE.md (14 KB - Fast Lookup)
**Visual diagrams and quick lookup tables**

Contains:
- System architecture flow diagram
- Key timing constants table
- API endpoints summary
- Parking rule types table
- Storage keys (AsyncStorage)
- Location accuracy strategy
- Notification flow diagram
- File locations
- Developer quick-start examples

Best for: Quick lookups, architectural overview, and finding specific information fast.

---

## System Overview

The Ticketless Chicago Mobile app is a React Native iOS/Android application that:

1. **Detects when car disconnects** - Monitors Bluetooth connection to user's car
2. **Gets current location** - Uses GPS with multiple accuracy strategies
3. **Checks parking restrictions** - Calls backend API for rules at that location
4. **Sends alerts** - Notifies user of parking violations
5. **Tracks departure** - Records when user leaves parking spot for evidence

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Bluetooth Monitoring | BluetoothService.ts | Car disconnection detection |
| Location Services | LocationService.ts | GPS + parking rules API |
| Background Tasks | BackgroundTaskService.ts | Orchestration & state |
| Push Notifications | PushNotificationService.ts | Alerts via FCM + local |
| HTTP Client | ApiClient.ts | Requests with retry/timeout |
| Rate Limiting | RateLimiter.ts | API limits + caching |

## Quick Start for Developers

### Understanding the Flow
1. Read "ARCHITECTURE_SUMMARY.md" section 4 (Data Flow)
2. Reference "QUICK_REFERENCE.md" flow diagram
3. Study BackgroundTaskService.ts code

### Adding a New Parking Rule Type
1. See QUICK_REFERENCE.md "For Developers" section
2. Update LocationService.ts type definition
3. Add parsing logic in checkParkingLocation()

### Testing Parking Detection
```typescript
// Manual parking check
const coords = await LocationService.getCurrentLocation();
const result = await LocationService.checkParkingLocation(coords);
await LocationService.saveParkingCheckResult(result);
```

### Getting Monitoring Status
```typescript
const status = BackgroundTaskService.getStatus();
// { isMonitoring, lastCheckTime, isCarConnected }
```

## Known Limitations (Gaps)

### Critical
1. **No active reconnection** - Relies on native Bluetooth events
2. **No background execution** - Stops when app is force-closed
3. **No geofencing** - Only checks on Bluetooth disconnect
4. **Single location check** - Only one GPS reading, not average

### Moderate
5. **No offline mode** - No fallback rules database
6. **Incomplete validation** - Basic structure only
7. **No manual UI trigger** - For departure confirmation
8. **Generic error messages** - No context about what failed

See ARCHITECTURE_SUMMARY.md section 7 for details and solutions.

## API Endpoints

All endpoints called by the app:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/mobile/check-parking | GET | Fetch parking rules for coordinates |
| /api/mobile/clear-parked-location | POST | Mark end of parking session |
| /api/mobile/confirm-departure | POST | Prove user left parking spot |
| /api/push/register-token | POST | Register for push notifications |

See ARCHITECTURE_SUMMARY.md section 6 for full details.

## Parking Rule Types

The app detects 4 types of parking rules:

| Rule Type | Severity | Use Case |
|-----------|----------|----------|
| street_cleaning | critical/warning | Scheduled cleaning |
| snow_route | critical | 2"+ snow detected |
| winter_ban | warning/info | Dec-Mar overnights |
| permit_zone | info | Permit-required areas |

See ARCHITECTURE_SUMMARY.md section 3 for full API response structure.

## Files Structure

```
/src/services/
├─ BluetoothService.ts        (Bluetooth detection)
├─ LocationService.ts          (GPS + parking rules)
├─ BackgroundTaskService.ts    (Orchestration)
└─ PushNotificationService.ts  (Notifications)

/src/utils/
├─ ApiClient.ts               (HTTP client)
├─ RateLimiter.ts             (Rate limiting)
├─ validation.ts              (Input validation)
└─ Logger.ts                  (Logging)

/src/constants/
└─ StorageKeys.ts             (Storage keys)
```

## Key Timings

| Operation | Duration | Purpose |
|-----------|----------|---------|
| Disconnect debounce | 30 sec | Avoid false positives |
| GPS wait | 15 sec | Location stabilization |
| API cache | 30 sec | Fresh data |
| Departure delay | 2 min | User driving away |
| Departure retry | 60 sec | Between attempts |

## Storage Keys

Important AsyncStorage keys used:

- `auth_token` - JWT authentication
- `savedCarDevice` - Remembered car Bluetooth device
- `lastParkingLocation` - Last parking check result
- `backgroundTaskState` - Monitoring state persistence
- `hasOnboarded` - First-run flag

See ARCHITECTURE_SUMMARY.md section 11 for complete list.

## For Questions

**Architectural Overview** → ARCHITECTURE_SUMMARY.md (sections 1-6)
**System Flow** → QUICK_REFERENCE.md (flow diagram)
**API Details** → ARCHITECTURE_SUMMARY.md (section 6)
**Known Issues** → ARCHITECTURE_SUMMARY.md (section 7)
**Quick Lookup** → QUICK_REFERENCE.md

---

Last Updated: January 21, 2026
Analysis Scope: ~3,100 lines of TypeScript service code
Documentation Version: 1.0

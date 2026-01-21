# Ticketless Chicago - Quick Reference Guide

## System Architecture Overview

```
                    TICKETLESS CHICAGO MOBILE
                           (React Native)
                    
    ┌─────────────────────────────────────────────────┐
    │         BLUETOOTH SERVICE (BluetoothService)     │
    │ ─────────────────────────────────────────────── │
    │ • Detects when car Bluetooth disconnects        │
    │ • Scans for/saves car Bluetooth device          │
    │ • Monitors reconnection events                   │
    │ • Event-driven via native BleManager            │
    └─────────────┬─────────────────────────────────────┘
                  │
              [DISCONNECT DETECTED]
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │    BACKGROUND TASK SERVICE                       │
    │ ─────────────────────────────────────────────── │
    │ • Waits 30 seconds (debounce false positives)    │
    │ • Triggers location acquisition                  │
    │ • Manages state persistence                      │
    │ • Schedules departure confirmation               │
    └─────────────┬─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │    LOCATION SERVICE (LocationService)            │
    │ ─────────────────────────────────────────────── │
    │ • Gets high-accuracy GPS (target: 20m, max: 15s)│
    │ • Fallback: Retry 3x with exponential backoff   │
    │ • Uses cached location if all fail              │
    │ • Validates Chicago coordinates                 │
    └─────────────┬─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │    API CLIENT (Rate Limited)                     │
    │ ─────────────────────────────────────────────── │
    │ GET /api/mobile/check-parking?lat=X&lng=Y      │
    │ • Rate limit: 5 requests/min                     │
    │ • Cache: 30 seconds                             │
    │ • Timeout: 20 seconds                           │
    │ • Retry: 3 attempts with backoff                │
    └─────────────┬─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │    PARKING RULES PARSER                          │
    │ ─────────────────────────────────────────────── │
    │ Supported rule types:                           │
    │ • street_cleaning (severity: critical/warning)  │
    │ • snow_route (severity: critical)               │
    │ • winter_ban (severity: warning/info)           │
    │ • permit_zone (severity: info)                  │
    └─────────────┬─────────────────────────────────────┘
                  │
              [RULES FOUND?]
                  │
        ┌─────────┴──────────┐
        │                    │
       YES                   NO
        │                    │
        ▼                    ▼
    ┌────────────┐    ┌──────────────┐
    │CRITICAL    │    │"All Clear"   │
    │NOTIFICATION│    │NOTIFICATION  │
    │ HIGH       │    │"Safe to park"│
    │PRIORITY    │    └──────────────┘
    │iOS: Alert  │
    └────────────┘
        │
        ▼
    ┌─────────────────────────────────────────────────┐
    │    WAIT FOR RECONNECTION                         │
    │ (User drives away, car Bluetooth reconnects)     │
    └─────────────┬─────────────────────────────────────┘
                  │
              [RECONNECTED]
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │ POST /api/mobile/clear-parked-location          │
    │ • Marks end of parking session                  │
    │ • Returns parking_history_id                    │
    └─────────────┬─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │ SCHEDULE DEPARTURE CONFIRMATION                 │
    │ Wait 2 minutes, then capture new location       │
    │ Proves user has left parking spot               │
    └─────────────┬─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────────┐
    │ POST /api/mobile/confirm-departure              │
    │ • Sends: parking_history_id, lat, lng, accuracy│
    │ • Returns: distance_from_parked, is_conclusive │
    │ • Retry: Max 3 times if fails                   │
    └─────────────┬─────────────────────────────────────┘
                  │
        ┌─────────┴──────────────┐
        │                        │
    CONCLUSIVE                NOT CONCLUSIVE
        │                        │
        ▼                        ▼
    ┌──────────┐    ┌─────────────────────┐
    │"Departure│    │"Drive further for   │
    │ Recorded"│    │ stronger evidence"  │
    │NOTIFY    │    │NOTIFY               │
    └──────────┘    └─────────────────────┘
```

---

## Key Timings

| Operation | Duration | Purpose |
|-----------|----------|---------|
| Disconnect debounce | 30 sec | Avoid false positives |
| High-accuracy GPS | 15 sec max | Stabilize location |
| Location retry | 1s, 2s, 4s | Exponential backoff |
| API cache | 30 sec | Fresh data |
| Departure delay | 2 min | User driving away |
| Departure GPS | 20 sec max | New location |
| Departure retry | 60 sec delay | Between attempts |

---

## API Endpoints Summary

### 1. Check Parking
```
GET /api/mobile/check-parking?lat={lat}&lng={lng}
├─ Rate: 5/min
├─ Cache: 30s
├─ Timeout: 20s
├─ Retries: 3
└─ Response: address, streetCleaning, twoInchSnowBan, winterOvernightBan, permitZone
```

### 2. Clear Parked Location
```
POST /api/mobile/clear-parked-location (AUTHENTICATED)
├─ Rate: 10/min
├─ Timeout: 15s
├─ Retries: 2
└─ Response: parking_history_id, cleared_at, parked_location
```

### 3. Confirm Departure
```
POST /api/mobile/confirm-departure (AUTHENTICATED)
├─ Payload: parking_history_id, latitude, longitude, accuracy_meters
├─ Rate: 10/min
├─ Timeout: 15s
├─ Retries: 2
└─ Response: distance_from_parked_meters, is_conclusive
```

### 4. Register Push Token
```
POST /api/push/register-token (AUTHENTICATED)
├─ Payload: token, platform, deviceName, appVersion
├─ Rate: 3/min
├─ Timeout: 10s
├─ Retries: 3
└─ Response: success, tokenId
```

---

## Parking Rule Types

| Type | Field | Severity | Use Case |
|------|-------|----------|----------|
| street_cleaning | streetCleaning.hasRestriction | critical/warning | Scheduled cleaning |
| snow_route | twoInchSnowBan.active | critical | 2"+ snow |
| winter_ban | winterOvernightBan.active | warning/info | Dec-Mar overnights |
| permit_zone | permitZone.inPermitZone | info | Permit areas |

---

## Storage Keys (AsyncStorage)

```
Auth
├─ auth_token                    (JWT bearer token)
└─ supabase.auth.token           (Supabase session)

State
├─ hasOnboarded                  (first-run flag)
└─ hasSeenLogin                  (login screen shown)

Parking
├─ lastParkingLocation           (ParkingCheckResult JSON)
└─ parkingHistory                (array of checks)

Car
└─ savedCarDevice                (device id & name)

Push
├─ pushNotificationToken         (FCM token)
└─ pushNotificationPermissionStatus

Background
└─ backgroundTaskState           (monitoring state)

Cache
├─ lastApiResponseCache
└─ geocodeCache
```

---

## Critical Gaps

### 1. No Active Reconnection
System relies on native Bluetooth events. If device goes out of range and returns, relies on OS to emit reconnection event.

### 2. No Background Execution
If app is force-closed, monitoring stops immediately. No true background fetch implementation.

### 3. No Geofencing
Only checks parking on Bluetooth disconnect. No location-based triggers.

### 4. Single Location Check
If user is moving when car disconnects, single GPS reading may not be accurate parking spot.

### 5. No Offline Rules Database
If API unreachable, user gets generic error. No cached parking rules for offline mode.

---

## Location Accuracy Strategy

```
High Accuracy (PRIMARY):
  enableHighAccuracy: true
  timeout: 20s
  maximumAge: 5s
  forceRequestLocation: true
  ↓ (FAILS)
Balanced Accuracy (FALLBACK):
  enableHighAccuracy: true
  timeout: 15s
  maximumAge: 30s
  ↓ (FAILS)
Cached Location (LAST RESORT):
  age < 1 minute
```

---

## Notification Flow

```
Parking Check Complete
├─ Has Rules
│  ├─ Critical? → "Parking Restriction Active NOW!" (HIGH+ALERT)
│  └─ Warning → "Parking Alert" (HIGH)
│     └─ Message with GPS accuracy
└─ No Rules
   └─ "Parking Check Complete" → "No restrictions found"

Car Reconnects
├─ Clear Parked Location API
├─ Schedule Departure (2 min)
│  └─ Get New Location
│     └─ Confirm Departure API
│        ├─ Is Conclusive?
│        │  └─ "Departure Recorded with XXm distance proof"
│        └─ Not Conclusive
│           └─ "Drive further for stronger evidence"
```

---

## File Locations

```
/src/services/
├─ BluetoothService.ts          (Car Bluetooth detection)
├─ LocationService.ts            (GPS + parking rules)
├─ BackgroundTaskService.ts      (Orchestration & state)
└─ PushNotificationService.ts    (FCM + notifications)

/src/utils/
├─ ApiClient.ts                  (HTTP + retry + auth)
├─ RateLimiter.ts                (Rate limits + cache)
├─ validation.ts                 (Input validation)
└─ Logger.ts                     (Logging)

/src/constants/
└─ StorageKeys.ts                (AsyncStorage keys)
```

---

## For Developers

### Add a New Parking Rule Type

1. Update `ParkingRule` type in LocationService.ts:
```typescript
type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'NEW_TYPE'
```

2. Add parsing in `checkParkingLocation()`:
```typescript
if (data?.newRule?.isActive) {
  rules.push({
    type: 'new_type',
    message: data.newRule.message,
    severity: 'critical',
  });
}
```

### Manual Parking Check (UI)
```typescript
const coords = await LocationService.getCurrentLocation();
const result = await LocationService.checkParkingLocation(coords);
await LocationService.saveParkingCheckResult(result);
```

### Manual Departure Confirmation (UI)
```typescript
const success = await BackgroundTaskService.manualDepartureConfirmation();
```

### Get Monitoring Status
```typescript
const status = BackgroundTaskService.getStatus();
// { isMonitoring, lastCheckTime, isCarConnected }
```


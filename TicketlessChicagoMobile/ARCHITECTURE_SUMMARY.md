# Ticketless Chicago Mobile - Architecture Summary

## Executive Overview

The Ticketless Chicago Mobile app is a React Native iOS/Android application that automatically detects when a user's car is parked and checks local parking restrictions at that location. It uses Bluetooth connectivity monitoring combined with GPS location services to automatically alert users to parking violations.

---

## 1. BLUETOOTH CAR DETECTION (BluetoothService)

### Architecture
- **Implementation**: react-native-ble-manager (native BLE manager)
- **Pattern**: Event-based monitoring with NativeEventEmitter
- **State Management**: Singleton class with connection tracking

### Key Components

#### Device Discovery & Pairing
- `scanForDevices(callback)` - Performs 10-second BLE scan
  - Discovers nearby Bluetooth devices
  - Returns device ID and name
  - Emits `BleManagerDiscoverPeripheral` events
  
- `saveCarDevice(device)` - Persists selected device to AsyncStorage
  - Stores device ID and name locally
  - Used for reconnection after app restart

#### Connection Monitoring
- `monitorCarConnection(onDisconnect, onReconnect)` - Main monitoring function
  - Registers two native event listeners:
    - `BleManagerDisconnectPeripheral` - Fires when car's Bluetooth disconnects
    - `BleManagerConnectPeripheral` - Fires when car's Bluetooth reconnects
  - Attempts initial connection to saved device
  - Continues monitoring even if device is out of range

#### Connection State Tracking
```typescript
private connectedDeviceId: string | null = null;
private savedDeviceId: string | null = null;
isConnectedToCar(): boolean // Returns if actively connected to saved device
```

### Cleanup & Lifecycle
- `stopMonitoring()` - Removes event listeners and disconnects
- `stopScanning()` - Halts BLE scan operations
- `deleteSavedCarDevice()` - Clears saved device from storage

### Gap Identified
**No re-connection attempts**: If Bluetooth connection is lost, the service only monitors for native reconnection events. There's no active re-scanning or reconnection attempts if the device remains out of range.

---

## 2. LOCATION DETECTION (LocationService)

### Architecture
- **Implementation**: react-native-geolocation-service
- **Pattern**: Multi-strategy location retrieval with accuracy targets
- **Caching**: 1-minute LRU cache for expensive GPS calls

### Location Acquisition Strategies

#### 1. Standard Location (`getCurrentLocation()`)
- **High Accuracy Mode** (default)
  - enableHighAccuracy: true
  - timeout: 20 seconds
  - Uses GPS + network triangulation
  - Forces new reading on Android

- **Balanced Mode** (fallback)
  - enableHighAccuracy: true
  - timeout: 15 seconds
  - Accepts 30-second cached results

- **Low Accuracy Mode** (quick fallback)
  - enableHighAccuracy: false
  - timeout: 10 seconds
  - Uses location manager only (faster)
  - Accepts 1-minute cached results

#### 2. High-Accuracy Location (`getHighAccuracyLocation()`)
- **Purpose**: Waits for GPS to stabilize with target accuracy
- **Parameters**:
  - `targetAccuracyMeters`: 20m (default)
  - `maxWaitMs`: 30 seconds (default)
- **Strategy**:
  - Continuous watchPosition with 1Hz update rate
  - Collects best accuracy achieved during wait period
  - Returns immediately if target accuracy reached
  - Returns best-so-far if timeout expires

#### 3. Retry Logic (`getLocationWithRetry()`)
- **Default**: 3 retry attempts with exponential backoff
- **Backoff**: 1s, 2s, 4s delays
- **Fallback**: Returns cached location if all retries fail
- **Used By**: Parking check automation

#### 4. Continuous Watching (`startWatchingLocation()`)
- **Use Case**: Real-time location updates
- **Parameters**:
  - Distance filter: 10m (configurable)
  - Update interval: 5 seconds
- **Returns**: Cleanup function to stop watching

### Accuracy Descriptions (for UI)
| Accuracy Range | Label | Color |
|---|---|---|
| ≤ 10m | Excellent | Green |
| 10-25m | Good | Green |
| 25-50m | Fair | Amber |
| 50-100m | Poor | Amber |
| > 100m | Very Poor | Red |

### Permission Handling
- **iOS**: Uses native Geolocation requestAuthorization('always')
- **Android**: Two-stage permission request
  - Stage 1: ACCESS_FINE_LOCATION (foreground)
  - Stage 2: ACCESS_BACKGROUND_LOCATION (Android 10+ only)
  - Background location is optional but recommended for auto-detection

### Location Cache
```typescript
interface CachedLocation {
  coords: Coordinates;
  timestamp: number;
}
const LOCATION_CACHE_MAX_AGE_MS = 60000; // 1 minute
```

---

## 3. PARKING RULE TYPES SUPPORTED

### Defined Rule Types
```typescript
type ParkingRuleType = 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban'
```

### Rule Structure
```typescript
interface ParkingRule {
  type: ParkingRuleType;
  message: string;           // Human-readable restriction message
  severity: 'critical' | 'warning' | 'info';
}
```

### Rule Categories

#### 1. Street Cleaning
- **API Field**: `data.streetCleaning.hasRestriction`
- **Severity Logic**: 'critical' if timing == 'NOW', else 'warning'
- **Use Case**: Scheduled street cleaning days/times

#### 2. Snow Routes (2-Inch Ban)
- **API Field**: `data.twoInchSnowBan.active`
- **Severity**: 'critical' (default)
- **Use Case**: Activated when 2+ inches of snow falls

#### 3. Winter Overnight Ban
- **API Field**: `data.winterOvernightBan.active`
- **Severity**: from API response or 'warning' (default)
- **Use Case**: December-March overnight parking restrictions

#### 4. Permit Zones
- **API Field**: `data.permitZone.inPermitZone`
- **Severity**: 'info' (informational only)
- **Use Case**: Permit-required parking areas

### API Response Structure Expected
```json
{
  "address": "123 Main St, Chicago, IL",
  "streetCleaning": {
    "hasRestriction": boolean,
    "message": string,
    "timing": "NOW" | "FUTURE"
  },
  "twoInchSnowBan": {
    "active": boolean,
    "message": string,
    "severity": "critical" | "warning"
  },
  "winterOvernightBan": {
    "active": boolean,
    "message": string,
    "severity": "warning" | "info"
  },
  "permitZone": {
    "inPermitZone": boolean,
    "message": string
  }
}
```

---

## 4. DATA FLOW - CAR DISCONNECT SEQUENCE

### High-Level Flow
```
[Bluetooth Disconnect Event] 
    ↓
[30 second debounce to avoid false positives]
    ↓
[Get High-Accuracy Location]
    ↓
[Call /api/mobile/check-parking]
    ↓
[Parse parking rules]
    ↓
[Send notification to user]
    ↓
[Wait for car reconnection]
    ↓
[Clear parked location & schedule departure confirmation]
```

### Detailed Step-by-Step

#### Phase 1: Detection (BackgroundTaskService.handleCarDisconnection)
```
1. Bluetooth disconnect event fired
2. Record disconnect timestamp
3. Set lastCarConnectionStatus = false
4. Wait 30 seconds (MIN_DISCONNECT_DURATION_MS)
5. Verify still disconnected (avoid false positives)
6. Proceed to parking check
```

#### Phase 2: Location Acquisition (triggerParkingCheck)
```
1. Try getHighAccuracyLocation(20m, 15s)
   - Waits up to 15 seconds for GPS to achieve 20m accuracy
   - Returns best-available if timeout
2. If high-accuracy fails, fallback to getLocationWithRetry(3)
   - Attempts 3 times with exponential backoff
   - Uses cached location if all fail
```

#### Phase 3: Parking Validation
```
1. Validate coordinates are within Chicago bounds
   - Warning issued if outside bounds
   - Still proceeds with check
2. Rate-limited API call
   - Max 5 requests per minute to /api/mobile/check-parking
   - 30-second response caching
   - Deduplicates simultaneous requests
3. Validate API response structure
4. Parse all rule types and build array
```

#### Phase 4: Notification & Storage
```
1. Save parking check result to AsyncStorage
   - Key: LAST_PARKING_LOCATION
   - Contains: coords, address, rules, timestamp

2. If rules found:
   - Send local notification with rule messages
   - Android: HIGH priority to parking-monitoring channel
   - iOS: Critical alert if severity == 'critical'

3. If no rules found:
   - Send "all clear" notification
   - Confirm safe to park
```

#### Phase 5: Reconnection Handling (markCarReconnected)
```
1. Bluetooth reconnection event detected
2. Set lastCarConnectionStatus = true
3. Call /api/mobile/clear-parked-location
   - Marks end of parking session
   - Returns parking_history_id for evidence
4. Schedule departure confirmation
   - Waits DEPARTURE_CONFIRMATION_DELAY_MS (2 minutes)
   - Captures location proof user has left parking spot
```

#### Phase 6: Departure Confirmation (confirmDeparture)
```
1. Wait 2 minutes after car reconnection
2. Get high-accuracy location (30m target, 20s timeout)
3. Call /api/mobile/confirm-departure
   - POST with: parking_history_id, latitude, longitude, accuracy
   - Returns: distance from parked location, is_conclusive flag
4. Retry logic:
   - Max 3 retries (total 4 attempts)
   - 60 second delay between retries
5. Notify user:
   - If conclusive: "Departure recorded with distance proof"
   - If not conclusive: "Drive further for stronger evidence"
   - If failed: "Could not record departure, retry manually"
```

### Key Timings
| Event | Duration | Purpose |
|---|---|---|
| Disconnect debounce | 30 seconds | Avoid false positives from weak signal |
| High-accuracy wait | 15 seconds | Allow GPS to stabilize |
| Departure confirmation delay | 2 minutes | Give user time to drive away |
| Departure confirmation timeout | 20 seconds | GPS stabilization at new location |
| Retry delay | 60 seconds | Between departure confirmation attempts |
| Departure retention | 3 attempts | Max retries before giving up |

### State Persistence
All monitoring state saved to AsyncStorage key `BACKGROUND_TASK_STATE`:
```typescript
{
  isMonitoring: boolean;
  lastCarConnectionStatus: boolean;
  lastDisconnectTime: number | null;
  lastParkingCheckTime: number | null;
  isInitialized: boolean;
  pendingDepartureConfirmation: {
    parkingHistoryId: string;
    parkedLocation: { latitude, longitude };
    clearedAt: string;
    retryCount: number;
    scheduledAt: number;
  } | null;
}
```

---

## 5. NOTIFICATION SYSTEMS

### Push Notifications (Firebase Cloud Messaging)
**Implementation**: react-native-firebase/messaging + notifee

#### Registration Flow
1. `requestPermissionAndRegister()` - Initialize FCM
2. Gets FCM token from Firebase
3. Calls `/api/push/register-token` (authenticated)
   - Payload: token, platform, deviceName, appVersion
4. Listens for token refresh events
5. Re-registers new token with backend

#### Android Notification Channels
| Channel | ID | Importance | Use Case |
|---|---|---|---|
| Parking Alerts | parking-alerts | HIGH | Critical parking restrictions |
| Reminders | reminders | DEFAULT | Upcoming restrictions |
| General | general | LOW | General app updates |

#### Parking Monitoring Channel
- ID: `parking-monitoring`
- Importance: HIGH
- Description: "Notifications for parking monitoring and car disconnection alerts"

### Local Notifications (Triggered by App)

#### Parking Restriction Alerts
```
Title: "Parking Restriction Active NOW!" (if critical)
        "Parking Alert" (if warning/info)
Body: Rules formatted as newline-separated messages
      GPS accuracy appended: "(GPS: XXm)"
```

#### Safe Parking Confirmation
```
Title: "Parking Check Complete"
Body: "No restrictions found at [ADDRESS] (GPS: XXm). You're good to park!"
```

#### Departure Confirmation
- **Conclusive**: "Departure Recorded - You moved XXm from parking spot"
- **Not Conclusive**: "Departure Recorded - Drive further for stronger evidence"
- **Failed**: "Could not record departure. Open app to retry manually"

### Notification Permission States
- **Granted**: Full notification display
- **Provisional**: iOS only, limited notifications
- **Denied**: Fallback to in-app Alert dialogs

### Notification Navigation
When user taps notification, routed to appropriate screen:
- `parking_alert`, `snow_ban_alert` → Map screen with coordinates
- `street_cleaning_reminder`, `permit_reminder` → Home screen with auto-check
- Custom `screen` data → Navigate to specified screen
- Default → History screen

---

## 6. API ENDPOINTS

### Check Parking Rules
```
GET /api/mobile/check-parking?lat={latitude}&lng={longitude}

Rate Limit: 5 requests/minute
Cache: 30 seconds
Timeout: 20 seconds
Retry: 3 attempts with exponential backoff

Response: ParkingCheckResult {
  address: string,
  streetCleaning: { hasRestriction, message, timing },
  twoInchSnowBan: { active, message, severity },
  winterOvernightBan: { active, message, severity },
  permitZone: { inPermitZone, message }
}
```

### Clear Parked Location
```
POST /api/mobile/clear-parked-location

Rate Limit: Standard (10/min)
Timeout: 15 seconds
Retry: 2 attempts

Response: {
  success: boolean,
  parking_history_id: string,
  cleared_at: ISO8601 timestamp,
  parked_location: { latitude, longitude, address },
  departure_confirmation_delay_ms: number (default 120000)
}

Purpose: Mark end of parking session and get history ID for evidence
```

### Confirm Departure
```
POST /api/mobile/confirm-departure

Payload: {
  parking_history_id: string,
  latitude: number,
  longitude: number,
  accuracy_meters?: number
}

Rate Limit: Standard (10/min)
Timeout: 15 seconds
Retry: 2 attempts

Response: {
  data: {
    parking_history_id: string,
    parked_at: ISO8601 timestamp,
    cleared_at: ISO8601 timestamp,
    departure_confirmed_at: ISO8601 timestamp,
    distance_from_parked_meters: number,
    is_conclusive: boolean
  }
}

Purpose: Prove user has left parking spot (distance + timestamp evidence)
```

### Register Push Token
```
POST /api/push/register-token (AUTHENTICATED)

Payload: {
  token: string (FCM token),
  platform: "ios" | "android",
  deviceName: string,
  appVersion: string
}

Rate Limit: 3 requests/minute
Timeout: 10 seconds
Retry: 3 attempts

Purpose: Enable server to send push notifications to user
```

---

## 7. GAPS & MISSING FUNCTIONALITY

### Critical Gaps

#### 1. No Active Reconnection Strategy
**Issue**: If car Bluetooth goes out of range and returns, system relies on native Bluetooth subsystem to emit reconnection events.
- **Risk**: System state may miss reconnection if app restarted or event lost
- **Recommendation**: Implement periodic scan-and-connect retry loop

#### 2. No Background Execution on App Close
**Issue**: Parking check only triggers on active Bluetooth event. If app is force-closed or killed, monitoring stops.
- **Risk**: User loses auto-detection until app is reopened
- **Status**: Uses BackgroundTaskService but may not survive aggressive app killing
- **Recommendation**: Implement react-native-background-fetch for true background execution

#### 3. No Geofencing
**Issue**: System only checks parking when Bluetooth disconnects. If user manually disables Bluetooth or device is already disconnected before opening app, no automatic checks occur.
- **Recommendation**: Implement geofencing to trigger checks when entering/leaving parking zones

#### 4. Single Location Check Per Disconnect
**Issue**: If user is in motion when car disconnects (e.g., walking away after parking), location may be inaccurate. No secondary checks performed.
- **Recommendation**: Consider multiple location polls over time for accurate parking spot detection

### Moderate Gaps

#### 5. No Offline Fallback
**Issue**: If API is unreachable, user gets generic error notification. No cached rule database.
- **Risk**: Users can't get alerts if cellular service is weak
- **Recommendation**: Maintain local ruleset cache for offline operation

#### 6. Incomplete Parking Rule Validation
**Issue**: API response validation only checks basic structure, doesn't validate business logic (e.g., message length, timing format).
- **Recommendation**: Add schema validation using zod or similar

#### 7. No Manual Departure Confirmation Trigger
**Issue**: User cannot manually trigger departure confirmation if automatic attempt fails or didn't occur.
- **Code**: `manualDepartureConfirmation()` exists but not connected to UI
- **Recommendation**: Add UI button to trigger departure proof capture

#### 8. Limited Error Recovery for Location Failures
**Issue**: If location retrieval fails (airplane mode, permissions revoked), generic error shown to user.
- **Recommendation**: Implement context-aware error messages (e.g., "Enable location services", "Check permissions")

### Minor Gaps

#### 9. No Analytics on Rule Types
**Issue**: No tracking of which parking rule types are most commonly triggered.
- **Recommendation**: Add telemetry for rule type distribution

#### 10. No Rate Limit Information in Error Messages
**Issue**: When rate limited, error message says "wait Xs" but doesn't explain why.
- **Recommendation**: Add context: "Checking parking rules too frequently"

#### 11. No Bluetooth Device Validation
**Issue**: System accepts any Bluetooth device ID format. No validation that saved device is actually a car.
- **Recommendation**: Could add paired device name filtering (e.g., require "Car", "Auto", "Bluetooth" in name)

---

## 8. NOTIFICATION FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                   CAR DISCONNECTS                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
      ┌──────────────────────────────────┐
      │  30-second debounce              │
      │  (verify not false disconnect)   │
      └──────────────┬───────────────────┘
                     │
                     ▼
      ┌──────────────────────────────────┐
      │  Get High-Accuracy Location      │
      │  (wait 15s for GPS stabilization)│
      │  fallback: retry 3x              │
      └──────────────┬───────────────────┘
                     │
                     ▼
      ┌──────────────────────────────────┐
      │  Call /api/mobile/check-parking  │
      │  (rate-limited: 5/min, cached)   │
      └──────────────┬───────────────────┘
                     │
                  ┌──┴──┐
                  │     │
           HAS ┌──┘     └──┐ NO
         RULES │           │ RULES
              ▼           ▼
       ┌─────────────┐  ┌──────────────┐
       │ CRITICAL?  │  │ Send "Safe"  │
       └─────┬───┬──┘  │ Notification │
           Y │ N │     └──────────────┘
            │ │  │
            ▼ ▼  └──────┬──────────────┐
      ┌──────────┐       │              │
      │HIGH      │ ┌─────▼──────────────┤
      │PRIORITY  │ │ Send Notification  │
      │+ CRITICAL│ │ with rules & GPS   │
      │ALERT     │ │ accuracy info      │
      │(iOS)     │ └─────┬──────────────┘
      └──────────┘       │
                         ▼
      ┌──────────────────────────────────┐
      │  Save to AsyncStorage            │
      │  LAST_PARKING_LOCATION           │
      └──────────────┬───────────────────┘
                     │
                     ▼
            ┌────────────────────┐
            │ WAIT FOR CAR       │
            │ RECONNECTION       │
            └────────┬───────────┘
                     │
                     ▼
      ┌──────────────────────────────────┐
      │  Car Reconnects (BT Event)       │
      │  Call /api/clear-parked-location │
      └──────────────┬───────────────────┘
                     │
                     ▼
      ┌──────────────────────────────────┐
      │  Schedule Departure Confirmation │
      │  (in 2 minutes)                  │
      └──────────────┬───────────────────┘
                     │
                     ▼
      ┌──────────────────────────────────┐
      │  Get New Location (30m acc)      │
      │  Call /api/confirm-departure     │
      │  with distance from parked       │
      └──────────────┬───────────────────┘
                     │
              ┌──────┴──────┐
           Y  │             │  N
      CONCLUSIVE?           │
         ▼                  ▼
      ┌────────────┐  ┌──────────────┐
      │"Departure │  │"Drive further"│
      │ Recorded" │  │ "Not conclus"  │
      │ Notify    │  │ "for evidence" │
      └───────────┘  │ Notify        │
                     └──────────────┘
```

---

## 9. KEY CONFIGURATION CONSTANTS

### BackgroundTaskService
```typescript
BACKGROUND_TASK_ID = 'ticketless-parking-check'
CHECK_INTERVAL_MS = 15 * 60 * 1000           // 15 minutes (periodic check backup)
MIN_DISCONNECT_DURATION_MS = 30 * 1000       // 30 seconds (debounce)
DEPARTURE_CONFIRMATION_DELAY_MS = 120 * 1000 // 2 minutes after reconnection
MAX_DEPARTURE_RETRIES = 3                    // Try 3 times to confirm departure
DEPARTURE_RETRY_DELAY_MS = 60 * 1000         // 1 minute between retries
```

### LocationService
```typescript
LOCATION_CACHE_MAX_AGE_MS = 60000             // 1 minute cache

High Accuracy:
  timeout: 20000ms, maximumAge: 5000ms, forceRequestLocation: true

Balanced:
  timeout: 15000ms, maximumAge: 30000ms

Low:
  timeout: 10000ms, maximumAge: 60000ms

getHighAccuracyLocation defaults:
  targetAccuracy: 20m, maxWait: 30000ms
```

### RateLimiter
```typescript
/api/mobile/check-parking: 5 requests/minute
/api/push: 3 requests/minute
Default cache: 30 seconds
```

---

## 10. AUTHENTICATION & SECURITY

### Token Management
- Uses Bearer token in Authorization header for authenticated endpoints
- Token stored in AsyncStorage (key: `auth_token`)
- Automatic token refresh on 401 response
- AuthService.getToken() retrieves current token

### Endpoints Requiring Auth
- `/api/push/register-token` - Authenticated POST
- Assumed: `/api/mobile/clear-parked-location` - Authenticated POST
- Assumed: `/api/mobile/confirm-departure` - Authenticated POST

### Permission Levels
- **Bluetooth Scan**: BLUETOOTH_SCAN (Android 12+)
- **Bluetooth Connect**: BLUETOOTH_CONNECT (Android 12+)
- **Location**: ACCESS_FINE_LOCATION (foreground)
- **Background Location**: ACCESS_BACKGROUND_LOCATION (Android 10+, optional)
- **Notifications**: Requested via Firebase Messaging

---

## 11. STORAGE SCHEMA

### AsyncStorage Keys (see StorageKeys.ts)

#### Auth & Session
- `auth_token` - JWT bearer token
- `supabase.auth.token` - Supabase session token

#### App State
- `hasOnboarded` - Boolean flag for first-run flow
- `hasSeenLogin` - Flag for login screen shown

#### Parking Data
- `lastParkingLocation` - ParkingCheckResult JSON
- `parkingHistory` - Array of historical checks

#### Car/Bluetooth
- `savedCarDevice` - SavedCarDevice JSON { id, name, rssi? }

#### Push Notifications
- `pushNotificationToken` - FCM token string

#### Background Tasks
- `backgroundTaskState` - BackgroundTaskState JSON (monitoring status, last check time, pending departure)

#### Cache
- `lastApiResponseCache` - Cached API responses
- `geocodeCache` - Cached address lookups

---

## 12. DATA TYPES SUMMARY

### Coordinates
```typescript
interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;           // meters
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}
```

### SavedCarDevice
```typescript
interface SavedCarDevice {
  id: string;              // Bluetooth device ID
  name: string;            // Bluetooth device name
  rssi?: number;           // Signal strength
}
```

### ParkingRule
```typescript
interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban';
  message: string;
  severity: 'critical' | 'warning' | 'info';
}
```

### ParkingCheckResult
```typescript
interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;       // Unix milliseconds
}
```

### NotificationData
```typescript
type NotificationType = 
  | 'parking_alert'
  | 'street_cleaning_reminder'
  | 'snow_ban_alert'
  | 'permit_reminder'
  | 'general';

interface NotificationData {
  type?: NotificationType;
  severity?: 'critical' | 'warning' | 'info';
  lat?: string;            // Latitude as string (from notification)
  lng?: string;            // Longitude as string
  checkId?: string;
  screen?: string;         // Navigation target
}
```

---

## Summary Table

| Component | Technology | Purpose | Status |
|-----------|-----------|---------|--------|
| Bluetooth Monitoring | react-native-ble-manager | Car disconnection detection | Implemented |
| Location Services | react-native-geolocation-service | GPS parking spot capture | Implemented |
| Push Notifications | firebase/messaging + notifee | Remote + local alerts | Implemented |
| Background Tasks | Manual state + AsyncStorage | Persist monitoring across restarts | Partial |
| Parking Rules API | /api/mobile/check-parking | Fetch rules for coordinates | Implemented |
| Departure Proof | /api/mobile/confirm-departure | Evidence user left spot | Implemented |
| Rate Limiting | Custom RateLimiter class | Prevent API abuse | Implemented |
| Offline Support | Local caching | Fallback when disconnected | Partial (only API cache) |
| Geofencing | None | Auto-trigger on location entry | Missing |
| Active Reconnection | Event-based only | Resume monitoring after disconnect | Partial |


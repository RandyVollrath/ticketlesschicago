# Complete Evidence Capture System Audit
## Ticketless Chicago Mobile App (iOS & Android)

**Audit Date:** March 8, 2026
**Scope:** Evidence capture for camera alerts (red light cameras + speed cameras)
**Finding:** The system captures evidence ONLY for red light cameras. Speed camera evidence is NOT captured.

---

## Executive Summary

### What IS Captured (Red Light Cameras)

The app automatically captures detailed forensic evidence when the user drives past a red light camera:

1. **GPS Trace** (last 30 seconds of movement)
   - Timestamp, latitude, longitude, speed, heading, GPS accuracy
   - Enables reconstruction of approach speed and deceleration pattern

2. **Accelerometer Data** (device motion sensors)
   - Raw acceleration/deceleration readings (gravity removed)
   - Peak deceleration G-force measurement
   - Proves vehicle braking behavior

3. **Metadata**
   - Camera address and coordinates
   - Heading (compass direction)
   - Vehicle approach speed and minimum speed during passage
   - Speed reduction calculation (approach speed - min speed)
   - Full stop detection and duration

4. **Intersection Context**
   - Posted speed limit (default 30 mph for Chicago)
   - Expected yellow light duration (Chicago vs ITE standards)
   - Deceleration rate analysis

### What is NOT Captured

- **Speed Camera Evidence**: Speeds recorded but NO evidence package generated
- **Photos/Screenshots**: No camera capture
- **Video**: No video recording
- **Audio**: No audio recording
- **Vehicle OBD data**: Not integrated
- **Video evidence from infrastructure**: No access to traffic camera feeds

---

## Data Capture Architecture

### iOS Implementation

#### Location: `/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`

**GPS Trace Recording** (lines ~2800-3000)
- CLLocationManager provides lat/lng/speed/heading/accuracy
- Trace points appended in real-time during driving
- Latest 30 seconds retained for red light receipt generation
- Timestamp: millisecond precision (UTC epoch)

**Accelerometer Sampling** (lines ~1500-1700)
```swift
struct AccelEntry {
  let timestamp: Double        // seconds since app start
  let x: Double                // user acceleration (G's, gravity removed)
  let y: Double                // forward/backward axis
  let z: Double                // vertical axis
  let gx, gy, gz: Double       // raw gravity readings
}
```

**Native Red Light Evidence Capture** (lines 3800-3900)
```swift
private func captureRedLightEvidenceNatively(
  cam: NativeCameraDef,        // camera definition
  speed: Double,               // current speed m/s
  heading: Double,             // 0-360 degrees
  accuracy: Double,            // GPS accuracy meters
  distance: Double             // distance to camera meters
)
```

**What it captures:**
- Last 30 seconds of accelerometer buffer (accelCutoff logic, line 3810)
- Peak deceleration calculation (same logic as JS, line 3823)
- Current GPS location snapshot
- Receipt ID: `{timestamp}-{lat}-{lng}`
- Approach speed (single point snapshot at alert time)
- Full GPS trace from last 30 seconds

**Payload Example:**
```swift
[
  "id": "1709894234567-41.92387-87.66849",
  "deviceTimestamp": 1709894234567,
  "cameraAddress": "2638 W Fullerton Ave",
  "cameraLatitude": 41.92387,
  "cameraLongitude": -87.66849,
  "intersectionId": "41.9239,-87.6685",
  "heading": 90,                    // compass heading (°)
  "approachSpeedMph": 32.5,         // speed at alert time
  "minSpeedMph": 32.5,              // (single point)
  "speedDeltaMph": 0,               // (single point, always 0)
  "fullStopDetected": false,        // can't detect from single GPS point
  "trace": [
    {
      "timestamp": 1709894234567,
      "latitude": 41.92385,
      "longitude": -87.66848,
      "speedMps": 14.5,
      "speedMph": 32.5,
      "heading": 90,
      "horizontalAccuracyMeters": 8.2
    }
  ],
  "accelerometerTrace": [
    {
      "timestamp": 1709894234.5,    // seconds, not ms!
      "x": -0.1234,
      "y": -0.3456,                 // negative = braking
      "z": 0.0012,
      "gx": 0.01,
      "gy": 0.99,                   // ~1G gravity
      "gz": 0.01
    },
    // ... more samples
  ],
  "peakDecelerationG": -0.456,      // peak braking force
  "expectedYellowDurationSec": 3.0,
  "postedSpeedLimitMph": 30,
  "distanceMeters": 18.5,           // distance to camera at alert
  "_capturedNatively": true,
  "_persistedAt": 1709894234.5
]
```

**Storage: UserDefaults**
- Key: `kPendingRedLightEvidenceKey` (constant not shown, likely `pending_red_light_evidence`)
- Format: Array of dictionaries
- Retention: 24-hour expiry (checked on retrieval)
- Capacity: Capped at 20 receipts (FIFO)

---

### JavaScript/React Native Layer

#### Location: `/TicketlessChicagoMobile/src/services/RedLightReceiptService.ts`

**Receipt Structure:**
```typescript
interface RedLightReceipt {
  id: string;
  deviceTimestamp: number;           // ms
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  intersectionId: string;            // "{lat.toFixed(4)},{lng.toFixed(4)}"
  heading: number;
  
  // Speed data
  approachSpeedMph: number | null;   // speed at first trace point
  minSpeedMph: number | null;        // minimum during passage
  speedDeltaMph: number | null;      // max - min
  
  // Stop detection
  fullStopDetected: boolean;
  fullStopDurationSec: number | null;
  
  // Sensor data
  horizontalAccuracyMeters: number | null;
  estimatedSpeedAccuracyMph: number | null;
  
  // Raw data
  trace: RedLightTracePoint[];
  accelerometerTrace?: AccelerometerDataPoint[];
  peakDecelerationG?: number | null;
  
  // Context
  expectedYellowDurationSec?: number;
  postedSpeedLimitMph?: number;
}
```

**Key Functions:**

1. **`buildReceipt(params)`** (lines 128-184)
   - Sorts trace points by timestamp
   - Detects full stop (≥ 0.5 mph threshold, ≥ 2 seconds duration)
   - Calculates speed delta (max - min from trace)
   - Computes peak deceleration from accelerometer
   - Yellow light timing calculation (3.0s @ ≤30 mph, 4.0s @ ≥35 mph)

2. **`addPassEvent()`** (lines 161-181)
   - Receives camera location + user location + speed + timestamps
   - Builds receipt
   - Stores to AsyncStorage locally (max 120 receipts)
   - Fire-and-forget sync to Supabase
   - Fires event: `camera-pass-history-updated`

3. **`ingestNativeEvidence()`** (lines 541-603)
   - Called when native evidence from iOS is pending
   - Validates required fields (id, cameraAddress, deviceTimestamp)
   - Deduplicates by receipt ID
   - Stores to AsyncStorage
   - Fire-and-forget sync to server

4. **`findBestMatchForTicket()`** (lines 303-383)
   - Matches red light receipts to parking violation tickets
   - Searches by timestamp (±5 min window) and location (±200m)
   - Used for contest evidence generation

5. **`exportReceiptAsPdf()`** (lines 414-461)
   - Calls `/api/evidence/red-light-receipt-pdf` endpoint
   - Passes receipt data to backend
   - Backend generates formatted PDF

**AsyncStorage Persistence:**
- Key: `RED_LIGHT_RECEIPTS` (from StorageKeys)
- Max 120 receipts (oldest pruned on addition)
- Sync to Supabase: `red_light_receipts` table

---

### Camera Pass History (ALL Cameras)

#### Location: `/TicketlessChicagoMobile/src/services/CameraPassHistoryService.ts`

**Records EVERY camera pass** (speed + red light), but minimal data:

```typescript
interface CameraPassHistoryItem {
  id: string;
  timestamp: number;                    // ms when closest approach
  alertTimestamp: number | null;        // ms when alert fired
  cameraType: 'speed' | 'redlight';
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  
  // User position at closest approach
  userLatitude: number;
  userLongitude: number;
  
  // Speed at closest approach
  userSpeedMps: number | null;
  userSpeedMph: number | null;
  
  // Speed when alert fired (may be different from closest approach)
  alertSpeedMps: number | null;
  alertSpeedMph: number | null;
  
  // Camera context
  expectedSpeedMph: number | null;
  speedDeltaMph: number | null;         // actual - posted speed
}
```

**Key Point:** This records ALL passes (speed cameras too), but stores MINIMAL data:
- No GPS trace
- No accelerometer
- No detailed deceleration
- Just: position, speed, timestamp

Synced to `camera_pass_history` Supabase table.

---

### Alert Integration

#### Location: `/TicketlessChicagoMobile/src/services/CameraAlertService.ts`

**When Red Light Alert Fires** (lines 1145-1148):
```typescript
if (camera.type === 'redlight') {
  // Fetch accelerometer data asynchronously (fire-and-forget to not block)
  this.recordRedLightReceipt(camera, tracking, now);
}
```

**`recordRedLightReceipt()`** (lines 1626-1654):
```typescript
private async recordRedLightReceipt(
  camera: CameraLocation,
  tracking: CameraPassTracking,
  now: number
): Promise<void> {
  try {
    // iOS only: fetch last 30s of accelerometer buffer from native
    const accelData = Platform.OS === 'ios'
      ? await BackgroundLocationService.getRecentAccelerometerData(30)
      : [];

    await RedLightReceiptService.addReceipt({
      cameraAddress: camera.address,
      cameraLatitude: camera.latitude,
      cameraLongitude: camera.longitude,
      heading: tracking.minHeading >= 0 ? tracking.minHeading : 0,
      trace: this.getRecentTrace(now),              // last 30s of GPS
      deviceTimestamp: tracking.minDistanceTimestamp,
      accelerometerTrace: accelData.length > 0 ? accelData : undefined,
      postedSpeedLimitMph: 30,                      // hardcoded
    });

    if (accelData.length > 0) {
      log.info(`Red light receipt recorded with ${accelData.length} accelerometer samples`);
    }
  } catch (error) {
    log.error('Failed to record red light receipt', error);
  }
}
```

**Key Issue:** Only called for red light cameras, NOT speed cameras.

---

## Backend PDF Generation

#### Location: `/pages/api/evidence/red-light-receipt-pdf.ts`

**Endpoint:** `POST /api/evidence/red-light-receipt-pdf`

**Input:**
```typescript
{
  receiptId?: string,        // fetch from DB if provided
  receipt?: RedLightReceipt  // or use provided receipt (mobile upload)
}
```

**Authentication:** Bearer token required (Supabase auth)

**PDF Sections Generated:**

1. **Header** (lines 203-236)
   - Title: "Red Light Camera Evidence Receipt"
   - Receipt ID, capture timestamp, generation timestamp

2. **Intersection Details** (lines 238-277)
   - Camera location (address + coordinates)
   - Heading (compass direction)
   - Posted speed limit
   - GPS accuracy

3. **Vehicle Behavior Summary** (lines 279-330)
   - Approach speed (mph)
   - Minimum speed during passage
   - Speed reduction (Δ speed)
   - Full stop detected? (YES/NO)
   - Full stop duration (if detected)
   - Peak braking force (G's) from accelerometer

4. **Speed Profile Chart** (lines 332-407)
   - Line graph of speed over time
   - X-axis: elapsed time (seconds)
   - Y-axis: speed (mph)
   - Stop threshold line at 0.5 mph

5. **Accelerometer Evidence** (lines 409-481)
   - Line graph of G-force over time
   - Positive = acceleration, negative = braking
   - Peak deceleration annotation

6. **Yellow Light Analysis** (lines 483-533)
   - Chicago standard yellow duration at posted speed
   - ITE recommended yellow (1.0 + v/(2 * 10) formula)
   - Comparison showing if Chicago is shorter than standard
   - Legal note about Illinois law requiring national standards

7. **Raw GPS Trace Table** (lines 535-611)
   - Sampled to 30 rows for readability
   - Columns: elapsed time, speed, latitude, longitude, heading, GPS accuracy
   - Alternating row shading

8. **Footer** (lines 613-645)
   - Legal disclaimer: "automatically generated using GPS and device motion sensors"
   - All data captured in real-time
   - GPS provided by OS, accelerometer by motion coprocessor
   - Link to autopilotamerica.com

**Output:** PDF binary (application/pdf)
**Filename:** `red-light-evidence-{receiptId}.pdf`

---

## Database Schema

### `red_light_receipts` Table
```sql
- id (UUID, primary key)
- user_id (foreign key to auth.users)
- device_timestamp (timestamp when camera was passed)
- camera_address (text)
- camera_latitude (numeric)
- camera_longitude (numeric)
- intersection_id (text, "{lat},{lng}")
- heading (numeric, 0-360°)

-- Speed metrics
- approach_speed_mph (numeric, null allowed)
- min_speed_mph (numeric, null allowed)
- speed_delta_mph (numeric, null allowed)

-- Stop detection
- full_stop_detected (boolean)
- full_stop_duration_sec (numeric, null allowed)

-- Sensor data
- horizontal_accuracy_meters (numeric, null allowed)
- estimated_speed_accuracy_mph (numeric, null allowed)
- trace (jsonb array of GPS points)
- accelerometer_trace (jsonb array of accel samples)
- peak_deceleration_g (numeric, null allowed)

-- Context
- expected_yellow_duration_sec (numeric, null allowed)
- posted_speed_limit_mph (numeric, null allowed)

- created_at (timestamp, server-side)
- updated_at (timestamp, server-side)
```

### `camera_pass_history` Table
```sql
- id (bigint, primary key)
- user_id (foreign key)
- passed_at (timestamp when closest to camera)
- camera_type ('speed' | 'redlight')
- camera_address (text)
- camera_latitude (numeric)
- camera_longitude (numeric)
- user_latitude (numeric, position at closest approach)
- user_longitude (numeric)
- user_speed_mps (numeric, null allowed)
- user_speed_mph (numeric, null allowed)
- alert_speed_mps (numeric, null allowed, speed when alert fired)
- alert_speed_mph (numeric, null allowed)
- alerted_at (timestamp, when alert fired)
- expected_speed_mph (numeric, null allowed)
- speed_delta_mph (numeric, null allowed, actual - posted)
- created_at (timestamp, server-side)
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    RED LIGHT CAMERA ALERT                       │
└─────────────────────────────────────────────────────────────────┘

iOS CLLocationManager
    ├─ GPS updates → onLocationUpdate()
    │    └─ lat, lng, speed, heading, accuracy
    │
    └─ Accelerometer → accelBuffer (ring buffer, last 30s)
         └─ {x, y, z, gx, gy, gz} raw motion data

                    ↓

       CameraAlertService.onLocationUpdate()
       (JavaScript layer)
           ├─ Find nearby cameras (bounding box + distance)
           │
           ├─ Filter by heading & bearing
           │
           ├─ If REDLIGHT camera & close enough:
           │    └─ recordRedLightReceipt()
           │         ├─ Fetch accelerometer buffer from native
           │         ├─ Get last 30s GPS trace
           │         └─ RedLightReceiptService.addReceipt()
           │
           └─ CameraPassHistoryService.addPassEvent()
                (logs ALL passes, minimal data)

                    ↓

       RedLightReceiptService.addReceipt()
       (JavaScript layer)
           ├─ Build receipt object with all metrics
           │    ├─ GPS trace points
           │    ├─ Accelerometer trace
           │    ├─ Peak deceleration
           │    ├─ Stop detection
           │    └─ Yellow light context
           │
           ├─ Store to AsyncStorage (max 120)
           │
           └─ Fire-and-forget sync to Supabase
                └─ red_light_receipts table

                    ↓ (user initiates)

       RedLightReceiptService.exportReceiptAsPdf()
       (JavaScript layer)
           └─ POST /api/evidence/red-light-receipt-pdf
                ├─ Authentication: Bearer token
                │
                └─ Backend generates PDF
                     ├─ Intersection details
                     ├─ Speed profile chart
                     ├─ Accelerometer chart
                     ├─ Yellow light analysis
                     ├─ Raw GPS trace table
                     └─ Legal disclaimers

                    ↓

       User downloads PDF (user-initiated via web dashboard)
       PDF contains: GPS trace, accelerometer proof, deceleration, stop duration
```

---

## Speed Cameras: Minimal Evidence

**What is captured:**
- Position at closest approach (lat/lng)
- Speed at closest approach (m/s and mph)
- Timestamp of closest approach
- Alert speed (if alert was fired)
- Speed delta (actual - posted limit)

**What is NOT captured for speed cameras:**
- GPS trace (series of points showing approach)
- Accelerometer data
- Full deceleration pattern
- Stop detection
- Yellow light analysis (irrelevant for speed cameras anyway)

**Stored in:** `camera_pass_history` table ONLY
- No dedicated `speed_camera_receipts` table
- No evidence PDF generation
- No detailed forensic data

---

## Evidence Completeness Assessment

### Red Light Cameras ✓ Comprehensive

| Data Point | Captured | Source | Detail |
|---|---|---|---|
| GPS Position | ✓ | CLLocationManager | Lat/lng at multiple points (30s trace) |
| GPS Accuracy | ✓ | CLLocationManager.horizontalAccuracy | Meters, per-point |
| Speed | ✓ | CLLocationManager.speed | m/s, converted to mph |
| Heading | ✓ | CLLocationManager.course | 0-360°, compass direction |
| Timestamp | ✓ | Device clock (UTC) | Millisecond precision |
| Deceleration | ✓ | CMMotionActivityManager + filters | Accelerometer G-forces |
| Stop Duration | ✓ | GPS trace analysis | Seconds at ≤0.5 mph |
| Peak Braking | ✓ | Accelerometer math | Calculated from X, Y mag |
| Yellow Timing | ✓ | Posted speed lookup | 3.0s or 4.0s per Chicago rules |
| Photos | ✗ | — | Not captured |
| Video | ✗ | — | Not captured |
| Audio | ✗ | — | Not captured |
| Ticket Photo | ✗ | — | No access to citation images |

### Speed Cameras ✗ Minimal

| Data Point | Captured | Source | Detail |
|---|---|---|---|
| GPS Position | ✓ | CLLocationManager | Single closest approach point only |
| Speed | ✓ | CLLocationManager | At closest approach only |
| GPS Trace | ✗ | — | No series of points |
| Accelerometer | ✗ | — | Not recorded |
| Heading | ✓ | CLLocationManager | At closest approach |
| Timestamp | ✓ | Device clock | At closest approach |
| Speed Delta | ✓ | Calculated | Actual - posted |
| Stop Duration | ✗ | — | Not detected |
| Deceleration | ✗ | — | Not measured |
| Photos | ✗ | — | Not captured |

---

## Key Limitations

### Architectural

1. **Red Light Evidence Only**
   - Speed camera evidence is metadata-only (pass history)
   - No justification in code comments for this design choice
   - Speed receipts may be added in future, but not implemented

2. **Single-Point Speed Measurement**
   - Speed is a snapshot at alert time or closest approach
   - No speed trend over approach (is user accelerating or decelerating?)
   - Makes it harder to prove driver was reducing speed

3. **No Vehicle State Evidence**
   - Can't prove brake lights activated (no brake sensor)
   - Can't prove turn signal used (no CAN bus access)
   - Can't prove throttle position (no OBD data)

4. **GPS Accuracy Limitations**
   - Horizontal accuracy ±5-15m typical (can be ±30-50m in urban canyon)
   - May not precisely place vehicle at intersection center
   - Especially problematic for narrow streets with cameras

5. **Accelerometer Timestamp Mismatch**
   - Swift samples: seconds since app start (continuous, floating-point)
   - GPS trace: UTC milliseconds (epoch-based)
   - JS layer may have timing alignment issues when merging datasets

6. **Fixed Assumptions**
   - Posted speed always 30 mph for Chicago (hardcoded, line 1645 CameraAlertService.ts)
   - No actual speed limit lookup by intersection ID
   - Yellow light timing based only on speed, not actual signal state

### Operational

1. **iOS-Only Accelerometer**
   - Line 1633-1634: `Platform.OS === 'ios' ? BackgroundLocationService.getRecentAccelerometerData(30) : []`
   - Android receives empty accelerometer data
   - Android speed camera evidence even more minimal

2. **30-Second Window Hard-Limit**
   - If alert fires >30s into approach, early acceleration data lost
   - Accelerometer buffer circular; older samples discarded

3. **No Evidence for Historical Tickets**
   - System only captures evidence prospectively (from alert time onward)
   - Can't retroactively generate evidence for tickets issued before app installation
   - User can't prove speed after-the-fact without real-time recording

4. **Accelerometer Sampling Rate Unknown**
   - CMMotionActivityManager rate not specified in code
   - iOS default ~50Hz, but may vary by device
   - Could create gaps in deceleration pattern

5. **No Integration with Ticket Image**
   - Can't cross-reference receipt with actual violation photo/video from camera
   - Evidence package standalone, not linked to violation evidence

---

## Security & Privacy

### What's Stored Locally
- AsyncStorage: Red light receipts (plaintext JSON)
- UserDefaults (iOS): Pending native evidence (plaintext)
- Device motion sensors: Accelerometer buffer (processed, user acceleration only)

### What's Sent to Server
- Supabase: Full red light receipts + GPS traces + accelerometer data
- PDF API: Receipt data (authentication required)

### What's NOT Captured
- No eavesdropping on other users
- No location history beyond app's own GPS
- No biometric data
- No financial data

### Concerns
- Accelerometer data on iOS is relatively raw (gravity already removed, but still sensitive)
- GPS trail could be used to reconstruct full driving routes if subpoenaed
- Long retention (120 receipts, 24-hour expiry on native buffer) could accumulate evidence

---

## Code Quality Assessment

### Strengths
- **Separation of concerns**: Native capture, JS receipt building, server PDF generation
- **Fire-and-forget sync**: Doesn't block user interaction
- **Deduplication**: Native evidence checked before ingestion
- **Type safety**: TypeScript interfaces for all major data structures
- **Fallback handling**: Graceful degradation if accelerometer unavailable
- **Test compliance**: App Store 2.5.4 compliance (background TTS disabled)

### Weaknesses
- **Hardcoded assumptions**: Speed limit always 30 mph (line 1645)
- **No validation**: Receipt fields not validated before storage
- **Silent failures**: Sync errors logged but not surfaced to user
- **Timestamp confusion**: Accelerometer uses seconds, GPS uses ms
- **Android incomplete**: No accelerometer on Android (silent empty array)
- **Missing indexing**: Supabase queries by timestamp; DB should have index

---

## Recommendations for Legal Use

### What This Evidence PROVES
1. Vehicle was at specific GPS coordinates at specific time
2. Vehicle speed at those coordinates (within ±GPS accuracy)
3. Vehicle decelerated (if accelerometer shows negative G-force)
4. Vehicle stopped (if GPS speed ≤0.5 mph for ≥2 seconds)
5. Deceleration magnitude (peak G-force in braking event)

### What This Evidence DOES NOT PROVE
1. Vehicle ran a red light (no signal state captured)
2. Vehicle exceeded speed limit (speed measured at closest approach, not throughout approach)
3. Driver intentionally violated law (could be emergency situation, mechanical issue)
4. Driver saw the camera (no awareness captured)
5. Conditions of violation matching ticket image (no comparison)

### For Contest Strategy
- Red light evidence: Strong (shows deceleration, possible stop, timing context)
- Speed evidence: Weak (single speed point, no trend, no vehicle state)
- Yellow light timing: Useful context (proves if yellow was shorter than standard)
- Best combined with: Ticket photo analysis, traffic signal timing records, intersection rules

---

## Files Involved

| File | LOC | Purpose |
|---|---|---|
| BackgroundLocationModule.swift | ~4500 | Native iOS location/motion/camera detection |
| CameraAlertService.ts | ~1730 | JS camera alert orchestration |
| RedLightReceiptService.ts | ~607 | Red light receipt building & storage |
| CameraPassHistoryService.ts | ~194 | All camera passes logging |
| red-light-receipt-pdf.ts | ~690 | PDF generation endpoint |

**Total Evidence System:** ~7,700 lines of code

---

## Summary Table

| Aspect | Red Light | Speed |
|---|---|---|
| **Evidence Captured** | Comprehensive | Minimal |
| **GPS Trace** | 30s history | Single point |
| **Accelerometer** | Yes (iOS) | No |
| **Stop Detection** | Yes | No |
| **Peak Braking** | Yes (G-force) | No |
| **Yellow Timing** | Yes (context) | N/A |
| **PDF Generation** | Yes | No |
| **Server Sync** | Yes | Yes (minimal) |
| **Storage** | AsyncStorage + DB | DB only |
| **Retention** | Indefinite | Indefinite |
| **Android Support** | Partial (no accel) | Partial (no accel) |
| **Usefulness for Contest** | High | Low |

---

**End of Audit**

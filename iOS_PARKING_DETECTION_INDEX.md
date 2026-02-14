# iOS Parking Detection System - Complete Documentation

## Overview

This directory contains comprehensive analysis of the iOS parking detection system in the Ticketless Chicago mobile app.

## Documents

### 1. iOS_PARKING_DETECTION_FLOW.md (Main Reference)
**The complete technical analysis** - 493 lines, 23KB

Answers all five key questions with detailed code analysis:
- Q1: How the driving → parking transition is detected (CoreMotion activity monitoring)
- Q2: When and how GPS locations are captured (3 strategic snapshots)
- Q3: The "Check My Parking" button and its interaction with automatic detection
- Q4: How stale/cached locations are prevented
- Q5: How BackgroundLocationModule and MotionActivityModule work together

Contains:
- Executive summary
- Question-by-question analysis with inline code snippets
- Integration flow diagram
- Architecture explanation
- Critical code locations reference table
- Answer summary

**Start here for understanding the complete flow**

### 2. iOS_PARKING_DETECTION_FILE_REFERENCE.md (Navigation Guide)
**The roadmap for finding code** - 310 lines, 14KB

Organized by file with line numbers for quick navigation:
- All absolute file paths
- Line-by-line breakdown of each file's sections
- Key variable tracking table
- Data flow diagram with specific line references
- Service initialization chain
- Tier-based file organization

**Use this to jump to specific code sections**

## Key Findings

### The Short Answer

**How does iOS avoid the stale location problem?**

1. **CoreMotion detects the parking moment** - When the user transitions from `automotive` to `stationary/walking` activity
2. **GPS location is captured at that exact moment** - Not from cache or "Check My Parking" presses
3. **Location is passed through the app** - Native module sends pre-captured coordinates to JavaScript
4. **JavaScript uses the pre-captured location** - Bypasses any caches and API result caching
5. **Fallbacks exist** - But are only used if pre-captured location isn't available (rare cases)

### Files You Need to Know

| File | Purpose | Why It Matters |
|------|---------|----------------|
| `BackgroundLocationModule.swift` | Core iOS logic | Captures location at parking moment |
| `BackgroundTaskService.ts` | Coordinates everything | Receives pre-captured coordinates from Swift |
| `LocationService.ts` | Makes API calls | Has 30s cache but only for duplicate checks |
| `HomeScreen.tsx` | "Check My Parking" button | Completely separate from automatic detection |

### Location Capture Strategy (Priority Order)

```
PRIMARY (iOS): locationAtStopStart
  └─ Captured when CoreMotion detects user exited car
  └─ Most accurate, happens before user walks away

SECONDARY: lastDrivingLocation
  └─ Last GPS update while car was in motion
  └─ Very good accuracy, includes slow creep into spot

TERTIARY: Current GPS
  └─ Only if above two failed
  └─ May be old if app was backgrounded

FALLBACK (Android only): Cached location
  └─ Only if GPS acquisition fails
  └─ Used as last resort before giving up
```

### "Check My Parking" Button Impact

**ZERO impact on automatic detection**

- Gets fresh GPS coordinates RIGHT NOW (not cached)
- Uses a separate code path in HomeScreen.tsx
- Has 30s API cache only for duplicate checks
- Does NOT affect the parking location used by automatic detection
- Automatic detection always uses pre-captured `locationAtStopStart` from Swift

## Architecture Overview

```
TIER 1: NATIVE (Swift)
├─ BackgroundLocationModule.swift
│  └─ Monitors CoreMotion & GPS
│  └─ Captures location at parking moment
│  └─ Sends event to JS with pre-captured coordinates
│
TIER 2: ORCHESTRATION (TypeScript)
├─ BackgroundTaskService.ts
│  └─ Receives parking event from native
│  └─ Uses pre-captured location if available
│  └─ Falls back to GPS strategies if needed
│  └─ Makes API call to check parking rules
│
TIER 3: UI (React Native)
├─ HomeScreen.tsx
│  └─ Manual "Check My Parking" button (separate system)
│  └─ Shows driving state based on CoreMotion
│  └─ Starts automatic monitoring on app load
```

## Core Components

### 1. Driving Detection
- **Trigger**: `CMMotionActivity.automotive == true`
- **Location**: BackgroundLocationModule.swift lines 230-253
- **Result**: Sets `isDriving = true`, starts continuous GPS

### 2. Parking Detection
- **Trigger**: `CMMotionActivity.stationary || walking` (confidence >= medium)
- **Location**: BackgroundLocationModule.swift lines 255-275
- **Result**: Snapshots location, starts 5-second debounce

### 3. Location Capture
- **Continuous**: Updated at every GPS update while driving (lines 294-299)
- **At Stop**: Snapshotted when CoreMotion says stopped (line 268)
- **Confirmed**: Selected from 3 priority options (line 459)

### 4. Event Emission
- **When**: After 5-second debounce confirms parking (line 437)
- **What**: Includes lat/lng, accuracy, source, drift distance
- **Where**: Sent via RCTEventEmitter to JavaScript

### 5. JavaScript Handling
- **Receives**: Event from BackgroundLocationModule
- **Uses**: Pre-captured coordinates (presetCoords)
- **Falls Back**: To GPS strategies if not available
- **Calls**: `/api/mobile/check-parking` with coordinates

## Testing & Debugging

### Debug Features (HomeScreen.tsx)
- Triple-tap the "Autopilot" title to show iOS debug overlay
- Displays:
  - Current CoreMotion activity (automotive/stationary/walking)
  - GPS speed and accuracy
  - Activity transitions log
  - Background status (monitoring, driving state, permissions)

### Key Debug Values
- `currentActivity`: Should show "automotive" while driving
- `currentActivity`: Should change to "stationary" or "walking" when you stop
- `debugSpeed`: Shows m/s (multiply by 2.237 for mph)
- `debugBgStatus`: Shows monitoring/driving/permission/CoreMotion status

## Related Systems

### Android Difference
- Uses Bluetooth connection monitoring instead of CoreMotion
- Requires manual car pairing in Settings
- Still uses pre-captured location but from last driving location

### Fallback System
- If BackgroundLocationModule isn't available, falls back to MotionActivityService
- Less reliable in background but works
- Requires additional GPS acquisition on parking event

## Links to Documentation

- **Main Flow**: See iOS_PARKING_DETECTION_FLOW.md
- **File Navigation**: See iOS_PARKING_DETECTION_FILE_REFERENCE.md
- **Code Comments**: See actual Swift/TypeScript files with line references above

## Quick Reference: Line Numbers

| What | File | Lines |
|------|------|-------|
| Driving detection | BackgroundLocationModule.swift | 230-253 |
| Parking detection | BackgroundLocationModule.swift | 255-275 |
| Location snapshot | BackgroundLocationModule.swift | 267-269 |
| GPS updates | BackgroundLocationModule.swift | 282-334 |
| Parking confirmation | BackgroundLocationModule.swift | 441-503 |
| Location priority | BackgroundLocationModule.swift | 456-470 |
| Event handling | BackgroundTaskService.ts | 262-281 |
| Pre-captured coords | BackgroundTaskService.ts | 517-520 |
| Manual button | HomeScreen.tsx | 368-423 |
| Auto-monitor init | HomeScreen.tsx | 312-334 |

## Questions Answered

All five original questions are fully answered in iOS_PARKING_DETECTION_FLOW.md:

1. ✓ How does the app detect the transition from driving to walking?
2. ✓ When and how does it capture the GPS location for the "parked" location?
3. ✓ What is the "Check My Parking" button and how does it interact with automatic detection?
4. ✓ Is there logic that might cause stale/cached location issues?
5. ✓ How do BackgroundLocationModule and MotionActivityModule work together?

---

Generated: 2025-02-01
Updated: Complete technical analysis with code paths and line numbers

# Location Services Research: Ticketless Chicago

## Executive Summary

This project implements location-based parking restriction detection across two platforms:
- **Mobile App (React Native)**: GPS-first approach with sophisticated burst sampling
- **Web App (Next.js)**: Mixed geocoding approach with interactive maps

**Key Finding**: No address autocomplete is implemented anywhere, despite Google Maps API being available.

---

## Mobile App: GPS-First Architecture

### Geolocation Library
- **Primary**: `react-native-geolocation-service` ^5.3.1
- **Provider**: Native iOS/Android GPS
- **No Maps**: Uses WebView for map visualization

### LocationService.ts (1,180 lines)

The core location handling is exceptionally sophisticated:

#### GPS Burst Sampling
- Collects up to 8 GPS readings over ~10 seconds when car parks
- Filters samples with accuracy > 100m
- Intelligent outlier removal using:
  - Median position calculation
  - Haversine distance filtering (removes samples >50m from median)
  - Inverse variance weighting for accuracy-weighted averaging

#### Confidence Tiers
```
HIGH:     accuracy ≤ 15m AND spread ≤ 10m AND samples ≥ 3
MEDIUM:   accuracy ≤ 30m AND spread ≤ 25m AND samples ≥ 2
LOW:      accuracy ≤ 75m
VERY_LOW: anything else
```

#### Key Methods
1. `getCurrentLocation(accuracy, forceNoCache)` - Single GPS read
2. `getHighAccuracyLocation(targetAccuracy, maxWait)` - Wait for stable fix
3. `getParkingLocation()` - Burst sample with 10-second timeout
4. `processBurstSamples(samples)` - Outlier filter + averaging
5. `checkParkingLocation(coords)` - Call backend parking checker

### Address Input: CheckDestinationScreen.tsx

```
User Types Address
    ↓
GET /api/find-section?address={text}
    ↓
Google Geocoding API (backend)
    ↓
Return: coordinates + ward + section + street cleaning date
    ↓
Display restrictions in UI + WebView map
```

**No autocomplete** - manual text input only

### Parking Detection Flow

Triggered by Bluetooth disconnect (car parks):

```
BT Disconnect
    ↓
BackgroundTaskService.onBluetoothStateChange()
    ↓
LocationService.getParkingLocation()
    ↓
Burst sample 8 GPS readings
    ↓
POST /api/mobile/check-parking
    {lat, lng, accuracy, confidence}
    ↓
Unified Parking Checker
    ↓
Check: street cleaning, winter ban, snow route, permit zones
    ↓
Save location locally + trigger notification
    ↓
POST /api/mobile/save-parked-location
    (for server-side cron reminders)
```

---

## Web App: Mixed Geocoding

### Map Library
- **Leaflet.js** ^1.9.4
- **React-Leaflet** ^4.2.1
- Features: marker clustering, heatmaps, interactive zoom/pan

### Address Geocoding: Two Approaches

#### 1. Nominatim (Free, Client-Side)
Used in: `block-grade.tsx`, `neighborhoods.tsx`

```typescript
const response = await fetch(
  `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`
);
// Returns: lat, lng, display_name
```

Validation: Chicago bounds (lat: 41.6-42.1, lng: -88.0 to -87.5)

**Pros**: Free, no API key
**Cons**: Rate limited, less accurate, less reliable

#### 2. Google Maps Geocoding API (Paid, Server-Side)
Used in: `/api/find-section.ts`

```typescript
const geocodeUrl = 
  `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${GOOGLE_API_KEY}`;
```

Features:
- Retry logic (up to 2 retries on OVER_QUERY_LIMIT)
- Chicago bounds validation via address components
- Returns: coordinates + ward + section + cleaning schedule

**Pros**: Accurate, reliable
**Cons**: Costs money per request

### Web Pages Using Location

| Page | Geocoding | Purpose |
|------|-----------|---------|
| `neighborhoods.tsx` | Nominatim (client) | Neighborhood crime/safety scores |
| `block-grade.tsx` | Nominatim (client) | Same as neighborhoods |
| `parking-map.tsx` | N/A | Display map with parking data |
| `ticket-heatmap.tsx` | N/A | Heatmap visualization |
| `destination-map.tsx` | N/A | Server-renders map for mobile WebView |

---

## Backend API Routes

### 1. `/api/find-section.ts`
- **Input**: `address` (query parameter)
- **Geocoding**: Google Maps API
- **Output**: coordinates, ward, section, nextCleaningDate, winterBan status, snowRoute status
- **Used By**: Mobile CheckDestinationScreen, any address-based lookup
- **Error Handling**: Retries on rate limit, validates Chicago bounds

### 2. `/api/check-permit-zone.ts`
- **Input**: `address` (query or POST)
- **Method**: Address parsing (NO geocoding)
- **Parsing**: Extracts {number, direction, street name, type}
- **Lookup**: Database query against `parking_permit_zones` table
- **Output**: Zone number, status, ward
- **Used By**: Mobile app, web tools

### 3. `/api/mobile/check-parking.ts`
- **Input**: latitude, longitude, accuracy, confidence
- **Method**: Unified parking checker (NO geocoding)
- **Output**: street cleaning, winter ban, 2" snow ban, permit zones
- **Special**: Includes "location snap" metadata if GPS snapped to street

### 4. Other Geocoding Routes
- `/api/la-street-sweeping.ts` - Uses Google Maps Geocoding (LA-specific)
- `/api/snow-forecast.ts` - Takes coordinates, no geocoding
- Various `/api/neighborhood/*` endpoints - Take coordinates, no geocoding

---

## Current Status: Google Maps Integration

### USED
- Geocoding API for address → coordinates (server-side only)
- Integration in `find-section.ts` with rate limiting

### NOT USED
- Places API (no autocomplete suggestions)
- Maps JavaScript API (client-side maps)
- Reverse Geocoding (beyond basic PostGIS queries)

### Cost Impact
- Paying per Geocoding API request from find-section.ts
- No cost for Nominatim (free tier has limits)

---

## Architecture Comparison

| Feature | Mobile | Web |
|---------|--------|-----|
| **Geolocation** | Native GPS | N/A |
| **GPS Accuracy** | Burst sampling (8 readings) | N/A |
| **Geocoding Method** | Google (server) | Nominatim (client) + Google (server) |
| **Autocomplete** | NO | NO |
| **Map Library** | WebView | Leaflet.js |
| **Map Interactivity** | Read-only | Full (zoom, pan, cluster, heatmap) |
| **Reverse Geocoding** | Display only | PostGIS queries |

---

## Missing Features

### 1. Address Autocomplete
**Impact**: High friction for users entering addresses
**Solution Options**:
- Google Places Autocomplete API
- Mapbox Places (better free tier)
- Algolia Places (free)
- Nominatim direct API with frontend debouncing

### 2. Mobile Map Integration
**Current**: WebView (no interaction)
**Better**: `react-native-maps` or `react-native-mapbox-gl`

### 3. Reverse Geocoding Cache
**Current**: Called on-demand
**Better**: Cache results for GPS coordinates to reduce API calls

### 4. "Near Me" Parking Search
**Current**: Manual address only
**Missing**: "Find restrictions near my current location"

---

## Detailed File Locations

### Mobile App
- **LocationService.ts**: `/TicketlessChicagoMobile/src/services/LocationService.ts`
- **CheckDestinationScreen.tsx**: `/TicketlessChicagoMobile/src/screens/CheckDestinationScreen.tsx`
- **MapScreen.tsx**: `/TicketlessChicagoMobile/src/screens/MapScreen.tsx`
- **package.json**: `/TicketlessChicagoMobile/package.json`

### Web App - API Routes
- **find-section.ts**: `/pages/api/find-section.ts`
- **check-permit-zone.ts**: `/pages/api/check-permit-zone.ts`
- **mobile/check-parking.ts**: `/pages/api/mobile/check-parking.ts`

### Web App - Pages
- **neighborhoods.tsx**: `/pages/neighborhoods.tsx` (line 645: geocodeAddress)
- **block-grade.tsx**: `/pages/block-grade.tsx` (line 58: geocodeAndFetch)
- **parking-map.tsx**: `/pages/parking-map.tsx`
- **ticket-heatmap.tsx**: `/pages/ticket-heatmap.tsx`

### Web App - Package Dependencies
- **package.json**: `/package.json` (lines 43-45 for map libraries)

---

## Environment Variables

### Required for Backend
```
GOOGLE_API_KEY              # Google Maps Geocoding API
MSC_SUPABASE_URL           # MyStreetCleaning database URL
MSC_SUPABASE_ANON_KEY      # MyStreetCleaning API key
SUPABASE_URL               # Main Supabase project
SUPABASE_ANON_KEY          # Main Supabase key
```

### Mobile App
- All secrets handled server-side
- No embedded API keys

---

## Recommendations

### Priority 1: Address Autocomplete
Add Google Places Autocomplete to mobile CheckDestinationScreen:
```typescript
import { GooglePlacesInput } from '@react-native-google-places-sdk';
// Suggests addresses as user types
// Reduces need for exact address match
```

### Priority 2: Map Improvements
Replace WebView with native map library:
```typescript
import MapView from 'react-native-maps';
// Better UX than WebView
// Native interactions
// Can display restrictions overlay
```

### Priority 3: Caching Strategy
Cache reverse geocoding results:
```typescript
// Store: {lat,lng} → address mapping
// Lifetime: 1 day
// Reduces Geocoding API calls
```

### Priority 4: Fallback Strategy
Implement Nominatim fallback:
```typescript
// Try Google Maps API
// If rate limited or fails: use Nominatim
// Ensures service availability
```

### Priority 5: Validation
Add address validation before API calls:
```typescript
// Check address format before geocoding
// Reduce failed API calls
// Better UX feedback
```

---

## Conclusion

The project has a well-implemented GPS location system on mobile with sophisticated burst sampling and outlier filtering. The web app uses interactive maps effectively.

However, the **lack of address autocomplete** is a significant UX gap that could be addressed with minimal engineering effort. Google's Places API is already available, so integration would be straightforward.

The current geocoding approach (split between Nominatim for web, Google API for backend) is workable but inconsistent. A unified approach with Nominatim as fallback would simplify architecture.

Overall, the location services foundation is solid. Improvements would focus on user experience and cost optimization.

# Location Research - Complete Index

This research covers geolocation, address input, and location search across Ticketless Chicago's React Native mobile app and Next.js web app.

## Quick Navigation

### Primary Research Document
- **LOCATION_RESEARCH.md** - Main findings, architecture, and recommendations
  - 322 lines of comprehensive analysis
  - Executive summary
  - Detailed file locations
  - Architecture comparison tables

## Key Findings at a Glance

### Mobile App (React Native)
- **Geolocation Library**: `react-native-geolocation-service`
- **GPS Innovation**: Burst sampling with 8 readings, outlier filtering, confidence tiers
- **Address Input**: Manual text only (CheckDestinationScreen.tsx)
- **Geocoding**: Google Maps API via backend `/api/find-section`
- **Maps**: WebView (read-only, server-rendered)
- **Status**: Sophisticated GPS system, room for UX improvement

### Web App (Next.js)
- **Maps Library**: Leaflet.js + React-Leaflet
- **Geocoding**: Nominatim (free, client) + Google API (paid, server)
- **Address Input**: Manual text only
- **Autocomplete**: Not implemented
- **Status**: Good interactive maps, need consistency in geocoding

### Google Maps API
- **INTEGRATED**: Geocoding only (find-section.ts)
- **NOT USED**: Places API (no autocomplete), Maps JavaScript API
- **OPPORTUNITY**: Places Autocomplete would improve UX significantly

## Critical Code Files

### Mobile App
1. **LocationService.ts** (1,180 lines)
   - Core GPS handling
   - Burst sampling algorithm
   - Parking detection logic
   - Path: `TicketlessChicagoMobile/src/services/LocationService.ts`

2. **CheckDestinationScreen.tsx** (787 lines)
   - Manual address input
   - Calls /api/find-section
   - Displays restrictions
   - Path: `TicketlessChicagoMobile/src/screens/CheckDestinationScreen.tsx`

3. **MapScreen.tsx** (705 lines)
   - Shows last parked location
   - Save current location button
   - Path: `TicketlessChicagoMobile/src/screens/MapScreen.tsx`

### Backend APIs
1. **find-section.ts**
   - Google Geocoding API integration
   - Rate limiting, retry logic
   - Path: `pages/api/find-section.ts`

2. **check-permit-zone.ts**
   - Address parsing (no geocoding)
   - Database lookup
   - Path: `pages/api/check-permit-zone.ts`

3. **mobile/check-parking.ts**
   - Takes coordinates only
   - Unified parking checker
   - Path: `pages/api/mobile/check-parking.ts`

### Web App Pages
1. **block-grade.tsx** - Nominatim geocoding + neighborhood data
2. **neighborhoods.tsx** - Same as block-grade (different UI)
3. **parking-map.tsx** - Leaflet map display
4. **ticket-heatmap.tsx** - Heatmap visualization
5. **destination-map.tsx** - Server-renders for mobile WebView

## Data Flow Diagrams

### Mobile Address Lookup
```
User enters address
        ↓
CheckDestinationScreen.tsx
        ↓
GET /api/find-section?address={text}
        ↓
Server: Google Geocoding API
        ↓
Return: lat, lng, ward, section, restrictions
        ↓
Display in UI + WebView map
```

### Mobile GPS Parking Detection
```
Car parks (BT disconnect)
        ↓
getParkingLocation() - burst sample
        ↓
8 GPS readings over 10 seconds
        ↓
Filter outliers (>50m from median)
        ↓
Accuracy-weighted average
        ↓
Compute confidence tier
        ↓
POST /api/mobile/check-parking
        ↓
Unified checker (4 restriction types)
        ↓
Local notification + server save
```

### Web Address Lookup
```
User enters address (neighborhoods.tsx)
        ↓
Client: Nominatim geocoding
        ↓
Validate Chicago bounds
        ↓
GET /api/neighborhood/crimes, crashes, etc.
        ↓
Display in Leaflet map
```

## Implementation Summary

### What's Working Well
1. **Mobile GPS accuracy** - Sophisticated burst sampling with outlier filtering
2. **Backend geocoding** - Google API with proper error handling
3. **Web maps** - Leaflet provides good interactive experience
4. **Parallel API calls** - Mobile app optimizes with Promise.all()
5. **Permission handling** - Proper Android/iOS permission flows

### What's Missing
1. **Address autocomplete** - No suggestions as user types
2. **Mobile maps** - WebView is read-only, not interactive
3. **Geocoding consistency** - Different methods (Nominatim vs Google) in different places
4. **Caching** - No reverse geocoding results cache
5. **Fallback strategy** - No graceful handling when Google API fails

## Architecture Overview

```
┌────────────────────────────────────────┐
│      TICKETLESS CHICAGO                │
├────────────────────────────────────────┤
│  MOBILE                    │  WEB      │
├────────────────────────────┼───────────┤
│ GPS Burst Sampling         │ Leaflet   │
│ LocationService.ts         │ Maps      │
│                            │           │
│ CheckDestinationScreen     │ block-    │
│ (manual address)           │ grade.tsx │
│                            │ (Nominat) │
└────────────────────────────┴───────────┘
             ↓ API Calls ↓
┌────────────────────────────────────────┐
│      BACKEND APIS                      │
├────────────────────────────────────────┤
│ find-section      (Google Geocoding)   │
│ check-permit-zone (Address parsing)    │
│ check-parking     (Unified checker)    │
└────────────────────────────────────────┘
             ↓ Database Queries ↓
┌────────────────────────────────────────┐
│      CHICAGO DATA                      │
├────────────────────────────────────────┤
│ Street Cleaning Schedule (by ward)     │
│ Permit Zones                           │
│ Winter Ban Streets                     │
│ Snow Routes                            │
│ Tow Zones                              │
└────────────────────────────────────────┘
```

## Top Recommendations

### High Priority
1. **Add Places Autocomplete** to mobile CheckDestinationScreen
   - Users won't need exact address
   - Reduce typos
   - Better UX

2. **Replace WebView maps** with react-native-maps
   - Interactive mobile experience
   - Can overlay restriction zones
   - Native performance

### Medium Priority
3. **Implement reverse geocoding cache**
   - Cache lat/lng → address mappings
   - Reduces Geocoding API calls
   - Saves money

4. **Add Nominatim fallback** to find-section.ts
   - Graceful degradation if Google API fails
   - Ensures service availability
   - Cost savings on rate limiting

### Low Priority
5. **Add address validation** before geocoding calls
   - Validate format before API call
   - Reduce wasted API calls
   - Better error messages

6. **Add "near me" feature** to mobile
   - Search restrictions near current location
   - More discovery-based UX
   - Better engagement

## Environment Variables

### Required
```
GOOGLE_API_KEY              # Google Geocoding API
MSC_SUPABASE_URL           # MyStreetCleaning DB
MSC_SUPABASE_ANON_KEY      # MyStreetCleaning auth
SUPABASE_URL               # Main Supabase
SUPABASE_ANON_KEY          # Main auth
```

## Testing Approach

### Mobile Testing
1. GPS accuracy: Test with multiple burst samples in same location
2. Address input: Test with partial addresses (should fail - no autocomplete)
3. Geocoding: Test Chicago vs non-Chicago addresses
4. Permissions: Test grant/deny flows on Android 10+

### Web Testing
1. Nominatim: Test client-side geocoding
2. Google API: Test server-side with rate limiting
3. Maps: Test zoom, pan, cluster, heatmap interactions
4. Address input: Test partial addresses (should fail)

## Summary

This project demonstrates strong fundamentals in location services:
- Sophisticated GPS handling on mobile
- Good map visualization on web
- Proper backend architecture

The main opportunity for improvement is **address autocomplete**, which would significantly improve UX with minimal effort since Google's Places API is already integrated.

Overall assessment: **Solid foundation with room for refinement**

---

Last Updated: 2026-02-04
Research Scope: Geolocation, address input, location search
Platforms: React Native mobile, Next.js web

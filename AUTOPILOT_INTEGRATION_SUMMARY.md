# Autopilot America Integration Summary

## Executive Overview

This document summarizes how **Autopilot America data** is currently integrated into the ticketless-chicago ecosystem, specifically focusing on permit zone data and how to add support for it in the mobile app.

---

## 1. Current Autopilot America Integration

### What Autopilot America Does

Autopilot America is a **ticket monitoring and auto-contest service** that:
- Monitors license plates for new parking tickets (free alerts tier)
- Auto-generates contest letters for eligible tickets ($24/year paid tier)
- Automatically mails contest letters to Chicago Department of Finance
- Provides an estimated 54% win rate on contested tickets

### Current Data Integration Points

The system currently uses Autopilot America data in three main ways:

#### A. **Ticket Monitoring (Chicago Data Portal)**
- **Source**: Chicago Data Portal API
- **URL**: `https://data.cityofchicago.org/resource/rvjx-6vbp.json`
- **Data**: Parking ticket records by license plate
- **Tables**: `monitored_plates`, `detected_tickets`, `autopilot_subscriptions`
- **API Route**: `/api/cron/autopilot-check-plates.ts`

#### B. **Permit Zone Data (Chicago Data Portal)**
- **Source**: Chicago Open Data Portal
- **URL**: `https://data.cityofchicago.org/resource/u9xt-hiju.json`
- **Data**: Parking permit zone boundaries, restrictions, and addresses
- **Database**: `parking_permit_zones` table (14,000+ records)
- **Sync**: Weekly via `/api/cron/sync-permit-zones.ts`

#### C. **Building Permits (Chicago Data Portal)**
- **Source**: Chicago Data Portal API
- **URL**: `https://data.cityofchicago.org/resource/ydr8-5enu.json`
- **API Route**: `/api/neighborhood/permits.ts`

---

## 2. Permit Zone Data Structure

### Database Schema

The `parking_permit_zones` table stores:

```sql
CREATE TABLE parking_permit_zones (
  id BIGSERIAL PRIMARY KEY,
  row_id TEXT UNIQUE NOT NULL,           -- Unique ID from Chicago
  status TEXT NOT NULL,                   -- "ACTIVE", etc.
  zone TEXT NOT NULL,                     -- Zone number (e.g., "2483")
  odd_even TEXT,                          -- 'O' (odd) / 'E' (even) / NULL (both)
  address_range_low INTEGER,              -- 1700
  address_range_high INTEGER,             -- 1722
  street_direction TEXT,                  -- 'N', 'S', 'E', 'W'
  street_name TEXT NOT NULL,              -- 'CLINTON'
  street_type TEXT,                       -- 'ST', 'AVE', 'BLVD'
  buffer TEXT,                            -- Buffer zone info
  ward_low INTEGER,                       -- Starting ward number
  ward_high INTEGER,                      -- Ending ward number
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Sample Data Format

```json
{
  "zone": "2483",
  "status": "ACTIVE",
  "addressRange": "1700-1722 S CLINTON ST",
  "ward": "Ward 25",
  "oddEven": null,
  "restrictionSchedule": "Mon-Fri 6am-6pm"
}
```

### Key Fields Explained

| Field | Purpose | Example |
|-------|---------|---------|
| `zone` | Unique permit zone ID | "2483" |
| `status` | Permit zone status | "ACTIVE" |
| `address_range_low/high` | Address number range | 1700-1722 |
| `street_direction` | Cardinal direction | "S" (South) |
| `street_name` | Street name (uppercase) | "CLINTON" |
| `street_type` | Street type abbreviation | "ST" |
| `odd_even` | Odd/even side requirement | 'O', 'E', or NULL |
| `ward_low/high` | Chicago ward(s) | 25 or 25-26 |

---

## 3. Permit Zone Data Sources & APIs

### Primary API Endpoint

**GET `/api/check-permit-zone?address=<address>`**

**Response Format**:
```json
{
  "hasPermitZone": true,
  "zones": [
    {
      "zone": "2483",
      "status": "ACTIVE",
      "addressRange": "1700-1722 S CLINTON ST",
      "ward": "Ward 25"
    }
  ],
  "parsedAddress": {
    "number": 1710,
    "direction": "S",
    "name": "CLINTON",
    "type": "ST"
  }
}
```

### Mobile-Optimized Endpoint

**POST `/api/mobile/check-parking?lat=<latitude>&lng=<longitude>`**

This endpoint returns **ALL parking restrictions** including permit zones:

**Response Format**:
```json
{
  "success": true,
  "address": "1710 S Clinton St",
  "coordinates": {
    "latitude": 41.8734,
    "longitude": -87.6281
  },
  "permitZone": {
    "inPermitZone": true,
    "message": "This address is in a permit parking zone",
    "zoneName": "Zone 2483",
    "permitRequired": true,
    "severity": "warning",
    "restrictionSchedule": "Mon-Fri 6am-6pm"
  },
  "streetCleaning": { ... },
  "winterOvernightBan": { ... },
  "twoInchSnowBan": { ... },
  "rushHour": { ... },
  "timestamp": "2026-01-21T18:30:00Z"
}
```

---

## 4. Current Web App Integration

### Components Using Permit Zone Data

#### `usePermitZoneCheck` Hook
```typescript
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';

const { checkAddress, loading, hasPermitZone, zones } = usePermitZoneCheck();
await checkAddress('1710 S Clinton St');
```

#### `PermitZoneWarning` Component
Displays a warning banner when permit zones are detected.

### Web App Routes

1. **Admin Route**: `/admin/check-permit-zones`
2. **API Route**: `/api/check-permit-zone`
3. **Permit Zone Documents**: `/permit-zone-documents`
4. **Sync Status**: `/api/cron/sync-permit-zones`

---

## 5. How Permit Zones Work in Web App

### User Flow

1. User enters address in form
2. Address is parsed into components (number, direction, name, type)
3. Database query matches on:
   - Street name
   - Street direction (if provided)
   - Street type (if provided)
   - Address range (odd/even if specified)
   - Status = "ACTIVE"
4. Results returned with zone details

### Permit Zone Restrictions

Each zone has a default restriction schedule (usually **Mon-Fri 6am-6pm**):
- Permits required during these hours
- On-street parking free outside these hours
- Weekends typically no permit needed

### Time-Based Validation

The `permit-zone-time-validator.ts` file:
- Parses restriction schedules (e.g., "Mon-Fri 6am-6pm")
- Checks if currently restricted
- Calculates hours until next restriction
- Provides severity levels (critical/warning/info/none)

---

## 6. Integrating Permit Zones into Mobile App

### Step 1: Create Mobile Permit Zone Hook

```typescript
// TicketlessChicagoMobile/src/hooks/usePermitZoneCheck.ts
import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

export interface PermitZoneData {
  inPermitZone: boolean;
  zoneName?: string;
  permitRequired?: boolean;
  restrictionSchedule?: string;
  message: string;
  severity: 'critical' | 'warning' | 'info' | 'none';
}

export function usePermitZoneCheck() {
  const [loading, setLoading] = useState(false);
  const [permitZoneData, setPermitZoneData] = useState<PermitZoneData | null>(null);

  const checkLocationPermits = useCallback(async () => {
    setLoading(true);
    try {
      const location = await Location.getCurrentPositionAsync({});
      
      const response = await fetch(
        `/api/mobile/check-parking?lat=${location.coords.latitude}&lng=${location.coords.longitude}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const data = await response.json();
      setPermitZoneData(data.permitZone);
      return data.permitZone;
    } finally {
      setLoading(false);
    }
  }, []);

  return { checkLocationPermits, loading, permitZoneData };
}
```

### Step 2: Create Mobile UI Component

```typescript
// TicketlessChicagoMobile/src/components/PermitZoneCard.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PermitZoneCardProps {
  data: any;
  onRefresh: () => void;
}

export function PermitZoneCard({ data, onRefresh }: PermitZoneCardProps) {
  if (!data?.inPermitZone) return null;

  const severityColors = {
    critical: '#DC2626',
    warning: '#F59E0B',
    info: '#3B82F6',
    none: '#10B981'
  };

  return (
    <View style={[
      styles.container,
      { borderColor: severityColors[data.severity] }
    ]}>
      <Text style={styles.title}>🅿️ Permit Zone Alert</Text>
      <Text style={styles.message}>{data.message}</Text>
      
      {data.zoneName && (
        <Text style={styles.detail}>Zone: {data.zoneName}</Text>
      )}
      
      {data.restrictionSchedule && (
        <Text style={styles.detail}>Hours: {data.restrictionSchedule}</Text>
      )}
      
      {data.permitRequired && (
        <Text style={styles.warning}>⚠️ Permit required now</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    padding: 12,
    marginVertical: 8,
    borderRadius: 8
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4
  },
  message: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8
  },
  detail: {
    fontSize: 12,
    color: '#666',
    marginVertical: 2
  },
  warning: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '600',
    marginTop: 8
  }
});
```

### Step 3: Integrate into Home Screen

```typescript
// TicketlessChicagoMobile/src/screens/HomeScreen.tsx
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';
import { PermitZoneCard } from '../components/PermitZoneCard';

export function HomeScreen() {
  const { checkLocationPermits, loading, permitZoneData } = usePermitZoneCheck();

  const handleCheckParking = async () => {
    await checkLocationPermits();
  };

  return (
    <View style={styles.container}>
      {/* Existing content */}
      
      <PermitZoneCard 
        data={permitZoneData} 
        onRefresh={handleCheckParking}
      />
      
      {/* Existing content */}
    </View>
  );
}
```

### Step 4: Add to Map Screen

Show permit zones visually on the map:

```typescript
// TicketlessChicagoMobile/src/screens/MapScreen.tsx
// Add permit zone polygons to map when entering permit zone
if (permitZoneData?.inPermitZone) {
  // Show visual indicator on map
  // Could fetch zone geometry from `/api/get-zone-geometry`
}
```

---

## 7. API Endpoints Available for Mobile

### Parking Restriction Checks

| Endpoint | Method | Purpose | Mobile-Ready |
|----------|--------|---------|--------------|
| `/api/mobile/check-parking` | GET/POST | All restrictions (permits, street cleaning, snow ban, rush hour) | ✅ Yes |
| `/api/check-permit-zone` | GET | Address-based permit zone lookup | ⚠️ Needs coords |
| `/api/check-parking-location` | GET/POST | Unified location checker | ✅ Yes |

### Recommended Flow for Mobile

1. **Primary**: Use `/api/mobile/check-parking` with GPS coordinates
2. **Fallback**: Use `/api/check-permit-zone` with address text
3. **Geometry**: Fetch zone boundaries via `/api/get-zone-geometry` (optional visualization)

---

## 8. Data Refresh Strategy

### Permit Zone Data Sync

- **Frequency**: Weekly (Sunday 2 AM CT)
- **Records**: ~14,000 permit zones
- **Source**: Chicago Open Data Portal
- **Status**: Automatically synced via `/api/cron/sync-permit-zones.ts`

### Mobile App Caching

Recommended strategy:
1. **First load**: Fetch from API and cache locally
2. **Periodic refresh**: Every 7 days or on manual refresh
3. **Address search**: Query live from backend (no caching)

```typescript
// Example cache strategy
const PERMIT_ZONE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

async function getPermitZoneData(address: string) {
  const cached = await AsyncStorage.getItem(`permit_zone_${address}`);
  const now = Date.now();
  
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (now - timestamp < PERMIT_ZONE_CACHE_DURATION) {
      return data; // Use cache
    }
  }
  
  // Fetch fresh data
  const response = await fetch(`/api/check-permit-zone?address=${address}`);
  const data = await response.json();
  
  // Cache it
  await AsyncStorage.setItem(
    `permit_zone_${address}`,
    JSON.stringify({ data, timestamp: now })
  );
  
  return data;
}
```

---

## 9. Implementation Checklist for Mobile

- [ ] Create `usePermitZoneCheck` hook
- [ ] Create `PermitZoneCard` component
- [ ] Add permit zone check to HomeScreen
- [ ] Add permit zone visualization to MapScreen
- [ ] Implement caching strategy in AsyncStorage
- [ ] Add settings toggle for permit zone alerts
- [ ] Test with multiple addresses in different zones
- [ ] Add error handling for API failures
- [ ] Document for other developers
- [ ] QA testing on real devices

---

## 10. Key Technical Insights

### Address Parser

The system uses `lib/address-parser.ts` to convert addresses like:
```
"1710 S Clinton St" 
→ { number: 1710, direction: "S", name: "CLINTON", type: "ST" }
```

This enables reliable matching against the permit zone database.

### Restriction Schedule Validator

The `permit-zone-time-validator.ts` parses restriction strings:
- `"Mon-Fri 6am-6pm"` - Weekday business hours
- `"24/7"` - Always restricted
- `"Mon-Fri 8am-6pm, Sat 9am-12pm"` - Complex schedules

### Unified Parking Checker

The mobile endpoint uses a single unified function that:
1. Reverse geocodes coordinates → address
2. Checks 4+ restriction types in parallel
3. Returns all data in mobile-optimized format
4. Single database transaction = better performance

---

## 11. Future Enhancements

1. **Zone Visualization**: Show permit zone polygons on map
2. **Permit Purchase Integration**: Link to City of Chicago permit portal
3. **Restriction Timeline**: Show upcoming restriction changes
4. **Push Notifications**: Alert when entering permit zone during restricted hours
5. **Multi-Address Support**: Store multiple addresses with different permit zones
6. **Analytics**: Track how often users check permit zones

---

## 12. Troubleshooting

### No permit zones found for valid address

Check:
1. Data is synced: `SELECT COUNT(*) FROM parking_permit_zones;`
2. Address format is correct (must include street number)
3. Check sync logs: `SELECT * FROM parking_permit_zones_sync ORDER BY created_at DESC;`

### API timeout

- Address parsing is too slow → Use GPS coordinates instead
- Database query slow → Check indexes on street_name, status

### Permit zone data outdated

- Run manual sync: `npx ts-node scripts/sync-permit-zones.ts`
- Check cron logs for failures

---

## 13. Resources & Documentation

- **Chicago Open Data**: https://data.cityofchicago.org
- **Permit Zones Dataset**: https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju
- **Chicago Parking Permits**: https://www.chicago.gov/city/en/depts/cdot/provdrs/parking_and_transportation/svcs/parking_permits.html
- **Autopilot America**: https://autopilotamerica.com


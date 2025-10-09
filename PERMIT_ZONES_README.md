# Parking Permit Zone System

This system checks if a Chicago address is in a residential parking permit zone using cached data from the Chicago Open Data Portal.

## How It Works

### 1. **Database Schema** (`supabase/migrations/create_parking_permit_zones_table.sql`)

Two tables created:
- **`parking_permit_zones`**: Stores all permit zone data
  - Address ranges, street info, zone numbers, ward info
  - Indexed on street name and direction for fast lookups
- **`parking_permit_zones_sync`**: Tracks sync history
  - When data was last updated, how many records, success/failure

### 2. **Address Parser** (`lib/address-parser.ts`)

Parses Chicago addresses into components:
```typescript
parseChicagoAddress("1710 S Clinton St")
// Returns: {
//   number: 1710,
//   direction: "S",
//   name: "CLINTON",
//   type: "ST",
//   isOdd: false
// }
```

Handles:
- Direction abbreviations (North → N, South → S, etc.)
- Street type abbreviations (Street → ST, Avenue → AVE, etc.)
- Odd/even detection

### 3. **Data Sync Script** (`scripts/sync-permit-zones.ts`)

Fetches and caches all permit zone data from Chicago's API:
```bash
npx ts-node scripts/sync-permit-zones.ts
```

What it does:
1. Fetches all data from `https://data.cityofchicago.org/resource/u9xt-hiju.json`
2. Clears old cached data
3. Inserts fresh data in batches of 1000
4. Records sync metadata (timestamp, record count, status)

### 4. **API Endpoint** (`pages/api/check-permit-zone.ts`)

Check if an address is in a permit zone:

**GET Request:**
```
GET /api/check-permit-zone?address=1710%20S%20Clinton%20St
```

**Response:**
```json
{
  "hasPermitZone": true,
  "zones": [{
    "zone": "2483",
    "status": "ACTIVE",
    "addressRange": "1700-1722 S CLINTON ST",
    "ward": "Ward 25"
  }],
  "parsedAddress": {
    "number": 1710,
    "direction": "S",
    "name": "CLINTON",
    "type": "ST"
  }
}
```

**Query Logic:**
1. Parse the address
2. Look up matching zones where:
   - Street name matches
   - Direction matches (if specified)
   - Street type matches (if specified)
   - Address number is between range_low and range_high
   - Odd/even matches (if zone specifies)
   - Status is "ACTIVE"

### 5. **React Hook** (`hooks/usePermitZoneCheck.ts`)

Use in any component:
```typescript
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';

function MyComponent() {
  const { checkAddress, loading, hasPermitZone, zones } = usePermitZoneCheck();

  const handleCheck = async () => {
    const result = await checkAddress('1710 S Clinton St');
    console.log(result);
  };

  return (
    <div>
      {loading && <p>Checking...</p>}
      {hasPermitZone && <p>This address is in permit zone {zones[0].zone}</p>}
    </div>
  );
}
```

### 6. **UI Component** (`components/PermitZoneWarning.tsx`)

Shows a warning banner when permit zones are detected:
```typescript
import { PermitZoneWarning } from '../components/PermitZoneWarning';

<PermitZoneWarning zones={zones} />
```

## Setup Instructions

### Initial Setup

1. **Run database migration:**
```bash
# Apply the migration to create tables
supabase db push
```

2. **Sync permit zone data:**
```bash
npx ts-node scripts/sync-permit-zones.ts
```

This will fetch ~14,000+ permit zone records and cache them locally.

### Periodic Updates

**Recommended:** Update data weekly since permit zones don't change frequently.

#### Option A: Manual
```bash
npx ts-node scripts/sync-permit-zones.ts
```

#### Option B: Vercel Cron (Automated)

Create `pages/api/cron/sync-permit-zones.ts`:
```typescript
import { syncPermitZones } from '../../../scripts/sync-permit-zones';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await syncPermitZones();
  res.status(200).json({ success: true });
}
```

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/sync-permit-zones",
    "schedule": "0 2 * * 0"
  }]
}
```

This runs every Sunday at 2 AM.

## Integration Examples

### Example 1: Check Address on Input

```typescript
import { useState } from 'react';
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';
import { PermitZoneWarning } from '../components/PermitZoneWarning';

function AddressForm() {
  const [address, setAddress] = useState('');
  const { checkAddress, hasPermitZone, zones, loading } = usePermitZoneCheck();

  const handleAddressBlur = async () => {
    if (address) {
      await checkAddress(address);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onBlur={handleAddressBlur}
        placeholder="Enter your street address"
      />

      {loading && <p>Checking for permit zones...</p>}
      {hasPermitZone && <PermitZoneWarning zones={zones} />}
    </div>
  );
}
```

### Example 2: API Route Usage

```typescript
// In any API route or server function
import { parseChicagoAddress } from '../lib/address-parser';
import { supabaseAdmin } from '../lib/supabase';

async function checkPermitZone(address: string) {
  const parsed = parseChicagoAddress(address);

  const { data } = await supabaseAdmin
    .from('parking_permit_zones')
    .select('*')
    .eq('street_name', parsed.name)
    .eq('status', 'ACTIVE')
    .lte('address_range_low', parsed.number)
    .gte('address_range_high', parsed.number);

  return data && data.length > 0;
}
```

## Data Source

- **Source:** Chicago Open Data Portal
- **Dataset:** Parking Permit Zones
- **URL:** https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju
- **API:** https://data.cityofchicago.org/resource/u9xt-hiju.json
- **Format:** Socrata SODA API (JSON)
- **Update Frequency:** Infrequent (zones rarely change)

## Performance

- **Address parsing:** < 1ms
- **Database lookup:** 5-20ms (with indexes)
- **Total API response:** ~20-50ms

## Troubleshooting

### Sync fails with "Database not available"
- Check `SUPABASE_SERVICE_ROLE_KEY` is set in environment variables
- Verify Supabase connection is working

### No zones found for valid address
- Check if data has been synced: `SELECT COUNT(*) FROM parking_permit_zones;`
- Verify address format matches Chicago convention
- Check sync logs: `SELECT * FROM parking_permit_zones_sync ORDER BY created_at DESC LIMIT 1;`

### Address parsing fails
- Ensure address includes street number
- Common formats: "123 N Main St", "456 South Michigan Avenue"
- Direction and street type are optional but improve accuracy

## Future Enhancements

- [ ] Add geocoding for addresses without clear street components
- [ ] Cache parse results for frequently checked addresses
- [ ] Add webhook to auto-sync when Chicago updates dataset
- [ ] Show permit zone info in user dashboard
- [ ] Alert users when their address enters a new permit zone

# Chicago Meters API Research

## Summary

The Chicago parking meters system does **NOT** have a public bulk data API. After extensive investigation, here are the findings:

## API Structure (map.chicagometers.com)

### Base URL
`https://map.chicagometers.com`

### Authentication
- Uses Laravel CSRF protection
- Requires session cookie and CSRF token from homepage
- CSRF token in meta tag: `<meta name="csrf-token" content="...">`

### Available Endpoints

#### 1. POST /search
**The only working endpoint for querying meter data.**

**Request Format:**
```json
{
  "query": "downtown"  // Street name, area, or terminal ID
}
```

**Headers Required:**
```
Content-Type: application/json
X-CSRF-TOKEN: {token from meta tag}
X-Requested-With: XMLHttpRequest
Cookie: laravel_session={session cookie}
```

**Response Format:**
```json
[
  {
    "title": "494116",
    "secondary": "2408 W LELAND AVE",
    "terminal": {
      "TerminalID": "494116",
      "RatePackageID": "418000007",
      "LocationAddress": "2408 W LELAND AVE",
      "Latitude": "41.9667906",
      "Longitude": "-87.6892369",
      "RatePackageDescription": "$2.50, Mon-Sat 8 AM-10 PM, 3 hr POS",
      "FullRate": "2.5000",
      "POS": "3",
      "NumberOfSpaces": "4",
      "CLZTerminal": "0",
      "_geoloc": {
        "lat": "41.9667906",
        "lng": "-87.6892369"
      },
      "objectID": "10934034000"
    }
  }
]
```

**Limitations:**
- Returns maximum 5 results per query
- Uses Algolia search backend (notice `objectID` and `_highlightResult` fields)
- No geographic filtering works (lat/lng params ignored)
- No pagination support
- No "get all" functionality

#### 2. POST /terminals
**Returns 500 Server Error** with all tested parameters.

#### 3. POST /place
**Returns 500 Server Error** with all tested parameters.

## Data Fields

Each meter terminal includes:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `TerminalID` | string | Unique meter terminal ID | "494116" |
| `RatePackageID` | string | Rate package identifier | "418000007" |
| `LocationAddress` | string | Street address | "2408 W LELAND AVE" |
| `Latitude` | string | GPS latitude | "41.9667906" |
| `Longitude` | string | GPS longitude | "-87.6892369" |
| `RatePackageDescription` | string | Human-readable parking rules | "$2.50, Mon-Sat 8 AM-10 PM, 3 hr POS" |
| `FullRate` | string | Hourly rate in dollars | "2.5000" |
| `POS` | string | Time limit in hours | "3" |
| `NumberOfSpaces` | string | Number of meters at this location | "4" |
| `CLZTerminal` | string | Unknown (always "0" or "1") | "0" |

## Alternative Data Sources

### 1. City of Chicago Schedule 10 PDF
**URL:** `https://www.chicago.gov/content/dam/city/depts/fin/supp_info/AssetLeaseAgreements/MeteredParking/Schedule_10.pdf`

**Format:** PDF table with columns:
- ZONE
- AREA
- BLOCK START
- BLOCK END
- PAY BOX ADDRESS
- DIR (direction)
- STREET NAME
- METER ID
- WARD
- NUMBER OF SPACES

**Pros:**
- Official city data
- Comprehensive list of all metered locations
- Includes ward and zone information

**Cons:**
- PDF format (requires parsing)
- No GPS coordinates
- No rate information
- No time limit information
- Static snapshot (not updated frequently)

### 2. Chicago Data Portal (data.cityofchicago.org)
**Does NOT have a parking meters dataset.**

Available related datasets:
- Parking Permit Zones (`u9xt-hiju`)
- Permit Parking Zones (`qiag-khha`)
- Parking Zones (`az5k-c8i5`)

**Why no meter data?**
Chicago's parking meters were privatized in 2008 under a 75-year lease to Chicago Parking Meters LLC. This private company controls the meter data and does not publish it as open data.

### 3. ParkChicago API
The ParkChicago mobile payment app likely has an internal API, but it's not publicly documented.

## Recommended Implementation Strategy

Since there's no bulk API, here are the options for syncing Chicago meter data:

### Option 1: Parse Schedule 10 PDF (Best for one-time import)
1. Download PDF from city website
2. Extract table data using PDF parsing tools (pdfplumber, tabula-py, etc.)
3. Geocode addresses to get lat/lng (using Google Maps API or similar)
4. Store in Supabase
5. Manually update quarterly or annually

**Pros:**
- Official data source
- One-time effort
- No rate limiting concerns

**Cons:**
- No rate/time limit information
- No GPS coordinates (need geocoding)
- Manual update process
- PDF format is fragile

### Option 2: Scrape map.chicagometers.com (Not recommended)
1. Use the `/search` endpoint with hundreds of street names
2. Deduplicate results by TerminalID
3. Store in database

**Pros:**
- Includes rate and time limit data
- Includes GPS coordinates

**Cons:**
- Extremely impractical (5 results per query, would need thousands of queries)
- Fragile (depends on website not changing)
- Rate limiting concerns
- CSRF token management required
- Incomplete coverage (can't guarantee all terminals discovered)

### Option 3: Use existing static data (Recommended)
Chicago's meter locations change infrequently. Consider:
1. One-time import from Schedule 10 PDF
2. Manually geocode addresses
3. Augment with rate/time data from map.chicagometers.com spot checks
4. Update quarterly via manual review

### Option 4: Focus on user-reported data
Instead of comprehensive meter database:
1. When user parks at a meter, they report it
2. Store meter location + rates in database
3. Crowdsource meter data over time
4. Eventually build comprehensive database organically

## Technical Implementation Notes

### Authenticating with map.chicagometers.com

```typescript
// 1. Get session cookie and CSRF token
const homeResponse = await fetch('https://map.chicagometers.com/');
const html = await homeResponse.text();

// Extract cookies
const cookies: Record<string, string> = {};
homeResponse.headers.getSetCookie().forEach(header => {
  const [cookiePart] = header.split(';');
  const [name, value] = cookiePart.split('=');
  cookies[name] = value;
});

// Extract CSRF token
const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
const csrfToken = csrfMatch?.[1];

// 2. Make authenticated request
const response = await fetch('https://map.chicagometers.com/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-TOKEN': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
  },
  body: JSON.stringify({ query: 'Clark' }),
});

const data = await response.json();
```

### Rate Limits
- No documented rate limits
- 5 results per request maximum
- Unknown if IP-based throttling exists

## Background: Chicago Parking Meters Privatization

- 2008: City leased all 36,000 parking meters to Chicago Parking Meters LLC for 75 years
- City received $1.15 billion upfront (but analysis showed this was $974 million under market value)
- By 2023, investors had recouped investment plus $500 million profit
- By 2024, meters generated $1.97 billion for CPM LLC
- 60 years remaining on the lease (until 2083)
- This privatization explains why meter data isn't available as open data

## Conclusion

**There is no practical way to build a weekly sync cron for Chicago meter data.**

The only realistic approach is:
1. One-time import from Schedule 10 PDF
2. Manual geocoding
3. Manual rate/time data collection
4. Quarterly manual updates

For a parking app, consider focusing on other data sources (permit zones, street cleaning, towed vehicles, tickets) that DO have proper APIs, and treat meter data as static reference data that rarely changes.

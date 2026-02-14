# Chicago Metered Parking Data Research

**Date**: 2026-02-11
**Purpose**: Research Chicago Data Portal and other sources for metered parking datasets suitable for map visualization

## Executive Summary

**Result**: No official, current metered parking dataset found on the Chicago Data Portal (data.cityofchicago.org). The City of Chicago's parking meters are operated by a private concessionaire (Chicago Parking Meters LLC / ParkChicago) under a 75-year lease, and the location/rate data is NOT published as open data.

**Best Available Data Source**: Community-scraped GitHub repository from 2019 (stale but workable).

---

## Datasets Found on Chicago Data Portal

### 1. Parking Permit Zones
- **Dataset ID**: `u9xt-hiju`
- **URL**: https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju
- **SODA API**: `https://data.cityofchicago.org/resource/u9xt-hiju.json`
- **Content**: Residential parking permit zones (street segments)
- **Not Useful**: This is for RESIDENTIAL permit zones, not metered parking

### 2. Parking Zones
- **Dataset ID**: `az5k-c8i5`
- **URL**: https://data.cityofchicago.org/Transportation/Parking-Zones/az5k-c8i5
- **SODA API**: `https://data.cityofchicago.org/resource/az5k-c8i5.json`
- **Content**: Residential parking zones (street segments)
- **Not Useful**: Same as above - residential zones only

### 3. Street Center Lines
- **Dataset ID**: `6imu-meau`
- **URL**: https://data.cityofchicago.org/Transportation/Street-Center-Lines/6imu-meau
- **SODA API**: `https://data.cityofchicago.org/resource/6imu-meau.json`
- **Content**: Street centerline geometry for Chicago
- **Not Useful**: No parking rate or meter data attached

---

## Alternative Data Sources

### 1. GitHub: Chicago Parking Meters (Best Available)
- **Repo**: https://github.com/stevevance/Chicago-Parking-Meters
- **File**: `chicago_parking_meters_2019-06-26.geojson`
- **Last Updated**: June 26, 2019 (6+ years stale)
- **Data Source**: Scraped from Chicago Parking Meters LLC internal API in 2014 and 2019
- **Format**: GeoJSON with Point geometries
- **Fields**:
  - `id` - Unique meter ID
  - `meter_id` - Meter identifier
  - `address` - Street address
  - `spaces` - Number of available parking spaces at this meter
  - `type` - Meter type (all marked "CWT")
  - `rate_id` - Rate package identifier
  - `rate_package_id` - Rate package identifier
  - `latitude` / `longitude` - Coordinates
  - `created_at` / `updated_at` - Timestamps
  - Geometry: **Point** (individual meter poles, NOT street segments)

**Sample Record**:
```json
{
  "id": "1",
  "meter_id": "...",
  "address": "6401 N CLARK ST",
  "spaces": 22,
  "type": "CWT",
  "rate_id": 664,
  "latitude": 41.99854,
  "longitude": -87.67068,
  "geometry": {
    "type": "Point",
    "coordinates": [-87.67068, 41.99854]
  }
}
```

**Pros**:
- GeoJSON format (ready for Leaflet/Mapbox)
- Has coordinates for every meter
- Includes space counts and rate IDs

**Cons**:
- 6+ years old (rates have changed, meters may have been added/removed)
- Point geometries (not street segments) - harder to visualize as colored street lines
- No actual rate amounts (just rate IDs - would need to look up current rates)
- No max time limits or enforcement hours

### 2. ParkChicago Map API (Undocumented)
- **URL**: http://map.chicagometers.com/
- **API Endpoints** (discovered):
  - `POST /terminals` - Unknown parameters
  - `POST /search` - Unknown parameters
  - `POST /place` - Unknown parameters
- **Status**: Internal API, no public documentation
- **Note**: This is the live API that powers the ParkChicago map, but it's not documented for developer use

### 3. City of Chicago Schedule 10 PDF
- **URL**: https://www.chicago.gov/content/dam/city/depts/fin/supp_info/AssetLeaseAgreements/MeteredParking/Schedule_10.pdf
- **Content**: Zone, area, block start/end, pay box address, street name, meter ID
- **Format**: PDF (146 pages)
- **Status**: Binary PDF, not easily parsable
- **Use Case**: Could be scraped/OCR'd for a one-time data load

---

## Rate Information

ParkChicago organizes parking by **geographic zones**, not individual streets or segments:

1. **Chicago neighborhoods** (outside downtown): $2.50/hour, 8am-10pm
2. **Central Business District**: $4.75/hour, 8am-midnight
3. **West Loop**: $4.75/hour
4. **Loop**: $7.00/hour 8am-9pm, $3.50/hour 9pm-8am
5. **Commercial loading zones**: $14.00/hour

**Source**: https://parkchicago.com/rates-hours

---

## Street Segment Dataset: NOT FOUND

**What we were looking for**: A dataset with metered parking STREET SEGMENTS (not just meter poles) containing:
- Start/end coordinates for each metered block face
- LineString geometries (for rendering as colored street lines on a map)
- Rate per hour
- Max time limit
- Enforcement hours

**Conclusion**: This does NOT exist as open data. The closest we have is:
- Point data (individual meters) from 2019 GitHub scrape
- PDF with meter addresses (not easily usable)
- Undocumented internal ParkChicago API

---

## Recommendations

### Option 1: Use 2019 GitHub Data "As-Is"
- Download `chicago_parking_meters_2019-06-26.geojson`
- Display as point markers on the map
- Show "Metered parking nearby" without specific rates
- Disclaimer: "Data from 2019, rates may have changed"

### Option 2: Build Street Segments from Point Data
- Group meters by street name and block
- Generate LineString geometries from clustered points
- Assign generic rate zones based on lat/lng (Loop vs CBD vs neighborhoods)
- This is engineering work to make the data more useful

### Option 3: Scrape ParkChicago Map
- Reverse-engineer the `/terminals`, `/search`, `/place` endpoints
- Fetch current meter data from the live API
- Risk: Could break if they change the API; may violate ToS

### Option 4: Use Rate Zones Only (No Meter Locations)
- Create a simple polygon layer for Loop / CBD / neighborhoods
- Show broad-strokes "This area has $X/hour metered parking"
- No specific street-level detail

### Option 5: Don't Build Metered Parking Feature
- Metered parking is enforced during business hours (when most tickets happen)
- Our app focuses on overnight/residential parking restrictions
- Metered parking is well-covered by the ParkChicago app already

---

## Technical Notes

### SODA API Format
Chicago Data Portal uses Socrata SODA API. Datasets can be queried at:
```
https://data.cityofchicago.org/resource/{dataset-id}.json
```

Query parameters:
- `$limit=N` - Limit results
- `$where=condition` - Filter
- `$select=fields` - Select columns
- Can export as `.geojson` by changing extension

### GeoJSON Export
Many Socrata datasets support GeoJSON export by replacing `.json` with `.geojson`:
```
https://data.cityofchicago.org/resource/{dataset-id}.geojson
```

---

## Context: Why No Open Data?

In 2008, Chicago sold the rights to operate all 36,000 parking meters to **Chicago Parking Meters LLC** (a Morgan Stanley-affiliated private equity group) for $1.15 billion in a 75-year lease. The private operator (now branded as ParkChicago) controls the meter locations, rates, and operational data. The City does NOT publish this data as open data because:
1. They don't operate the meters anymore (private company does)
2. The 2013 renegotiation required the company to provide data to the City, but not to publish it publicly
3. The data is considered proprietary by CPM LLC

This is why the only available data is from community scraping efforts (Steve Vance, 2014 and 2019) rather than official open data releases.

---

## Conclusion

**For the Ticketless Chicago map feature:**

We do NOT have access to current, official metered parking street segment data with rates and time limits. The best we can do is:

1. Use the 2019 GeoJSON point data to show "Metered parking exists near this location"
2. Display generic rate zone information (Loop = $7/hr, CBD = $4.75/hr, etc.)
3. Link to the official ParkChicago map for real-time rates and availability

If we want current, accurate metered parking data, we would need to either:
- Scrape the ParkChicago API (grey area)
- File a FOIA request with the City of Chicago for the data CPM LLC provides them
- Partner with Chicago Parking Meters LLC for API access (unlikely for a ticket contesting app)

**My recommendation**: Don't prioritize metered parking data. Focus on the parking restrictions (street cleaning, permit zones, etc.) where we have good open data and where the app provides unique value.

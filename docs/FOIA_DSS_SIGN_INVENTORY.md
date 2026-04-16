# FOIA Request: Street Sweeping Sign Inventory

**Goal**: Obtain the per-block, per-side cleaning dates that are physically posted on Chicago's street sweeping signs. This data does not exist in any published DSS/CDOT/Data Portal feed — only on the signs. The City has internal records of sign placement and content; those records are the target.

**Strategy**: Send the same request to multiple departments simultaneously. DSS owns the sweeping program, CDOT owns streetscape/signage installation, Finance owns the ticket-validation system (which must resolve a ticket address to the posted schedule). Any one of them having this data is enough.

---

## Recipients (send to all four in parallel)

1. **Department of Streets & Sanitation (DSS)** — owns the sweeping program
   - FOIA Officer: `dssfoia@cityofchicago.org`
   - Mail: DSS FOIA Officer, 1411 W. North Ave., Chicago, IL 60642
2. **Chicago Department of Transportation (CDOT)** — owns signage install/maintenance
   - FOIA Officer: `cdotfoia@cityofchicago.org`
3. **Department of Finance** — validates parking tickets against posted signs
   - FOIA Officer: `FOIAFinance@cityofchicago.org`
4. **Office of the City Clerk** — maintains official City records
   - FOIA Officer: `foia@cityofchicago.org`

Use the City's online FOIA portal where possible: https://www.chicago.gov/city/en/narr/foia/CityofChicago_FOIARequest.html — submit one request per agency.

---

## Request Body (copy verbatim to each agency)

> Subject: FOIA Request — Street Sweeping Sign Inventory and Posted Schedule Data
>
> Dear FOIA Officer,
>
> Pursuant to the Illinois Freedom of Information Act (5 ILCS 140/), I request the following public records. I am requesting the same records from DSS, CDOT, the Department of Finance, and the City Clerk because each agency may hold a responsive copy in the ordinary course of its operations.
>
> **Records requested** — for calendar years 2024, 2025, and 2026:
>
> 1. The complete inventory of all posted street sweeping signs in the City of Chicago, including for each sign:
>     - Unique sign or asset ID
>     - GPS coordinates (latitude/longitude) or street address of the pole
>     - Street name, block number, and side of street (N/S/E/W) that the sign governs
>     - The full list of posted cleaning dates and times (including the month, day, and day-of-week)
>     - Ward and section number associated with the sign
>     - The date the sign was installed, last serviced, or last replaced
> 2. Any work orders, purchase orders, print specifications, or vendor files used to produce 2024, 2025, and 2026 street sweeping signs, including the per-sign content (dates printed on each sign).
> 3. Any database table, spreadsheet, shapefile, or GIS layer that maps street segments or street sides to ward/section cleaning dates at a granularity finer than the ward/section zone polygons published on the Chicago Data Portal.
> 4. Any internal documentation describing how a given address on a 2-day cleaning zone is assigned to day 1 versus day 2 of the cycle (e.g., odd-vs-even address parity rules, north-vs-south-side rules, or per-segment assignments).
>
> **Format**: I prefer electronic delivery in a structured, machine-readable format (CSV, JSON, GeoJSON, shapefile, or direct database export). PDFs are acceptable only if no structured form exists.
>
> **Fee waiver**: I request a fee waiver under 5 ILCS 140/6(c). Disclosure of the requested records is in the public interest: Chicago drivers receive hundreds of thousands of street sweeping tickets per year, and this information would materially help residents avoid those tickets. The records are not sought for commercial use; any aggregation will be published publicly so every Chicago resident can check their address. If fees are required, please notify me before incurring any charge greater than $25.
>
> **Delivery**: Please send responsive records to [YOUR EMAIL]. If any records are withheld, please cite the specific statutory exemption and identify the records withheld with sufficient specificity to allow appeal.
>
> Under 5 ILCS 140/3(d), I expect a response within 5 business days. If you need additional time, please explain in writing.
>
> Thank you,
>
> [YOUR NAME]
> [YOUR ADDRESS]
> [YOUR PHONE]
> [YOUR EMAIL]

---

## Expected pushback + counters

- **DSS will likely say** "the public data is on the Data Portal" — respond: the Portal has only ward/section polygons and zone-level date lists, not per-sign/per-side content. I am asking for the internal inventory that describes what is actually printed on each physical sign.
- **CDOT will likely say** "we install signs but don't own the content" — respond: work orders and print specifications sent from DSS to CDOT (or to the print vendor) are responsive; please search CDOT's sign-placement and work-order systems.
- **Finance will likely say** "we ticket based on officer observation, not a schedule table" — respond: the City's adjudication system must be able to look up whether a given address was under a sweeping restriction at a given date/time in order to validate a contested ticket. The lookup data/source is responsive.

## If all four deny

- File an administrative appeal with the **Illinois Public Access Counselor** (Office of the Illinois Attorney General). The PAC has authority under 5 ILCS 140/9.5 to issue binding decisions.
- Mention you requested the same records from multiple agencies to frame the pattern of non-response.

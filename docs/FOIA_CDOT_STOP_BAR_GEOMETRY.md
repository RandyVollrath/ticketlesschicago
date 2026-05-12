# FOIA Request: Stop Bar Geometry at Red-Light Camera Intersections

**Goal**: Obtain ground-truth GPS coordinates (or other geometric reference) for the painted stop bar at each of the 365 red-light camera (RLC) intersections in Chicago. This is the controlling reference line for a red-light violation — under Illinois law the violation is the act of *entering* the intersection on red, and "entering" is defined relative to the stop bar.

Without an authoritative source for stop bar location, neither the City nor a respondent can verify the precise spatial element of the violation; both are dependent on after-the-fact estimation from oblique camera photos. Any of the data sets below would resolve that ambiguity.

**Strategy**: Send to all four agencies in parallel. Each may hold a different responsive copy:
- **CDOT** installs and maintains pavement markings, and operates/oversees the RLC program.
- **Department of Finance** issues the citations and bears the burden of proof at hearing — it must have an evidentiary basis for the violation point.
- **Department of Administrative Hearings (DOAH)** adjudicates contests; the underlying hearing record and vendor-produced evidence packages may contain reference data.
- **City Clerk** maintains official City records and may have responsive engineering or contract documents.

The current and former camera operators (Verra Mobility, Conduent / formerly Xerox State & Local Solutions, Redflex) must necessarily encode the stop bar location into their detection algorithms — the camera fires when a vehicle crosses the stop bar after the signal turns red. These records, while held by a private contractor, are within CDOT's possession or control under the contract and are responsive under 5 ILCS 140/7(2).

---

## Recipients (send to all four in parallel)

1. **Chicago Department of Transportation (CDOT)**
   - FOIA Officer: `cdotfoia@cityofchicago.org`
2. **Department of Finance**
   - FOIA Officer: `FOIAFinance@cityofchicago.org`
3. **Department of Administrative Hearings**
   - FOIA Officer: `DOAHFOIA@cityofchicago.org`
4. **Office of the City Clerk**
   - FOIA Officer: `foia@cityofchicago.org`

Use the City's online FOIA portal where possible: https://www.chicago.gov/city/en/narr/foia/CityofChicago_FOIARequest.html — submit one request per agency.

---

## Request Body (copy verbatim to each agency)

> Subject: FOIA Request — Stop Bar Geometry at Red-Light Camera Intersections
>
> Dear FOIA Officer,
>
> Pursuant to the Illinois Freedom of Information Act (5 ILCS 140/), I request the following public records. I am sending the same request to CDOT, the Department of Finance, the Department of Administrative Hearings, and the Office of the City Clerk because each agency may hold a responsive copy in the ordinary course of its operations.
>
> **Records requested** — concerning the 365 active red-light camera (RLC) intersections operated by the City of Chicago, as enumerated in the City's published "Red Light Camera Violations" dataset (data.cityofchicago.org/resource/spqx-js37):
>
> 1. **Pavement marking geometry.** Any GIS layer, shapefile, geodatabase, KML, GeoJSON, CAD/DGN/DWG file, or other geometric record showing the location of painted stop bars (also termed "stop lines" or "stop limit lines" — MUTCD marking M-20 / 3B-16) at each RLC intersection. Include any version showing the line as installed and any version showing the line as designed.
>
> 2. **Camera-specific stop bar reference data.** For each RLC camera ID, the coordinates (latitude/longitude, state plane, or pixel-space reference) of the stop bar or stop line used by the automated detection system to determine whether a vehicle has "entered the intersection" for purposes of triggering a violation event. This reference value is necessarily encoded in the camera detection algorithm operated by the City's current vendor (Verra Mobility) and prior vendors (Conduent / Xerox State & Local Solutions, Redflex), and any records of that reference held by the City or held by the vendor on the City's behalf are responsive under 5 ILCS 140/7(2).
>
> 3. **As-built and design drawings.** Engineering drawings, as-built construction plans, signing-and-striping plans, traffic-control plans, or pavement-marking layout sheets used by CDOT or its contractors to install or repaint stop bars at the RLC intersections. PDF or CAD format is acceptable.
>
> 4. **Striping work orders and contractor records.** Work orders, purchase orders, contractor reports, and inspection records produced or received by CDOT during 2018–2026 documenting installation, repainting, or relocation of stop bars at any RLC intersection. Include any "as-painted" location confirmation, GPS-stamped field reports, or photographic field notes.
>
> 5. **RLC vendor processing manuals and detection-zone documentation.** Manuals, training materials, configuration documents, or system specifications produced by Verra Mobility, Conduent (or its predecessor Xerox State & Local Solutions), or Redflex for the Chicago RLC program that describe how the stop bar / stop line reference is established, calibrated, audited, or modified for each camera. Records held by the vendor on the City's behalf are responsive under 5 ILCS 140/7(2).
>
> 6. **Audit and calibration records.** Internal audit records, calibration logs, or compliance review documents in which CDOT, Finance, DOAH, or a third-party auditor verified the location of the stop bar against the location used by the camera's detection system for any RLC intersection between 2018 and the present.
>
> 7. **The Photo 1 / Photo 2 spec-compliance audit.** Per the City's published "Automated Red Light Camera Enforcement Violation Processing Methods & Criteria" (effective 03/15/2018), Photo 1 must show the cited vehicle's front tires *before* the stop bar and Photo 2 must show the rear tires *past* the stop bar. Any records (audits, sampled-review logs, contractor QA reports, internal correspondence) describing how compliance with this criterion is verified before a citation issues, including the percentage of recent issuances that were sampled, audited, or rejected for non-compliance.
>
> **Format**: I prefer electronic delivery in a structured, machine-readable format (CSV, JSON, GeoJSON, shapefile, CAD, or direct database export). PDFs are acceptable only when no structured form exists. If responsive records exist in multiple formats, please provide the most structured form available.
>
> **Partial response and clarification**: I recognize that some of these record categories may not exist in the form described. If records do not exist in any of categories 1–6, please state that explicitly for each category (rather than denying the entire request) and indicate what substitute records, if any, would contain the same information. This is materially important because the absence of any City-held authoritative record of stop bar location at a cited intersection is itself responsive to my interest in the request, and I will not appeal a partial denial that documents this absence in writing.
>
> **Fee waiver**: I request a fee waiver under 5 ILCS 140/6(c). Disclosure is in the public interest: Chicago issues more than 200,000 red-light citations per year, the geometric reference line is the controlling factual element of the violation, and respondents currently have no independent means to verify the line against which they are being judged. The records are not sought for commercial use; any aggregation will be published publicly so that any Chicago resident challenging an RLC ticket can independently verify the spatial element of the City's case. If any fees are required, please notify me before incurring any charge greater than $25.
>
> **Vendor-held records**: Where responsive records are held by Verra Mobility, Conduent, or Redflex on the City's behalf in their capacity as the City's automated-enforcement contractor, those records are within the City's possession or control under 5 ILCS 140/7(2) and should be obtained from the vendor and produced. Please do not deny categories 2 and 5 on the basis that the records are held by a third party.
>
> **Delivery**: Please send responsive records to [YOUR EMAIL]. If any records are withheld, please cite the specific statutory exemption and identify the withheld records with sufficient specificity to allow appeal under 5 ILCS 140/9.
>
> Under 5 ILCS 140/3(d), I expect a response within 5 business days. If you need additional time, please explain in writing under 5 ILCS 140/3(e).
>
> Thank you,
>
> [YOUR NAME]
> [YOUR ADDRESS]
> [YOUR PHONE]
> [YOUR EMAIL]

---

## Notes for the requester

- **The most likely outcomes**, in descending order of probability:
  1. CDOT produces the **camera-mount intersection list** (already public) and claims it satisfies categories 1–2 → push back: that's the mount, not the stop bar.
  2. CDOT produces **a partial signing-and-striping plan set** for a subset of RLC intersections — useful per-intersection if it covers Rasheed's location at 7200 N Western (Touhy & Western, camera 1251).
  3. CDOT denies categories 2 and 5 citing "trade secret / vendor proprietary" exemption (7(1)(g)). This is the appeal-worthy denial — vendor records held on the City's behalf are City records under 7(2). The argument that the controlling reference line in a public enforcement program is a trade secret is itself a strong story.
  4. CDOT confirms no inventoried stop-bar geometry exists at all. **This response is also useful** — it directly establishes that the City issues hundreds of thousands of red-light citations per year without an authoritative record of the controlling spatial element. That's a procedural-fairness argument we can deploy in every contest letter.
- **Anti-fishing scope tightening**: if a clerk pushes back on breadth, narrow category 1 to "the 365 RLC intersections only" and category 5 to "the current contract period" (Verra Mobility era).
- **Don't take a vendor-proprietary denial lying down.** A camera enforcement system whose controlling reference line is unverifiable by either party is a one-sentence appeal. Use 5 ILCS 140/7(1)(g) carefully — it requires showing actual competitive harm, which doesn't apply to a coordinate value the public already crosses every day.

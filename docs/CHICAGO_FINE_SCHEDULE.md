# Chicago Parking, Standing & Compliance Fine Schedule (Official)

**Source:** City of Chicago Department of Finance — Parking, Standing and Compliance Violations
https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/supp_info/ParkingStandingandComplianceViolations.html

**Last verified:** 2026-04-23

These are the canonical Chicago fine amounts. **Any user-facing copy that names a fine must use these numbers.** If existing code shows a different amount, the code is wrong — fix it to match this schedule. Cross-check this against [PRODUCT_DECISIONS.md](../PRODUCT_DECISIONS.md) — both must agree.

## Most-cited consumer violations (the ones the app helps with)

| Violation | Code | Initial | Late |
|-----------|------|---------|------|
| Street cleaning | 9-64-040(b) | **$60** | $60 |
| Street cleaning (alt sub-codes) | 9-64-040, 9-64-040(a), 9-105-020 | $50 | $50 |
| Snow Route 3 AM – 7 AM (Dec 1 – Apr 1) | 9-64-060 | **$60** | $60 |
| Snow Route 2″ of snow or more | 9-64-070 | **$60** | $60 |
| Residential parking permit | 9-64-090 | **$75** | $75 |
| Expired meter — non-CBD | 9-64-190(a) | **$50** | $50 |
| Expired meter — CBD (Loop) | 9-64-190(b) | **$70** | $70 |
| Rush hour parking | 9-64-080(a) | $100 | $100 |
| No standing / parking time restricted | 9-64-080(b) | $100 | $100 |
| Wrong direction or > 12″ from curb | 9-64-020(a) | $25 | $25 |
| Obstructing roadway | 9-64-020(b) | $75 | $75 |
| Within 15′ of fire hydrant | 9-64-100(a) | **$150** | $100 (late = lower!) |
| Parking in fire lane | 9-64-100(b) | **$150** | $100 |
| Blocking access / alley / driveway / fire lane | 9-64-100(c) | **$150** | $100 |
| Within 20′ of crosswalk | 9-64-100(f) | $60 | $60 |
| Within 20′ of stop sign / traffic signal | 9-64-100(g) | $60 | $60 |
| Double parking — non-CBD | 9-64-110(a)(1) | $100 | $100 |
| Double parking — CBD | 9-64-110(a)(2) | **$250** | $0 |
| Parking on sidewalk | 9-64-110(d) | $60 | $60 |
| Parking on parkway | 9-64-110(e) | $60 | $60 |
| No city sticker (≤16,000 lbs) | 9-64-125(b) | **$200** | $50 |
| No city sticker (>16,000 lbs) | 9-64-125(c) | **$250** | $0 |
| Improper display of city sticker | 9-64-125(d) | $30 | $30 |
| Parking in bus / taxi / carriage stand | 9-64-140 | $100 | $100 |
| Curb loading zone | 9-64-160 | $60 | $60 |
| Disabled parking | 9-64-050(c) | **$150** | $100 |
| Disabled parking zone | 9-64-050(j) | **$250** | $0 |
| Invalid placard | 9-64-050(j)* | **$200** | $50 |
| Expired plate / temporary registration | 9-76-160(b) | $60 | $60 |
| Missing/non-compliant plate | 9-76-160(a) | $60 | $60 |

## Bus lane

| Violation | Code | Initial | Late |
|-----------|------|---------|------|
| Standing/parking in bus lane | 9-12-060 | $90 | $90 |

## Camera violations

| Violation | Code | Initial | Late |
|-----------|------|---------|------|
| Speed camera 6–10 mph over | 9-101-020* | $35 | $35 |
| Speed camera 11+ mph over | 9-101-020** | $100 | $100 |
| Red light camera | 9-102-020 | $100 | $100 |
| 30-day speed camera warning | 9-100-045(b)(1) | $0 | $0 |

## High-fine specialty

| Violation | Code | Initial | Late |
|-----------|------|---------|------|
| Parking/standing on bicycle path | 9-40-060 | **$250** | $0 |
| No or improper muffler | 9-76-140(a) | **$250** | $0 |
| Excessive diesel idling | 9-80-095 | **$250** | $0 |
| Standing unattended with motor running | 9-40-080 | $75 | $75 |

## Low-fine compliance

| Violation | Code | Initial | Late |
|-----------|------|---------|------|
| Unsafe condition | 9-40-170 | $25 | $25 |
| Windshield wipers required | 9-76-030 | $25 | $25 |
| Rear-view mirror required | 9-76-120 | $25 | $25 |
| Burglar alarm > 4 minutes | 9-76-150(b) | $50 | $50 |
| Abandoned vehicle 7+ days / inoperable | 9-80-110(a) | $75 | $75 |

## Notes on usage

- **"Late penalty payment amount"** is the additional amount added when the ticket goes unpaid past the deadline. For most violations the late penalty equals the initial fine (effectively doubling the cost). A few high-fine violations show `$0` late — meaning no further escalation, the original fine stands.
- **Snow Route 2″ ban (9-64-070)** is officially **$60**, not the $150 figure that has appeared in some marketing copy. The "$150+" figure conflates the fine with towing charges (snow route violations almost always trigger a tow, which costs ~$250+ on top of the fine).
- **Boot/tow escalation:** 51,000 boots and 81,000 tows in Chicago in 2024 (source: pricing.tsx). Boot is ~$100, tow + impound is ~$250+.
- **Street cleaning** has multiple sub-codes ($50 and $60). Use **$60** as the canonical figure since 9-64-040(b) is the most commonly cited.

If something here conflicts with [PRODUCT_DECISIONS.md](../PRODUCT_DECISIONS.md), fix one of them — both should match this official source.

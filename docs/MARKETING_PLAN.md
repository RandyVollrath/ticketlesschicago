# Autopilot America Marketing Plan
## Based on 26.8M Chicago Ticket Records (FOIA F118906)

**Last updated:** 2026-03-30
**Data source:** Chicago Dept of Finance FOIA F118906-110325, released 12/2/2025
**Database:** ~/Documents/FOIA/foia.db (SQLite, 8.2GB)

---

## Core Marketing Numbers (all verified, all 2024)

| Stat | Number | Source |
|------|--------|--------|
| Tickets with fines per year | 4,495,907 | F118906 row count where fine_level1 > 0 |
| Total fines charged | $315,321,730 | SUM(fine_level1) |
| Average per registered vehicle | $267/year | $315M / 1.18M registered vehicles |
| Tickets per day | 12,318 | 4.5M / 365 |
| Tickets per hour | 513 | 4.5M / 365 / 24 |
| Uncontested rate (parking) | 94% | dispo field empty on non-camera tickets |
| Win rate when contested (parking) | 68% | Not Liable / (Not Liable + Liable) |
| Camera revenue | $111,002,640 | SUM for red light + speed violations |
| Camera revenue per hour | $12,672 | $111M / 365 / 24 |
| Outstanding unpaid (2019-2024) | $894,204,134 | SUM(current_amount_due) |
| Vehicles booted (2025) | 44,014 | boot_counts table |
| App covers | 85% of revenue ($269M) | SUM for app-covered violation types |
| Autopilot cost | $49/year | — |
| ROI multiple | 5.4x | $267 avg fines / $49 cost |

## Violation-Specific Win Rates (for targeted content)

| Violation | Win Rate | Fine | Tickets/yr | Content Angle |
|-----------|----------|------|------------|---------------|
| Expired Plates | 89% | $60 | 547,807 | "Almost 9 out of 10 win" |
| No City Sticker | 85% | $200 | 181,848 | "$200 ticket, 85% get dismissed" |
| Disabled Parking | 72% | $250 | 12,632 | High fine + high win rate |
| Expired Meter (CBD) | 68% | $70 | 229,055 | Everyone relates to meter tickets |
| Expired Meter (non-CBD) | 66% | $50 | 541,105 | Most common parking ticket |
| Double Parking | 62-69% | $100-250 | 13,414 | High fine in CBD |
| Residential Permit | 52% | $75 | 172,859 | Permit zone confusion |
| Street Cleaning | 30% | $60 | 345,562 | Hardest to beat but most relatable |

## Top Camera Locations (for geo-targeted content)

| Type | Location | Tickets (2024) |
|------|----------|----------------|
| Speed | 10540 S Western Ave | 94,436 |
| Speed | 445 W 127th St | 62,833 |
| Speed | 4909 N Cicero Ave | 62,346 |
| Red Light | Lake Shore Dr & Belmont | 17,640 |
| Red Light | Wentworth & Garfield | 15,718 |
| Red Light | Cicero & I-55 | 14,305 |

---

## Content Strategy

### Platform Priority
1. **TikTok** — faceless slideshows, data-shocking hooks, Chicago geo-targeting
2. **Instagram Reels** — same content cross-posted, carousel posts for data
3. **Reddit** — r/chicago, r/ChicagoSuburbs (value-first, not salesy)
4. **Nextdoor** — hyper-local, ward-specific data
5. **Email drip** — already built, update numbers

### Content Pillars

#### Pillar 1: "Did You Know?" Data Shocks
Format: Faceless TikTok slideshow (5-8 slides)
Frequency: 3-4x/week
Hook pattern: Big number + "in Chicago" + specific detail

#### Pillar 2: "Your Block" Geo-Targeted
Format: Show block-level data for specific neighborhoods
Frequency: 2x/week, rotate neighborhoods
Hook: "If you park on [Street], you need to see this"

#### Pillar 3: "The Contest Secret"
Format: Slideshow explaining win rates per violation
Frequency: 2x/week
Hook: "I FOIA'd the city and found out [X]% of [ticket type] get dismissed"

#### Pillar 4: "Camera Trap" Locations
Format: Map + stats for specific camera locations
Frequency: 1-2x/week
Hook: "This one camera wrote 94,000 tickets last year"

#### Pillar 5: "The $200 Mistake"
Format: Specific ticket type deep-dives
Frequency: 1x/week
Hook: Pain point + solution

---

## TikTok Faceless Slideshow Scripts

### Production Workflow
1. Claude writes slide text + caption
2. Paste into CapCut "Text to Video" or create slides in Canva
3. Use CapCut AI voiceover or trending audio
4. Add Chicago-relevant hashtags
5. Post at peak Chicago hours (7-9am commute, 12-1pm lunch, 6-8pm evening)

### Hashtags (rotate these)
Primary: #chicago #chicagoparking #parkingticket #chicagodriver
Secondary: #streetcleaning #citysticker #redlightcamera #speedcamera
Trending: #didyouknow #thingsiwishiknew #chicagotiktok #fyp

---

## 30-Day Content Calendar

### Week 1: The Big Picture
- Day 1: "$315 Million" (the headline number)
- Day 2: "513 tickets per hour"
- Day 3: "94% never contest"
- Day 4: "68% win when they do"
- Day 5: "$267 per car per year"

### Week 2: Camera Deep-Dives
- Day 8: "One camera: 94,000 tickets"
- Day 9: "Camera revenue per hour: $12,672"
- Day 10: Top 5 speed camera locations
- Day 11: Top 5 red light camera locations
- Day 12: "$111 million from cameras alone"

### Week 3: The Contest Angle
- Day 15: "89% of expired plate tickets get dismissed"
- Day 16: "85% of city sticker tickets get dismissed"
- Day 17: "How to contest a parking ticket in Chicago"
- Day 18: "What happens when you don't pay"
- Day 19: "$894 million in unpaid tickets"

### Week 4: Street-Specific / Neighborhood
- Day 22: Worst wards for tickets (Ward 42 = Loop)
- Day 23: Street cleaning ticket map
- Day 24: "Your block's ticket history" (drive to website)
- Day 25: "FOIA your own tickets for free"
- Day 26: "The math: $267/yr in tickets vs $49/yr protection"

---

## Landing Page
**URL:** autopilotamerica.com/chicago-parking-tickets
**Status:** LIVE
**Content:** Full data story with block lookup + FOIA lookup + pricing CTA

All TikTok/social content should drive to this page with link in bio.

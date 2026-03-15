# Website Page Structure & Pricing Analysis
## Autopilot America — Current Free vs Paid Product Organization

**Analysis Date:** 2026-03-15  
**Codebase:** Ticketless Chicago (autopilotamerica.com)

---

## EXECUTIVE SUMMARY

The website has **TWO COMPLETELY SEPARATE SIGNUP FUNNELS** that lead to different products:

### Path 1: Paid Protection (Autopilot)
- **Entry:** `/start` (10 steps, pre-payment + 5 post-payment)
- **Entry:** `index.tsx` "Become a Founding Member - $49/year"
- **Product:** Automatic ticket monitoring + contest letter mailing
- **Price:** $49/year (foundational member rate, locked for life)
- **Requires:** License plate, mailing address, signup, credit card payment
- **Result:** `is_paid: true`, full feature set

### Path 2: Free Alerts (Quick Start)
- **Entry:** `/quick-start` (5 onboarding steps after auth)
- **Entry:** `index.tsx` "Quick Start (Free)" button
- **Product:** Email/SMS alerts only (street cleaning, snow ban, renewal reminders)
- **Price:** Free forever
- **Requires:** Email, phone, license plate, address (for localized alerts)
- **Result:** `is_paid: false`, limited feature set (no automatic contesting)

---

## 1. HOMEPAGE & MARKETING (`pages/index.tsx`)

### Structure
- **Hero Section:** "Chicago Writes $259M in Parking Tickets Every Year. We fight back — automatically."
- **Two Main CTAs:**
  - `"Become a Founding Member - $49/year"` → `/start` (PAID)
  - `"Quick Start (Free)"` → `/quick-start` (FREE)
- **Below-the-fold sections:**
  - Stats: 94% of tickets go uncontested, 55% of contested tickets win
  - "How it Works" (4 steps: Connect, Monitor, Fight, Track & Learn)
  - "Free Tools Banner" → `/check-your-street` (map tool, no auth required)
  - "Ticket History Banner" → `/ticket-history` (FOIA lookup, free)
  - Data section: Dismissal rates by ticket type (61-76% win rates)
  - **Pricing section:** Side-by-side comparison table

### Pricing Section
```
| Feature | Free Alerts | Autopilot ($49/yr) |
|---------|-------------|-------------------|
| New ticket alerts | ✓ | ✓ |
| Street cleaning reminders | ✓ | ✓ |
| Snow ban alerts | ✓ | ✓ |
| Red light camera alerts | ✓ | ✓ |
| Speed camera alerts | ✓ | ✓ |
| Renewal reminders | ✓ | ✓ |
| Dashboard access | ✓ | ✓ |
| Year-round plate protection | | ✓ |
| Code-specific letters | | ✓ |
| Print, mail, track contests | | ✓ |
| First Dismissal Guarantee | | ✓ |
```

**Key insight:** Free and Paid share the SAME ALERTS. The distinction is automatic contest letter mailing.

### Navigation
- Desktop nav: How it works, Check Your Street, Pricing, FAQ
- Mobile menu: Same links
- Auth state dependent: If logged in → "Dashboard" button; if not → "Login" + "Get Started"

---

## 2. PAID SIGNUP FUNNEL (`pages/start.tsx`)

### 10-Step Funnel
**Pre-payment steps** (5):
1. `plate` → License plate + state selector
2. `city` → City selection (Chicago only for now)
3. `signin` → Google OAuth
4. `value` → Value proposition (3 features: monitoring, letters, guarantee)
5. `price` → $49/year pricing + consent checkbox

**Post-payment steps** (5):
6. `confirmed` → Success page + how-it-works recap
7. `address` → Mailing address (return address for contest letters)
8. `tickets` → Ticket type preferences (which violations to contest)
9. `receipt-forwarding` → Optional email forwarding setup
10. `notifications` → Email/SMS notification preferences

### Key Details
- **OAuth redirect:** Saves funnel state to localStorage, survives OAuth redirect to `/start`
- **Stripe checkout:** Once on `price` step, clicking "Start my protection" redirects to Stripe
- **Post-payment:** On Stripe success redirect (`?checkout=success`), immediately jumps to `confirmed` step
- **Ticket types:** 12 types selectable, defaults to 8 high-win-rate ones (expired plates 76%, city sticker 72%, etc.)
- **Skip options:** Can skip address, ticket types, receipt forwarding, notifications

### Database Operations
On each step:
- `POST /api/start/create-account` — creates account record with plate info
- `POST /api/autopilot/create-checkout` — creates Stripe checkout session
- `POST /api/autopilot/update-settings` — saves address, ticket types, notification preferences

---

## 3. FREE SIGNUP FUNNEL (`pages/quick-start.tsx`)

### 5-Step Onboarding
1. `account` → Email magic link signup (alternative to Google OAuth)
2. `foia` → FOIA request consent + evidence preferences
3. `profile` → Vehicle details (city sticker expiry, plate expiry, emissions test)
4. `forwarding` → Email forwarding setup for receipts
5. `done` → Redirect to `/settings`

### Key Details
- **Email-first:** Has email/magic link option (NOT Google OAuth)
- **FOIA integration:** Can request complete ticket history from City of Chicago
- **Evidence-driven:** Focuses on gathering vehicle documentation upfront
- **No payment:** Ends at dashboard, user is free tier (`is_paid: false`)
- **Pre-fill:** If Google OAuth used, reads user metadata

### Database Operations
- `POST /api/quick-start/create-account` — creates free account
- Supabase direct queries for profile data

---

## 4. ALERTS SIGNUP (`pages/alerts/signup.tsx`)

### Lightweight Signup (NOT a full funnel)
- **Single page form** (no multi-step)
- **Entry:** Email link (from email campaign) OR `/alerts/signup?ref=...`
- **Required fields:**
  - First/last name, email, phone
  - License plate, VIN, make/model
  - City sticker expiry, address, ZIP
  - SMS consent, marketing consent, FOIA consent, contest consent
- **Optional:** City/neighborhood specific alerts

### Key Details
- **No auth required:** Can sign up without Google/email login
- **Direct DB insert:** Creates user_profiles record with is_paid=false
- **Block stats:** Fetches parking violation density for user's address
- **Pre-fill from token:** Can accept &token=... to pre-fill vehicle info
- **Post-signup:** Redirect to `/alerts/success` (confirmation page)

### Database Operations
- No OAuth/auth system used
- Direct Supabase insert to `user_profiles` table
- Creates entry with `is_paid: false`

---

## 5. FREE TOOLS (No Signup Required)

### `/check-your-street`
- **Purpose:** View street cleaning schedules, snow ban routes, permit zones on interactive map
- **Auth:** Not required
- **Data:** Public Chicago DOT data
- **Mobile integration:** Can be opened in mobile app WebView
- **CTA:** Promotes free alerts signup at bottom

### `/ticket-history`
- **Purpose:** FOIA request for user's complete ticket history from City of Chicago
- **Auth:** Not required
- **Process:** Email entry → requests all tickets issued to that license plate
- **Timeline:** 5-7 business days for City to respond
- **CTA:** Promotes paid upgrade after user sees their ticket volume

### `/how-it-works`
- **Purpose:** Educational page on contest process
- **Content:** Explains 68.5% dismissal rate, First Dismissal Guarantee, timeline

### `/cameras`
- **Purpose:** Interactive map of red-light + speed cameras in Chicago
- **Auth:** Not required

---

## 6. MOBILE APP SCREENS

### SettingsScreen (Partial)
- Car Bluetooth pairing
- (Full app not captured, but Settings likely mirrors web settings)

### Key Apps-Only Features
- **Background parking detection:** Bluetooth (Android) + CoreMotion (iOS)
- **Camera alerts:** Native TTS + local notifications
- **Push notifications:** Real-time parking alerts

**No native in-app purchase:** All monetization goes through web checkout

---

## 7. STRIPE PRICING STRUCTURE (`lib/stripe-config.ts`)

### Active Product IDs
```typescript
protectionMonthlyPriceId    // Monthly subscription (not advertised)
protectionAnnualPriceId     // Annual: $49 (ADVERTISED)
cityStickerMbPriceId        // City sticker MB (motorcycle/motorized bicycle)
cityStickerPPriceId         // City sticker P (passenger)
cityStickerLpPriceId        // City sticker LP (light truck)
cityStickerStPriceId        // City sticker ST (sport truck)
cityStickerLtPriceId        // City sticker LT (light truck)
licensePlatePriceId         // Standard license plate
licensePlateVanityPriceId   // Vanity plate
permitFeePriceId            // Permit fee
remitterSetupFeePriceId     // Remitter setup (one-time $12)
propertyTaxAppealPriceId    // Property tax appeal (one-time $179)
```

**Key insight:** Product supports much more than just ticket protection (city sticker renewals, plate replacements, property tax appeals, etc.) but landing page only advertises $49/year protection.

---

## 8. SETTINGS/DASHBOARD (`pages/settings.tsx`)

### Gating (First 100 lines)
- **Requires auth:** If not logged in, redirects to `/auth/signin`
- **Features gated by `is_paid`:**
  - Ticket type preferences (only Paid users can customize)
  - Auto-approval settings (only Paid users)
  - Mailing address (required for paid, optional for free)
  - Receipt forwarding (available to both, but emphasized for paid)
  - Notification preferences (available to both)

### Free User Dashboard
- Can view alerts they've signed up for
- Can't add new plates for automatic contesting
- Can manually check single address
- Can view street cleaning/snow ban info

### Paid User Dashboard
- Can monitor multiple plates
- Can customize which ticket types to contest
- Can enable/disable auto-approval
- Can see contest letter history
- Can view outcomes

---

## 9. CURRENT SIGNUP PATH COMPLEXITY

### Problem: TWO Entry Points, Two Workflows
1. **User lands on `/`** (homepage)
   - Sees two CTAs: "Get Started ($49)" vs "Quick Start (Free)"
   - If clicks "Get Started" → `/start` → 10 steps → payment
   - If clicks "Quick Start" → `/quick-start` → 5 steps → free

2. **User lands on `/alerts/signup`** (email campaign)
   - Single page form
   - Direct signup, no auth, `is_paid: false`

3. **User lands on `/check-your-street`** (social media)
   - Can view map without signup
   - Bottom CTA to `/quick-start` or `/alerts/signup`

4. **User wants to upgrade later**
   - Currently: No in-app upgrade path
   - Must navigate to `/start` manually or use settings

---

## 10. DATABASE SCHEMA IMPLICATIONS

### `user_profiles` table
```sql
user_id (PK)
is_paid BOOLEAN DEFAULT false  -- CRITICAL: defaults to false
license_plate
home_address_full
mailing_address, mailing_city, mailing_state, mailing_zip
email
phone_number
created_at
first_name, last_name
```

### `autopilot_settings` table
```sql
user_id (PK)
allowed_ticket_types (JSON array)
email_on_ticket_found
email_on_letter_mailed
email_on_approval_needed
require_approval
```

### Multiple Subscription Models
- Autopilot/Protection (annual/monthly) — ONE product
- City Sticker (separate product)
- License Plate services (separate)
- Property Tax Appeal (separate)
- **No product bundling:** Each is a separate Stripe price

---

## 11. KEY PAIN POINTS IN CURRENT DESIGN

### Complexity Sources
1. **Separate signup flows** create duplicate logic:
   - `/start` vs `/quick-start` duplicate email validation
   - Address collection happens in BOTH flows (start onboarding + settings)
   - Phone number collected in quick-start but not start

2. **Free tier still requires commitment:**
   - Must provide full name, phone, address, license plate
   - SMS consent required
   - Data collection almost as heavy as paid flow

3. **Unclear value distinction:**
   - Pricing page says "Free Alerts" and "Autopilot" differ
   - But both show ticket alerts, snow alerts, camera alerts
   - Key difference (automatic contesting) not highlighted enough

4. **No in-app upsell:**
   - Free users can't upgrade from dashboard
   - No "Add plate" → upgrade flow
   - No "This feature requires paid" nudge

5. **Mobile app auth complexity:**
   - Separate mobile OAuth flows
   - WebView auth injection for settings page
   - No native monetization (all web-based)

6. **Product scope creep:**
   - Stripe config shows 10 different products/prices
   - Homepage only sells one ($49 protection)
   - Other products (city sticker, plates, tax appeals) visible in code but not marketed

---

## 12. WHAT A SINGLE PAID PRODUCT WOULD SIMPLIFY

### Unified Flow (Proposal)
```
1. Land on homepage
2. See single CTA: "Start Free Trial" → `/start`
3. Onboarding flow:
   - Email/phone/name
   - License plate
   - Address
   - Payment method (add card for paid, skip for trial)
4. Dashboard shows:
   - Ticket monitoring active
   - Trial ends in X days
   - Upgrade button (prominent)
5. After trial: upgrade or lose access
```

### Eliminated Pages
- `/quick-start` (merged into `/start`)
- `/alerts/signup` (merged into `/start`)
- Duplicate onboarding logic

### Unified Database
- Single `user_profiles.trial_until` field
- Single `user_profiles.is_paid` field (no ambiguity)
- Single `user_profiles.plan_type` ('trial' | 'paid' | 'expired')

### Simplified Stripe
- One product: "Autopilot Protection"
- Two prices: "Monthly" and "Annual"
- No city stickers, plates, tax appeals
- Or: Bundled with city sticker auto-renewal

---

## CONCLUSION

The current website architecture has **3 independent signup systems**:
1. **Paid Autopilot** (`/start`) — 10 steps, Stripe payment
2. **Free Alerts** (`/quick-start`) — 5 steps, no payment
3. **Email Signup** (`/alerts/signup`) — 1 page, no payment

This creates:
- Duplicate business logic
- Unclear user journey
- No clear upgrade path
- Data collection scattered across 3 flows

A **single paid product** would consolidate to:
- One signup funnel (feature-gated trial → paid)
- One dashboard (same for all users, features unlock at paid)
- One Stripe product (Protection Annual + Monthly)
- Clear value hierarchy: Free trial → Limited → Full

---

## APPENDIX: File Locations

### Core Pages
- Landing: `/pages/index.tsx`
- Paid signup: `/pages/start.tsx`
- Free signup: `/pages/quick-start.tsx`
- Alerts signup: `/pages/alerts/signup.tsx`
- Settings: `/pages/settings.tsx`
- Free tools: `/pages/check-your-street.tsx`, `/pages/ticket-history.tsx`

### API Endpoints
- Paid checkout: `/api/autopilot/create-checkout`
- Account creation: `/api/start/create-account`
- Settings update: `/api/autopilot/update-settings`

### Configuration
- Stripe: `/lib/stripe-config.ts`
- Colors/theme: Inline in components

### Mobile App
- Settings screen: `/TicketlessChicagoMobile/src/screens/SettingsScreen.tsx`
- Home screen: `/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`
- No in-app monetization (all web-based)


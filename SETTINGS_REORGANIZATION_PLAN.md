# Settings Pages Reorganization Plan

## Current State
- `/settings` - Massive page with everything mixed together
- `/notification-preferences` - Clean, dedicated notification settings page

## Problem
- Duplicate notification controls on both pages
- `/settings` is overwhelming with too many sections
- `/notification-preferences` has better UX but is hidden

## Proposed Solution

### Option 1: Keep Both, Remove Duplicates (Recommended)

**`/settings` becomes a hub/overview page:**
```
┌─────────────────────────────────────┐
│  Profile Settings                    │
│  ────────────────────────────────   │
│                                      │
│  📋 Cards linking to:                │
│  ┌──────────────┐ ┌──────────────┐ │
│  │ 👤 Profile   │ │ 🔔 Notifications │
│  │ Info         │ │                  │
│  └──────────────┘ └──────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ │
│  │ 🚗 Vehicles  │ │ 💳 Billing   │ │
│  │              │ │              │ │
│  └──────────────┘ └──────────────┘ │
└─────────────────────────────────────┘
```

**Changes:**
1. Remove notification toggles from `/settings`
2. Add a card: "🔔 Notification Preferences" → links to `/notification-preferences`
3. Keep profile, vehicle, billing sections on `/settings`

**`/notification-preferences` stays as-is:**
- Dedicated page for all notification settings
- Cleaner, more focused UX
- All the granular controls

### Option 2: Split Into Multiple Pages

Create separate pages for each section:
- `/profile` - Name, email, phone, address
- `/vehicles` - License plates, VINs
- `/notification-preferences` - Already exists
- `/billing` - Subscription, payment methods
- `/settings` - Hub page with links to all of the above

### Option 3: Keep Everything on `/settings`

- Remove `/notification-preferences` entirely
- Keep all settings on one page
- Add "Advanced notification settings" collapsible section

## Recommendation: Option 1

**Why:**
- ✅ Keeps the clean notification UI you like
- ✅ Makes `/settings` less overwhelming
- ✅ Better organization without major refactor
- ✅ Users can find settings logically

**Implementation:**
1. Remove lines 980-1090 from `/settings.tsx` (notification toggles section)
2. Add a notification card that links to `/notification-preferences`
3. Keep everything else on `/settings`

## What Stays Where

### `/settings` keeps:
- ⚠️ Action Required banner
- 👤 Profile Info (name, email, phone)
- 🚗 License Plate & Vehicle
- 📍 Address
- 📅 City Sticker Renewal
- 📸 License Upload (for permit zones)
- 💳 Billing & Subscription
- ❌ Delete Account

### `/settings` removes:
- 🔔 Notification Preferences section (move to card link)

### `/notification-preferences` (no changes):
- All notification settings
- Granular controls
- Quiet hours
- Channel preferences

## Next Steps

1. Review this plan
2. If approved, I'll implement Option 1
3. Deploy and test

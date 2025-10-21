# Vehicle Type Stripe Setup

This document outlines the steps to create Stripe products for different vehicle types and configure the environment variables.

## Vehicle Types and Pricing

Based on Chicago's city sticker pricing:

| Vehicle Type | Code | Annual Price | Description |
|-------------|------|-------------|-------------|
| Motorbike | MB | $53.04 | Motorbike |
| Passenger | P | $100.17 | Vehicle ≤4,500 lbs curb weight, ≤2,499 lbs payload |
| Large Passenger | LP | $159.12 | Vehicle ≥4,501 lbs curb weight, ≤2,499 lbs payload |
| Small Truck | ST | $235.71 | Truck/Van ≤16,000 lbs or ≥2,500 lbs payload |
| Large Truck | LT | $530.40 | Truck/Vehicle ≥16,001 lbs or ≥2,500 lbs payload |

## Stripe Setup Steps

### 1. Create Products in Stripe Dashboard

For each vehicle type, create a one-time payment product:

1. Go to Stripe Dashboard → Products → Create product
2. Use these settings for each product:

**Product 1: City Sticker - Motorbike (MB)**
- Name: `City Sticker - Motorbike`
- Description: `Chicago city sticker renewal for motorbikes`
- Price: `$53.04 USD` (one-time)
- Product metadata:
  - `exclude_from_rewardful`: `true` (to exclude from affiliate commissions)
  - `vehicle_type`: `MB`

**Product 2: City Sticker - Passenger (P)**
- Name: `City Sticker - Passenger`
- Description: `Chicago city sticker renewal for passenger vehicles (≤4,500 lbs)`
- Price: `$100.17 USD` (one-time)
- Product metadata:
  - `exclude_from_rewardful`: `true`
  - `vehicle_type`: `P`

**Product 3: City Sticker - Large Passenger (LP)**
- Name: `City Sticker - Large Passenger`
- Description: `Chicago city sticker renewal for large passenger vehicles (≥4,501 lbs)`
- Price: `$159.12 USD` (one-time)
- Product metadata:
  - `exclude_from_rewardful`: `true`
  - `vehicle_type`: `LP`

**Product 4: City Sticker - Small Truck (ST)**
- Name: `City Sticker - Small Truck`
- Description: `Chicago city sticker renewal for small trucks (≤16,000 lbs)`
- Price: `$235.71 USD` (one-time)
- Product metadata:
  - `exclude_from_rewardful`: `true`
  - `vehicle_type`: `ST`

**Product 5: City Sticker - Large Truck (LT)**
- Name: `City Sticker - Large Truck`
- Description: `Chicago city sticker renewal for large trucks (≥16,001 lbs)`
- Price: `$530.40 USD` (one-time)
- Product metadata:
  - `exclude_from_rewardful`: `true`
  - `vehicle_type`: `LT`

### 2. Get Price IDs

After creating each product, copy the Price ID (starts with `price_`) from the Stripe dashboard.

### 3. Add Environment Variables

Add these environment variables to your `.env.local` file and Vercel environment variables:

```bash
# City Sticker Price IDs by Vehicle Type
STRIPE_CITY_STICKER_MB_PRICE_ID="price_xxxxxxxxxxxxx"    # Motorbike $53.04
STRIPE_CITY_STICKER_P_PRICE_ID="price_xxxxxxxxxxxxx"     # Passenger $100.17
STRIPE_CITY_STICKER_LP_PRICE_ID="price_xxxxxxxxxxxxx"    # Large Passenger $159.12
STRIPE_CITY_STICKER_ST_PRICE_ID="price_xxxxxxxxxxxxx"    # Small Truck $235.71
STRIPE_CITY_STICKER_LT_PRICE_ID="price_xxxxxxxxxxxxx"    # Large Truck $530.40

# Existing License Plate Price IDs
STRIPE_LICENSE_PLATE_PRICE_ID="price_xxxxxxxxxxxxx"      # Standard $155
STRIPE_LICENSE_PLATE_VANITY_PRICE_ID="price_xxxxxxxxxxxxx"  # Vanity $164

# Existing Permit Fee Price ID
STRIPE_PERMIT_FEE_PRICE_ID="price_xxxxxxxxxxxxx"         # Permit Fee $30
```

### 4. Deploy to Vercel

After adding the environment variables locally, add them to Vercel:

```bash
# Add environment variables to Vercel
vercel env add STRIPE_CITY_STICKER_MB_PRICE_ID
vercel env add STRIPE_CITY_STICKER_P_PRICE_ID
vercel env add STRIPE_CITY_STICKER_LP_PRICE_ID
vercel env add STRIPE_CITY_STICKER_ST_PRICE_ID
vercel env add STRIPE_CITY_STICKER_LT_PRICE_ID

# Or use the Vercel dashboard:
# Project Settings → Environment Variables → Add each variable
```

Make sure to add them for all environments:
- Production
- Preview
- Development

## Code Changes Summary

The following files have been updated to support vehicle types:

1. **`pages/protection.tsx`**
   - Added vehicle type state and selector dropdown
   - Updated price calculation based on vehicle type
   - Added vehicle type to checkout data

2. **`pages/api/protection/checkout.ts`**
   - Accepts vehicle type from request
   - Selects appropriate Stripe price ID based on vehicle type
   - Includes vehicle type in session metadata

3. **`pages/api/stripe-webhook.ts`**
   - Saves vehicle type to user profile when creating/updating accounts
   - Logs vehicle type in payment processing

## Testing

1. Navigate to `/protection`
2. Select "City Sticker Renewal"
3. Choose different vehicle types from the dropdown
4. Verify the price updates correctly in the price breakdown
5. Complete checkout and verify:
   - Correct Stripe product is charged
   - Vehicle type is saved to database
   - Confirmation email shows correct pricing

## Database Schema

The `user_profiles` table should have a `vehicle_type` column. If it doesn't exist, add it:

```sql
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(2) DEFAULT 'P';
```

Valid values: 'MB', 'P', 'LP', 'ST', 'LT'

## Notes

- Default vehicle type is 'P' (Passenger) if not specified
- Prices include exact cents to match Chicago's official pricing
- All city sticker products are excluded from Rewardful affiliate commissions via metadata
- Vehicle type is stored in user profile for future renewals

// Estimated gov fees per renewal type. The automation verifies the actual
// fee on the cart page before submitting — this is just the up-front amount
// shown on the authorize-link page so the user knows roughly what they're
// approving.
//
// City sticker (Chicago) fee schedule (Office of the City Clerk, 2026):
//   Passenger Class A (<=4,500 lbs):   $99
//   Passenger Class B (>4,500 lbs):    $144
//   Motorcycle:                         $45
//   Senior (with disability):           $30
//   Large vehicle/truck:               varies, $200+
//
// We derive a defensible estimate from user_profiles.license_plate_type (the
// IL plate type), since we don't separately store the Chicago weight class.
//
// IL plate sticker fee already lives in user_profiles.license_plate_renewal_cost
// (populated by add_license_plate_renewal_support migration), so just read it.

export const CITY_STICKER_DEFAULT_CENTS = 9900;

export function estimateCityStickerCents(
  licensePlateType?: string | null,
): number {
  const t = (licensePlateType || '').toUpperCase().trim();
  switch (t) {
    case 'MOTORCYCLE':
      return 4500;
    case 'C-TRUCK':
    case 'CTRUCK':
    case 'TRUCK':
      return 14400;
    case 'PASSENGER':
    case 'B-TRUCK':
    case 'BTRUCK':
    case '':
    default:
      return CITY_STICKER_DEFAULT_CENTS;
  }
}

export function estimatePlateStickerCents(
  licensePlateRenewalCost?: number | null,
  licensePlateType?: string | null,
): number {
  if (typeof licensePlateRenewalCost === 'number' && licensePlateRenewalCost > 0) {
    return Math.round(licensePlateRenewalCost * 100);
  }
  // Fallback if the precomputed cost is null — use IL SOS standard fees.
  const t = (licensePlateType || '').toUpperCase().trim();
  switch (t) {
    case 'MOTORCYCLE':
      return 4100;
    case 'C-TRUCK':
      return 21800;
    case 'B-TRUCK':
    case 'PASSENGER':
    case '':
    default:
      return 15100;
  }
}

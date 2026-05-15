/**
 * Map a Chicago violation code (e.g. '9-64-010') to a DEFENSE_TEMPLATES
 * key (e.g. 'street_cleaning') from lib/contest-templates.ts.
 *
 * Codes that don't have a dedicated template fall through to 'other_unknown'
 * — which is a generic burden-of-proof letter that still works.
 */

const CODE_TO_TEMPLATE: Record<string, string> = {
  // Parking
  '9-64-010': 'street_cleaning',
  '9-64-125': 'no_city_sticker',
  '9-64-070': 'residential_permit',
  '9-64-170': 'expired_meter',
  '9-64-130': 'fire_hydrant',
  '9-64-180': 'disabled_zone',
  '9-64-110': 'double_parking',
  '9-64-040': 'parking_prohibited',
  '9-76-160': 'expired_plates',
  '9-80-190': 'expired_plates',
  '9-80-040': 'missing_plate',
  // Camera
  '9-12-060': 'bus_lane',
  '9-102-010': 'red_light',
  '9-102-020': 'speed_camera',
  '9-101-020': 'speed_camera',
};

export function violationCodeToTemplateKey(code: string | null | undefined): string {
  if (!code) return 'other_unknown';
  return CODE_TO_TEMPLATE[code] || 'other_unknown';
}

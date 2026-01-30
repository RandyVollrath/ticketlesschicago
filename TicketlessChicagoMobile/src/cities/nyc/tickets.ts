/**
 * NYC Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * NYC uses the Department of Finance for parking violations.
 * Tickets can be contested online through the PVB (Parking Violations Bureau).
 *
 * Contest Portal: https://pvb.311.nyc.gov/
 *
 * NYC has MANY violation codes - this includes the most common ones.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const nycViolationCodes: ViolationCode[] = [
  // Alternate Side Parking (Street Cleaning)
  {
    code: '21',
    description: 'No Parking (Street Cleaning)',
    shortDescription: 'Street cleaning violation',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'ASP was suspended on this date',
      'Sign was missing or obscured',
      'Vehicle was moved before sweeper arrived',
      'Sign not properly posted',
      'Weather emergency',
    ],
    weatherRelated: true,
    signageRelated: true,
    notes: 'Check ASP suspension calendar. NYC suspends ASP on 30+ holidays.',
  },
  // Meter violations
  {
    code: '31',
    description: 'No Standing - Commercial Meter Zone',
    shortDescription: 'Commercial meter zone violation',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Meter malfunction',
      'Sign not visible',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '32',
    description: 'Overtime Parking at Muni-Meter',
    shortDescription: 'Expired meter',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Meter/muni-meter malfunction',
      'ParkNYC app payment error',
      'Receipt displayed but not visible',
      'Recently fed meter (proof of payment)',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '33',
    description: 'Feeding Meter',
    shortDescription: 'Feeding meter to extend time',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Did not exceed posted time limit',
      'Meter does not display time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  // Fire hydrant
  {
    code: '40',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant was obscured/not visible',
      'Hydrant covered by snow',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
  // Double parking
  {
    code: '46',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
      'Medical emergency',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  // No standing
  {
    code: '19',
    description: 'No Standing - Bus Stop',
    shortDescription: 'Parked in bus stop',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Bus stop sign not visible',
      'Markings faded/not visible',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '20',
    description: 'No Parking - Time Limit',
    shortDescription: 'Exceeded time limit',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Time limit sign missing',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  // Crosswalk
  {
    code: '50',
    description: 'Crosswalk',
    shortDescription: 'Parked in crosswalk',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Crosswalk markings faded/not visible',
      'No crosswalk markings present',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
  // School zone
  {
    code: '47',
    description: 'Double Parking - School Zone',
    shortDescription: 'Double parked in school zone',
    fineAmount: 115,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Actively dropping off/picking up student',
      'Not during school hours',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  // Registration/Inspection
  {
    code: '70',
    description: 'Expired Registration',
    shortDescription: 'Registration expired',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Registration renewed before ticket date',
      'Temporary registration displayed',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '71',
    description: 'Expired Inspection Sticker',
    shortDescription: 'Inspection sticker expired',
    fineAmount: 65,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Inspection completed before ticket date',
      'Grace period',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  // Snow emergency
  {
    code: '68',
    description: 'Snow Emergency - Snowy/Icy Street',
    shortDescription: 'Snow emergency violation',
    fineAmount: 250,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Snow emergency not in effect',
      'Street not designated as snow emergency route',
      'Signs not posted',
    ],
    weatherRelated: true,
    signageRelated: true,
  },
];

export const nycTicketConfig: CityTicketConfig = {
  cityId: 'nyc',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'NYC Department of Finance - Parking Violations Operations',
    website: 'https://www.nyc.gov/site/finance/vehicles/services-payments.page',
    contestUrl: 'https://pvb.311.nyc.gov/',
    paymentUrl: 'https://www.nyc.gov/site/finance/vehicles/vehicles-pay-a-parking-ticket.page',
    phone: '311',
    address: 'NYC Department of Finance, 66 John Street, New York, NY 10038',
  },
  violationCodes: nycViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 30,
    onlinePortalUrl: 'https://pvb.311.nyc.gov/',
    mailAddress: 'NYC Department of Finance, Adjudications Division, P.O. Box 29021, New York, NY 10087-9021',
    hearingInfo: 'In-person hearings available at hearing locations in each borough',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 30,
    notes: 'NYC has a robust online contest system. Photo evidence strongly encouraged. Can request in-person hearing if online contest denied.',
  },
  weatherDefenseApplicable: true,
  requiredContestFields: [
    'summonsNumber',
    'plateNumber',
    'plateType',
    'violationDate',
    'contestReason',
  ],
};

/**
 * Get violation by code
 */
export function getViolationByCode(code: string): ViolationCode | undefined {
  return nycViolationCodes.find(v => v.code === code);
}

/**
 * Get weather-related violations
 */
export function getWeatherRelatedViolations(): ViolationCode[] {
  return nycViolationCodes.filter(v => v.weatherRelated);
}

/**
 * Get signage-related violations
 */
export function getSignageRelatedViolations(): ViolationCode[] {
  return nycViolationCodes.filter(v => v.signageRelated);
}

export default nycTicketConfig;

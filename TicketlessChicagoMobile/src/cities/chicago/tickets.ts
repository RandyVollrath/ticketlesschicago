/**
 * Chicago Ticket Contest Configuration
 *
 * REFERENCE IMPLEMENTATION
 *
 * Chicago ticket contesting is done through the Department of Finance.
 * Online contesting is available for most violations.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const chicagoViolationCodes: ViolationCode[] = [
  {
    code: '9-64-050(a)',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street cleaning',
    fineAmount: 65,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'No signs posted',
      'Signs obscured/damaged',
      'Vehicle moved before sweeper arrived',
      'Medical emergency',
      'Inclement weather prevented sign visibility',
    ],
    weatherRelated: true,
    signageRelated: true,
  },
  {
    code: '9-64-170(a)',
    description: 'Residential Permit Parking',
    shortDescription: 'No residential permit displayed',
    fineAmount: 65,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Permit displayed but not visible to officer',
      'Guest permit was displayed',
      'Recently moved, permit in process',
      'Temporary disability',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '9-64-190(a)',
    description: 'Expired Meter',
    shortDescription: 'Meter expired/unpaid',
    fineAmount: 65,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'Payment app error',
      'Meter display not visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '9-64-080',
    description: 'Snow Route Parking Ban',
    shortDescription: 'Parked on snow route during ban',
    fineAmount: 175,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'No snow route signs posted',
      'Ban not in effect at time',
      'Signs obscured by snow',
      'Vehicle was moved before tow',
    ],
    weatherRelated: true,
    signageRelated: true,
  },
  {
    code: '9-64-081',
    description: 'Winter Overnight Parking Ban',
    shortDescription: 'Overnight parking during winter ban',
    fineAmount: 175,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Ban not declared for that night',
      'Vehicle moved before enforcement',
      'Medical emergency',
    ],
    weatherRelated: true,
    signageRelated: false,
    notes: 'Dec 1 - Apr 1, 3am-7am when 2+ inches snow',
  },
  {
    code: '9-64-125',
    description: 'City Vehicle Sticker',
    shortDescription: 'No city vehicle sticker displayed',
    fineAmount: 200,
    lateFee: 60,
    contestable: true,
    commonDefenses: [
      'Sticker purchased, not yet received',
      'New resident, within grace period',
      'Vehicle recently purchased',
      'Exempt vehicle category',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '9-64-100(a)',
    description: 'Rush Hour Parking',
    shortDescription: 'Parked during rush hour restrictions',
    fineAmount: 100,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Signs not clearly posted',
      'Vehicle breakdown/emergency',
      'Temporary disability',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '9-64-110(a)',
    description: 'Fire Hydrant',
    shortDescription: 'Parked within 15 feet of fire hydrant',
    fineAmount: 150,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Hydrant not clearly marked',
      'Hydrant obscured by snow/debris',
      'More than 15 feet from hydrant',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
  {
    code: '9-64-160(a)',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 100,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Active loading/unloading',
      'Medical emergency',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
];

export const chicagoTicketConfig: CityTicketConfig = {
  cityId: 'chicago',
  enabled: true,
  ticketAuthority: {
    name: 'City of Chicago Department of Finance',
    website: 'https://www.chicago.gov/finance',
    contestUrl: 'https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/challenging_702telecomtickets.html',
    paymentUrl: 'https://pay.chicago.gov/',
    phone: '312-744-7275',
    address: 'Department of Finance, City Hall, 121 N. LaSalle Street, Room 107, Chicago, IL 60602',
  },
  violationCodes: chicagoViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 21,
    onlinePortalUrl: 'https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/challenging_702telecomtickets.html',
    mailAddress: 'City of Chicago, Department of Finance, P.O. Box 88292, Chicago, IL 60680-1292',
    hearingInfo: 'In-person hearings available at administrative hearing locations',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 30,
    notes: 'Online contest recommended. Photo evidence strongly encouraged.',
  },
  weatherDefenseApplicable: true,
  requiredContestFields: [
    'ticketNumber',
    'licensePlate',
    'violationDate',
    'contestReason',
    'supportingEvidence',
  ],
};

/**
 * Get violation by code
 */
export function getViolationByCode(code: string): ViolationCode | undefined {
  return chicagoViolationCodes.find(v => v.code === code);
}

/**
 * Get weather-related violations
 */
export function getWeatherRelatedViolations(): ViolationCode[] {
  return chicagoViolationCodes.filter(v => v.weatherRelated);
}

/**
 * Get signage-related violations
 */
export function getSignageRelatedViolations(): ViolationCode[] {
  return chicagoViolationCodes.filter(v => v.signageRelated);
}

export default chicagoTicketConfig;

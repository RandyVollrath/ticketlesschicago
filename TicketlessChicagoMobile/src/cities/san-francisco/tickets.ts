/**
 * San Francisco Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * SF uses SFMTA for parking enforcement.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const sfViolationCodes: ViolationCode[] = [
  {
    code: '7.2.26',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 79,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign damaged or missing',
      'Street sweeper did not pass',
      'Posted days/times incorrect',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '7.2.20',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 96,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'Payment app error',
      'Meter display not working',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '7.2.29',
    description: 'Residential Parking Permit',
    shortDescription: 'No RPP displayed',
    fineAmount: 79,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Permit displayed but not visible',
      'Visitor permit was displayed',
      'New resident, permit in process',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '7.2.43',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 115,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant not marked/visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '7.2.14',
    description: 'Red Zone',
    shortDescription: 'Parked in red curb zone',
    fineAmount: 115,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Red curb faded/not visible',
      'Actively loading/unloading',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '7.2.12',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 115,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '7.2.30',
    description: 'Overtime Parking',
    shortDescription: 'Parked over time limit',
    fineAmount: 79,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Time limit sign not visible',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '7.2.98',
    description: 'Tow-Away Zone',
    shortDescription: 'Parked in tow-away zone',
    fineAmount: 115,
    lateFee: 35,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign unclear',
      'Temporary sign not properly posted',
    ],
    weatherRelated: false,
    signageRelated: true,
    notes: 'SF has tow-away zones during street cleaning hours',
  },
];

export const sfTicketConfig: CityTicketConfig = {
  cityId: 'san-francisco',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'San Francisco Municipal Transportation Agency (SFMTA)',
    website: 'https://www.sfmta.com/getting-around/drive-park/citations',
    contestUrl: 'https://wmq.etimspayments.com/pbw/include/sanfrancisco/contest.jsp',
    paymentUrl: 'https://wmq.etimspayments.com/pbw/include/sanfrancisco/input.jsp',
    phone: '415-701-3000',
    address: 'SFMTA, Citation Services, P.O. Box 7507, San Francisco, CA 94120-7507',
  },
  violationCodes: sfViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail'],
    deadlineDays: 21,
    onlinePortalUrl: 'https://wmq.etimspayments.com/pbw/include/sanfrancisco/contest.jsp',
    mailAddress: 'SFMTA, Citation Services, P.O. Box 7507, San Francisco, CA 94120-7507',
    hearingInfo: 'In-person hearings available upon request',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 21,
    notes: 'Online contest preferred. Photo evidence strongly encouraged.',
  },
  weatherDefenseApplicable: false, // SF rarely has weather-related defenses
  requiredContestFields: [
    'citationNumber',
    'licensePlate',
    'violationDate',
    'contestReason',
  ],
};

export function getViolationByCode(code: string): ViolationCode | undefined {
  return sfViolationCodes.find(v => v.code === code);
}

export default sfTicketConfig;

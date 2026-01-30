/**
 * Los Angeles Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * LA uses LADOT for parking enforcement.
 * Contest online through the City's parking citation portal.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const laViolationCodes: ViolationCode[] = [
  {
    code: '80.69B',
    description: 'Street Sweeping',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 73,
    lateFee: 63,
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
    code: '80.56C4',
    description: 'Preferential Parking',
    shortDescription: 'No permit in preferential parking zone',
    fineAmount: 68,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'Permit displayed but not visible',
      'Guest permit was displayed',
      'New resident, permit in process',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '80.69A',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 63,
    lateFee: 63,
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
    code: '80.69D',
    description: 'Overtime Parking',
    shortDescription: 'Parked over time limit',
    fineAmount: 68,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'Time limit sign not visible',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '80.71A',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 80,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant not marked/visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '80.73A',
    description: 'Red Zone',
    shortDescription: 'Parked in red curb zone',
    fineAmount: 93,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'Red curb faded/not visible',
      'Actively loading/unloading',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '80.70A',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 68,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '80.58L',
    description: 'Posted No Parking',
    shortDescription: 'No parking - posted sign',
    fineAmount: 73,
    lateFee: 63,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign temporary and not properly posted',
      'Sign contradicted by other signs',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
];

export const laTicketConfig: CityTicketConfig = {
  cityId: 'los-angeles',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'City of Los Angeles - Department of Transportation',
    website: 'https://ladot.lacity.org/',
    contestUrl: 'https://prodpci.etimspayments.com/pbw/include/la_parking/input.jsp',
    paymentUrl: 'https://prodpci.etimspayments.com/pbw/include/la_parking/input.jsp',
    phone: '866-561-9744',
    address: 'City of Los Angeles, P.O. Box 30247, Los Angeles, CA 90030-0247',
  },
  violationCodes: laViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail'],
    deadlineDays: 21,
    onlinePortalUrl: 'https://prodpci.etimspayments.com/pbw/include/la_parking/input.jsp',
    mailAddress: 'City of Los Angeles, P.O. Box 30247, Los Angeles, CA 90030-0247',
    hearingInfo: 'In-person hearings available upon request',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 21,
    notes: 'Online contest preferred. Photo evidence strongly encouraged.',
  },
  weatherDefenseApplicable: true,
  requiredContestFields: [
    'citationNumber',
    'licensePlate',
    'violationDate',
    'contestReason',
  ],
};

export function getViolationByCode(code: string): ViolationCode | undefined {
  return laViolationCodes.find(v => v.code === code);
}

export default laTicketConfig;

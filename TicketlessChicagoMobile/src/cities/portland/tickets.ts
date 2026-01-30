/**
 * Portland Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Portland uses PBOT and Circuit Court for parking violations.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const portlandViolationCodes: ViolationCode[] = [
  {
    code: '16.20.220',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 65,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign damaged or missing',
      'Street sweeper did not pass',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '16.20.430',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 44,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'Parking Kitty app error',
      'Meter display not working',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '16.20.800',
    description: 'Area Parking Permit',
    shortDescription: 'No permit displayed',
    fineAmount: 65,
    lateFee: 30,
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
    code: '16.20.130',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 150,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant not marked/visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '16.20.200',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 65,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '16.20.120',
    description: 'No Parking Zone',
    shortDescription: 'No parking zone',
    fineAmount: 65,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign unclear',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '16.20.420',
    description: 'Overtime Parking',
    shortDescription: 'Exceeded time limit',
    fineAmount: 44,
    lateFee: 30,
    contestable: true,
    commonDefenses: [
      'Time limit sign not visible',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
];

export const portlandTicketConfig: CityTicketConfig = {
  cityId: 'portland',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'Portland Bureau of Transportation (PBOT)',
    website: 'https://www.portland.gov/transportation/parking',
    contestUrl: 'https://www.portland.gov/transportation/parking/parking-citations',
    paymentUrl: 'https://www.portland.gov/transportation/parking/parking-citations',
    phone: '503-823-5185',
    address: 'PBOT Parking Enforcement, 1120 SW 5th Avenue, Suite 800, Portland, OR 97204',
  },
  violationCodes: portlandViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 30,
    onlinePortalUrl: 'https://www.portland.gov/transportation/parking/parking-citations',
    mailAddress: 'PBOT Parking Enforcement, 1120 SW 5th Avenue, Suite 800, Portland, OR 97204',
    hearingInfo: 'Can request hearing through Circuit Court',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 30,
    notes: 'Portland allows contest through PBOT portal or Circuit Court.',
  },
  weatherDefenseApplicable: false,
  requiredContestFields: [
    'citationNumber',
    'licensePlate',
    'violationDate',
    'contestReason',
  ],
};

export function getViolationByCode(code: string): ViolationCode | undefined {
  return portlandViolationCodes.find(v => v.code === code);
}

export default portlandTicketConfig;

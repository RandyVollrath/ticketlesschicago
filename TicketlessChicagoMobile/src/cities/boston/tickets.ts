/**
 * Boston Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Boston uses the Parking Clerk for violations.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const bostonViolationCodes: ViolationCode[] = [
  {
    code: 'SWEEP',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 40,
    lateFee: 20,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign damaged or missing',
      'Street sweeper did not pass',
      'Outside sweeping season',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: 'METER',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 40,
    lateFee: 20,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'Payment app error',
      'Receipt displayed but not visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: 'RESIDENT',
    description: 'Resident Parking',
    shortDescription: 'No resident permit',
    fineAmount: 40,
    lateFee: 20,
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
    code: 'HYDRANT',
    description: 'Fire Hydrant',
    shortDescription: 'Within 10 feet of fire hydrant',
    fineAmount: 100,
    lateFee: 20,
    contestable: true,
    commonDefenses: [
      'More than 10 feet from hydrant',
      'Hydrant not marked/visible',
      'Hydrant covered by snow',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
  {
    code: 'SNOW',
    description: 'Snow Emergency',
    shortDescription: 'Snow emergency violation',
    fineAmount: 100,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Snow emergency not in effect',
      'Not a designated snow route',
      'Inadequate notice',
    ],
    weatherRelated: true,
    signageRelated: true,
    notes: 'Boston declares snow emergencies - check @BostonPWD Twitter',
  },
  {
    code: 'DOUBLE',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 55,
    lateFee: 20,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
      'Medical emergency',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: 'CROSSWALK',
    description: 'Crosswalk',
    shortDescription: 'Parked in crosswalk',
    fineAmount: 100,
    lateFee: 20,
    contestable: true,
    commonDefenses: [
      'Crosswalk markings faded/not visible',
      'No crosswalk markings present',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
];

export const bostonTicketConfig: CityTicketConfig = {
  cityId: 'boston',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'City of Boston - Parking Clerk',
    website: 'https://www.boston.gov/departments/parking-clerk',
    contestUrl: 'https://www.boston.gov/departments/parking-clerk/how-appeal-parking-ticket',
    paymentUrl: 'https://www.cityofboston.gov/parking/tickets/',
    phone: '617-635-4410',
    address: 'City of Boston, Parking Clerk, Room 224, City Hall, Boston, MA 02201',
  },
  violationCodes: bostonViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 21,
    onlinePortalUrl: 'https://www.cityofboston.gov/parking/tickets/',
    mailAddress: 'City of Boston, Parking Clerk, Room 224, City Hall, Boston, MA 02201',
    hearingInfo: 'In-person hearings available at City Hall',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 21,
    notes: 'Boston allows online contests through the Parking Clerk portal.',
  },
  weatherDefenseApplicable: true,
  requiredContestFields: [
    'ticketNumber',
    'licensePlate',
    'violationDate',
    'contestReason',
  ],
};

export function getViolationByCode(code: string): ViolationCode | undefined {
  return bostonViolationCodes.find(v => v.code === code);
}

export default bostonTicketConfig;

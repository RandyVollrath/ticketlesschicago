/**
 * Denver Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Denver uses Parking Operations for violations.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const denverViolationCodes: ViolationCode[] = [
  {
    code: '54-531',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 75,
    lateFee: 25,
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
    code: '54-611',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 25,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'ParkMobile app error',
      'Meter display not working',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '54-552',
    description: 'Neighborhood Permit',
    shortDescription: 'No permit displayed',
    fineAmount: 50,
    lateFee: 25,
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
    code: '54-541',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 75,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant not marked/visible',
      'Hydrant covered by snow',
    ],
    weatherRelated: true,
    signageRelated: false,
  },
  {
    code: '54-551',
    description: 'Snow Route',
    shortDescription: 'Snow emergency violation',
    fineAmount: 150,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Snow emergency not in effect',
      'Not a designated snow route',
      'Inadequate notice',
    ],
    weatherRelated: true,
    signageRelated: true,
    notes: 'Denver declares snow emergencies - check @DenverDOTI Twitter',
  },
  {
    code: '54-521',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 75,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '54-501',
    description: 'Overtime Parking',
    shortDescription: 'Exceeded time limit',
    fineAmount: 50,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'Time limit sign not visible',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
];

export const denverTicketConfig: CityTicketConfig = {
  cityId: 'denver',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'City and County of Denver - Parking Operations',
    website: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Transportation-Infrastructure/Parking',
    contestUrl: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Transportation-Infrastructure/Parking/Dispute-a-Citation',
    paymentUrl: 'https://denvergov.org/DPOCitationPayment',
    phone: '720-913-1600',
    address: 'Denver Parking Operations, 201 W. Colfax Avenue, Denver, CO 80202',
  },
  violationCodes: denverViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail'],
    deadlineDays: 30,
    onlinePortalUrl: 'https://denvergov.org/DPOCitationPayment',
    mailAddress: 'Denver Parking Operations, P.O. Box 660, Denver, CO 80201-0660',
    hearingInfo: 'Hearing available upon request',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 30,
    notes: 'Denver allows online contest through the citation payment portal.',
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
  return denverViolationCodes.find(v => v.code === code);
}

export default denverTicketConfig;

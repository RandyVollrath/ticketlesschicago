/**
 * Seattle Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Seattle uses Municipal Court for parking violations.
 * Contest online or request hearing.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const seattleViolationCodes: ViolationCode[] = [
  {
    code: '11.72.065',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 53,
    lateFee: 25,
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
    code: '11.76.005',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 53,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'Meter malfunction',
      'PayByPhone app error',
      'Meter display not working',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '11.72.351',
    description: 'Restricted Parking Zone',
    shortDescription: 'No RPZ permit',
    fineAmount: 53,
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
    code: '11.72.090',
    description: 'Fire Hydrant',
    shortDescription: 'Within 15 feet of fire hydrant',
    fineAmount: 53,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'More than 15 feet from hydrant',
      'Hydrant not marked/visible',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: '11.72.070',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 53,
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
    code: '11.72.100',
    description: 'No Parking Zone',
    shortDescription: 'No parking zone',
    fineAmount: 53,
    lateFee: 25,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Sign unclear',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: '11.72.430',
    description: 'Overtime Parking',
    shortDescription: 'Exceeded time limit',
    fineAmount: 53,
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

export const seattleTicketConfig: CityTicketConfig = {
  cityId: 'seattle',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'Seattle Municipal Court',
    website: 'https://www.seattle.gov/courts/tickets-and-payments/parking-tickets',
    contestUrl: 'https://www.seattle.gov/courts/tickets-and-payments/parking-tickets/dispute-a-parking-ticket',
    paymentUrl: 'https://web6.seattle.gov/courts/ECFPortal/default.aspx',
    phone: '206-233-7000',
    address: 'Seattle Municipal Court, 600 5th Avenue, Seattle, WA 98104',
  },
  violationCodes: seattleViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 15,
    onlinePortalUrl: 'https://web6.seattle.gov/courts/ECFPortal/default.aspx',
    mailAddress: 'Seattle Municipal Court, P.O. Box 34987, Seattle, WA 98124-4987',
    hearingInfo: 'Contested hearings available at Municipal Court',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 15,
    notes: 'Seattle allows "mitigation" (reduce fine) or "contested" (dismiss) hearings.',
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
  return seattleViolationCodes.find(v => v.code === code);
}

export default seattleTicketConfig;

/**
 * Minneapolis Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Minneapolis uses Regulatory Services for parking violations.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const minneapolisViolationCodes: ViolationCode[] = [
  {
    code: '478.170',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 46,
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
    code: '478.310',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 32,
    lateFee: 25,
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
    code: '478.145',
    description: 'Residential Permit',
    shortDescription: 'No permit displayed',
    fineAmount: 46,
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
    code: '478.110',
    description: 'Fire Hydrant',
    shortDescription: 'Within 10 feet of fire hydrant',
    fineAmount: 78,
    lateFee: 25,
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
    code: '478.175',
    description: 'Snow Emergency',
    shortDescription: 'Snow emergency violation',
    fineAmount: 138,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Snow emergency not in effect',
      'Not a snow emergency route',
      'Inadequate notice',
    ],
    weatherRelated: true,
    signageRelated: true,
    notes: 'Minneapolis has strict snow emergency rules - check @MinneapolisSNOW Twitter',
  },
  {
    code: '478.130',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 46,
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
    code: '478.160',
    description: 'Overtime Parking',
    shortDescription: 'Exceeded time limit',
    fineAmount: 32,
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

export const minneapolisTicketConfig: CityTicketConfig = {
  cityId: 'minneapolis',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'City of Minneapolis - Parking Services',
    website: 'https://www.minneapolismn.gov/government/departments/regulatory-services/parking-traffic-control/',
    contestUrl: 'https://www.minneapolismn.gov/government/departments/regulatory-services/parking-traffic-control/parking-ticket-payment-contest/',
    paymentUrl: 'https://www.minneapolismn.gov/government/departments/regulatory-services/parking-traffic-control/parking-ticket-payment-contest/',
    phone: '612-673-2411',
    address: 'City of Minneapolis, Parking Services, 350 S. 5th Street, Room 233, Minneapolis, MN 55415',
  },
  violationCodes: minneapolisViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 21,
    onlinePortalUrl: 'https://www.minneapolismn.gov/government/departments/regulatory-services/parking-traffic-control/parking-ticket-payment-contest/',
    mailAddress: 'City of Minneapolis, Parking Services, 350 S. 5th Street, Room 233, Minneapolis, MN 55415',
    hearingInfo: 'Administrative hearings available upon request',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 21,
    notes: 'Minneapolis allows online contest. Snow emergency violations have different rules.',
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
  return minneapolisViolationCodes.find(v => v.code === code);
}

export default minneapolisTicketConfig;

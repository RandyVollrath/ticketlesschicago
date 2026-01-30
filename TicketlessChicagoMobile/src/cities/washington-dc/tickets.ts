/**
 * Washington DC Ticket Contest Configuration
 *
 * DISABLED BY DEFAULT
 *
 * DC uses DMV for parking violations.
 * Contest online or by mail.
 */

import { CityTicketConfig, ViolationCode } from '../types';

const dcViolationCodes: ViolationCode[] = [
  {
    code: 'P080',
    description: 'Street Cleaning',
    shortDescription: 'Parked during street sweeping',
    fineAmount: 50,
    lateFee: 50,
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
    code: 'P016',
    description: 'Expired Meter',
    shortDescription: 'Meter expired',
    fineAmount: 50,
    lateFee: 50,
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
    code: 'P071',
    description: 'Residential Permit Parking',
    shortDescription: 'No RPP displayed',
    fineAmount: 50,
    lateFee: 50,
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
    code: 'P010',
    description: 'Fire Hydrant',
    shortDescription: 'Within 10 feet of fire hydrant',
    fineAmount: 100,
    lateFee: 100,
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
    code: 'P070',
    description: 'Snow Emergency',
    shortDescription: 'Snow emergency violation',
    fineAmount: 250,
    lateFee: 100,
    contestable: true,
    commonDefenses: [
      'Snow emergency not in effect',
      'Not a designated snow route',
      'Inadequate notice',
    ],
    weatherRelated: true,
    signageRelated: true,
    notes: 'DC declares snow emergencies - check @ABORNSNYC equivalent for DC',
  },
  {
    code: 'P040',
    description: 'Double Parking',
    shortDescription: 'Double parked',
    fineAmount: 100,
    lateFee: 100,
    contestable: true,
    commonDefenses: [
      'Actively loading/unloading',
      'Vehicle breakdown',
    ],
    weatherRelated: false,
    signageRelated: false,
  },
  {
    code: 'P054',
    description: 'No Standing',
    shortDescription: 'No standing zone',
    fineAmount: 100,
    lateFee: 100,
    contestable: true,
    commonDefenses: [
      'Sign not visible',
      'Actively loading/unloading passengers',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
  {
    code: 'P034',
    description: 'Overtime Parking',
    shortDescription: 'Parked over time limit',
    fineAmount: 50,
    lateFee: 50,
    contestable: true,
    commonDefenses: [
      'Time limit sign not visible',
      'Did not exceed time limit',
    ],
    weatherRelated: false,
    signageRelated: true,
  },
];

export const dcTicketConfig: CityTicketConfig = {
  cityId: 'washington-dc',
  enabled: false, // DISABLED BY DEFAULT
  ticketAuthority: {
    name: 'DC Department of Motor Vehicles (DMV)',
    website: 'https://dmv.dc.gov/service/pay-parking-ticket',
    contestUrl: 'https://prodpci.etimspayments.com/pbw/include/dc_parking/input.jsp',
    paymentUrl: 'https://prodpci.etimspayments.com/pbw/include/dc_parking/input.jsp',
    phone: '311',
    address: 'DC DMV, Adjudication Services, 301 C Street NW, Washington, DC 20001',
  },
  violationCodes: dcViolationCodes,
  contestProcess: {
    method: 'multiple',
    availableMethods: ['online', 'mail', 'in-person'],
    deadlineDays: 30,
    onlinePortalUrl: 'https://prodpci.etimspayments.com/pbw/include/dc_parking/input.jsp',
    mailAddress: 'DC DMV, Adjudication Services, P.O. Box 92222, Washington, DC 20090',
    hearingInfo: 'In-person hearings available at Adjudication Services',
    requiresNotarization: false,
    requiresAttorney: false,
    appealAvailable: true,
    appealDeadlineDays: 30,
    notes: 'DC allows online contests. In-person hearings available.',
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
  return dcViolationCodes.find(v => v.code === code);
}

export default dcTicketConfig;

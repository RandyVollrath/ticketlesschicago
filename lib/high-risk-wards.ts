/**
 * High-Risk Ward Configuration
 * Based on street cleaning ticket data from 2020-2025
 *
 * Data Source: Chicago Data Portal - Street Cleaning Violations
 * Analysis: Top 25 wards by total tickets issued
 * Population: ~54,000 residents per ward (average)
 */

export interface HighRiskWardData {
  rank: number;
  ward: number;
  totalTickets: number;
  ticketsPer100Residents: number;
  riskLevel: 'highest' | 'higher';
}

export const HIGH_RISK_WARDS: HighRiskWardData[] = [
  {
    rank: 1,
    ward: 1,
    totalTickets: 71935,
    ticketsPer100Residents: 133.2,
    riskLevel: 'highest'
  },
  {
    rank: 2,
    ward: 26,
    totalTickets: 55250,
    ticketsPer100Residents: 102.3,
    riskLevel: 'highest'
  },
  {
    rank: 3,
    ward: 25,
    totalTickets: 53271,
    ticketsPer100Residents: 98.7,
    riskLevel: 'highest'
  },
  {
    rank: 4,
    ward: 5,
    totalTickets: 48891,
    ticketsPer100Residents: 90.5,
    riskLevel: 'highest'
  },
  {
    rank: 5,
    ward: 44,
    totalTickets: 46595,
    ticketsPer100Residents: 86.3,
    riskLevel: 'highest'
  },
  {
    rank: 6,
    ward: 35,
    totalTickets: 45697,
    ticketsPer100Residents: 84.6,
    riskLevel: 'highest'
  },
  {
    rank: 7,
    ward: 43,
    totalTickets: 44903,
    ticketsPer100Residents: 83.2,
    riskLevel: 'highest'
  },
  {
    rank: 8,
    ward: 46,
    totalTickets: 43851,
    ticketsPer100Residents: 81.2,
    riskLevel: 'highest'
  },
  {
    rank: 9,
    ward: 33,
    totalTickets: 40286,
    ticketsPer100Residents: 74.6,
    riskLevel: 'highest'
  },
  {
    rank: 10,
    ward: 2,
    totalTickets: 40037,
    ticketsPer100Residents: 74.1,
    riskLevel: 'highest'
  },
  {
    rank: 11,
    ward: 31,
    totalTickets: 40037,
    ticketsPer100Residents: 74.1,
    riskLevel: 'higher'
  },
  {
    rank: 12,
    ward: 28,
    totalTickets: 39819,
    ticketsPer100Residents: 73.7,
    riskLevel: 'higher'
  },
  {
    rank: 13,
    ward: 24,
    totalTickets: 39453,
    ticketsPer100Residents: 73.1,
    riskLevel: 'higher'
  },
  {
    rank: 14,
    ward: 3,
    totalTickets: 39026,
    ticketsPer100Residents: 72.3,
    riskLevel: 'higher'
  },
  {
    rank: 15,
    ward: 49,
    totalTickets: 38538,
    ticketsPer100Residents: 71.4,
    riskLevel: 'higher'
  },
  {
    rank: 16,
    ward: 32,
    totalTickets: 37674,
    ticketsPer100Residents: 69.8,
    riskLevel: 'higher'
  },
  {
    rank: 17,
    ward: 4,
    totalTickets: 36310,
    ticketsPer100Residents: 67.2,
    riskLevel: 'higher'
  },
  {
    rank: 18,
    ward: 27,
    totalTickets: 35014,
    ticketsPer100Residents: 64.8,
    riskLevel: 'higher'
  },
  {
    rank: 19,
    ward: 15,
    totalTickets: 34953,
    ticketsPer100Residents: 64.7,
    riskLevel: 'higher'
  },
  {
    rank: 20,
    ward: 37,
    totalTickets: 34775,
    ticketsPer100Residents: 64.4,
    riskLevel: 'higher'
  },
  {
    rank: 21,
    ward: 47,
    totalTickets: 34634,
    ticketsPer100Residents: 64.1,
    riskLevel: 'higher'
  },
  {
    rank: 22,
    ward: 36,
    totalTickets: 33886,
    ticketsPer100Residents: 62.8,
    riskLevel: 'higher'
  },
  {
    rank: 23,
    ward: 30,
    totalTickets: 33728,
    ticketsPer100Residents: 62.5,
    riskLevel: 'higher'
  },
  {
    rank: 24,
    ward: 48,
    totalTickets: 33572,
    ticketsPer100Residents: 62.2,
    riskLevel: 'higher'
  },
  {
    rank: 25,
    ward: 29,
    totalTickets: 31910,
    ticketsPer100Residents: 59.1,
    riskLevel: 'higher'
  }
];

/**
 * Get high-risk ward data for a specific ward number
 */
export function getHighRiskWardData(ward: number | string): HighRiskWardData | null {
  const wardNum = typeof ward === 'string' ? parseInt(ward) : ward;
  return HIGH_RISK_WARDS.find(w => w.ward === wardNum) || null;
}

/**
 * Check if a ward is high-risk (in top 25)
 */
export function isHighRiskWard(ward: number | string): boolean {
  return getHighRiskWardData(ward) !== null;
}

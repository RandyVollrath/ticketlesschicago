// Chicago Municipal Code Ordinances Database
// Source: City of Chicago Municipal Code Title 9 - Vehicles, Traffic, and Rail Transportation

export interface Ordinance {
  code: string;
  title: string;
  description: string;
  fineAmount: number;
  category: 'parking' | 'moving' | 'equipment' | 'sticker' | 'other';
  contestGrounds: string[];
  winProbability?: number; // 0-100, based on historical data
  commonDefenses: string[];
  requiredEvidence: string[];
}

export const CHICAGO_ORDINANCES: { [key: string]: Ordinance } = {
  '9-64-010': {
    code: '9-64-010',
    title: 'Street Cleaning - Parking During Prohibited Hours',
    description: 'No person shall park a vehicle on any street during posted street cleaning hours',
    fineAmount: 60,
    category: 'parking',
    winProbability: 35,
    contestGrounds: [
      'No visible or legible signage posted',
      'Signs were obscured by trees, snow, or other objects',
      'Signs were placed too far from violation location (>1 block)',
      'Street cleaning did not actually occur',
      'Vehicle was moved before street cleaning began',
      'Emergency situation prevented moving vehicle',
      'Signage did not comply with city spacing requirements'
    ],
    commonDefenses: [
      'Photographic evidence of missing or obscured signs',
      'Witness testimony that street was not cleaned',
      'Timestamped photos showing vehicle was moved',
      'Medical emergency documentation'
    ],
    requiredEvidence: [
      'Photos of signage (or lack thereof)',
      'Photos showing street/vehicle location',
      'Timestamp evidence'
    ]
  },

  '9-64-020': {
    code: '9-64-020',
    title: 'Parking in Alley',
    description: 'Parking in public alley prohibited except for loading/unloading',
    fineAmount: 50,
    category: 'parking',
    winProbability: 25,
    contestGrounds: [
      'Vehicle was actively loading/unloading',
      'Alley is not a public alley',
      'Emergency situation',
      'Vehicle was disabled/broken down'
    ],
    commonDefenses: [
      'Delivery receipts showing active loading',
      'Witness statements',
      'Proof of mechanical breakdown'
    ],
    requiredEvidence: [
      'Photos of location',
      'Delivery/moving documentation',
      'Repair receipts if applicable'
    ]
  },

  '9-64-050': {
    code: '9-64-050',
    title: 'Parking in Bus Stop/Stand',
    description: 'Parking prohibited in designated bus stops and stands',
    fineAmount: 100,
    category: 'parking',
    winProbability: 20,
    contestGrounds: [
      'Bus stop signage not present or visible',
      'Curb markings faded or missing',
      'Vehicle disabled in location',
      'Emergency situation'
    ],
    commonDefenses: [
      'Photos showing absence of clear signage',
      'Photos of faded curb markings',
      'Emergency documentation'
    ],
    requiredEvidence: [
      'Photos of bus stop signage and markings',
      'Photos from multiple angles'
    ]
  },

  '9-64-070': {
    code: '9-64-070',
    title: 'Residential Permit Parking Without Permit',
    description: 'Parking in residential permit zones without valid permit',
    fineAmount: 100,
    category: 'parking',
    winProbability: 40,
    contestGrounds: [
      'Valid permit was displayed but not visible to officer',
      'Permit zone signs not clearly posted',
      'Zone boundaries unclear or unmarked',
      'Temporary visitor parking (if zone allows)',
      'Recently moved to area, permit application pending',
      'Signs indicate different time restrictions'
    ],
    commonDefenses: [
      'Photo of displayed permit',
      'Permit purchase/application receipt',
      'Photos showing inadequate signage',
      'Proof of recent move with lease/deed'
    ],
    requiredEvidence: [
      'Photos of vehicle showing permit location',
      'Photos of zone signage',
      'Permit documentation'
    ]
  },

  '9-64-090': {
    code: '9-64-090',
    title: 'Parking in Bike Lane',
    description: 'Parking prohibited in designated bicycle lanes',
    fineAmount: 150,
    category: 'parking',
    winProbability: 18,
    contestGrounds: [
      'Bike lane markings not visible/present',
      'No signage indicating bike lane',
      'Vehicle disabled in location',
      'Emergency situation'
    ],
    commonDefenses: [
      'Photos showing absence of bike lane markings',
      'Weather conditions obscuring markings',
      'Emergency documentation'
    ],
    requiredEvidence: [
      'Photos of street markings',
      'Photos from vehicle perspective'
    ]
  },

  '9-64-100': {
    code: '9-64-100',
    title: 'Snow Route Parking Violation',
    description: 'Parking prohibited on designated snow routes during snow',
    fineAmount: 60,
    category: 'parking',
    winProbability: 30,
    contestGrounds: [
      'No snow route signs posted',
      'Weather conditions did not meet threshold (less than 2 inches)',
      'No snow emergency declared',
      'Vehicle was moved before snow removal',
      'Signs indicate different restrictions'
    ],
    commonDefenses: [
      'Weather data showing snowfall amount',
      'Official city snow emergency records',
      'Photos of signage and conditions'
    ],
    requiredEvidence: [
      'Photos of snow route signage',
      'Weather records for date',
      'City snow emergency declaration status'
    ]
  },

  '9-100-010': {
    code: '9-100-010',
    title: 'City Sticker Required',
    description: 'All vehicles must display current city sticker',
    fineAmount: 120,
    category: 'sticker',
    winProbability: 50,
    contestGrounds: [
      'Sticker was displayed but not visible',
      'Recently purchased vehicle, sticker pending',
      'Sticker was stolen/removed by vandalism',
      'Non-resident vehicle (out of state registration)',
      'Temporary resident (less than 30 days)',
      'Vehicle was sold/transferred'
    ],
    commonDefenses: [
      'Purchase receipt showing recent acquisition',
      'Police report for stolen sticker',
      'Out-of-state registration',
      'Proof of temporary Chicago stay',
      'Bill of sale showing transfer'
    ],
    requiredEvidence: [
      'Vehicle registration',
      'Purchase receipts',
      'Police reports if applicable',
      'Residency documentation'
    ]
  },

  '9-64-170': {
    code: '9-64-170',
    title: 'Expired Meter',
    description: 'Parking at expired meter',
    fineAmount: 65,
    category: 'parking',
    winProbability: 22,
    contestGrounds: [
      'Meter was malfunctioning/broken',
      'Meter did not accept payment',
      'Meter time had not expired at time of ticket',
      'Meter had no visible rates posted',
      'Paid via app but system error occurred'
    ],
    commonDefenses: [
      'Photos of broken meter',
      'App payment receipts with timestamps',
      'Meter malfunction reports',
      'Witness testimony'
    ],
    requiredEvidence: [
      'Photos of meter status',
      'Payment receipts/screenshots',
      'Timestamp documentation'
    ]
  },

  '9-64-180': {
    code: '9-64-180',
    title: 'Parking in Handicapped Zone Without Permit',
    description: 'Parking in handicapped space without proper placard',
    fineAmount: 350,
    category: 'parking',
    winProbability: 15,
    contestGrounds: [
      'Valid handicapped placard was displayed',
      'Medical emergency necessitated parking',
      'No handicapped signage present',
      'Markings not visible'
    ],
    commonDefenses: [
      'Photo of displayed placard',
      'Valid handicapped permit documentation',
      'Medical emergency documentation',
      'Photos of missing/inadequate signage'
    ],
    requiredEvidence: [
      'Handicapped permit documentation',
      'Photos of signage and markings',
      'Photos of placard display'
    ]
  },

  '9-64-130': {
    code: '9-64-130',
    title: 'Parking Too Close to Fire Hydrant',
    description: 'Parking within 15 feet of fire hydrant',
    fineAmount: 100,
    category: 'parking',
    winProbability: 20,
    contestGrounds: [
      'Fire hydrant not visible (snow, vegetation)',
      'Distance measurement was inaccurate',
      'No curb markings indicating hydrant zone',
      'Vehicle disabled at location'
    ],
    commonDefenses: [
      'Photos showing obstruction of hydrant',
      'Measured distance documentation',
      'Photos showing no curb markings',
      'Emergency/breakdown documentation'
    ],
    requiredEvidence: [
      'Photos of fire hydrant and vehicle',
      'Distance measurements',
      'Photos from multiple angles'
    ]
  },

  '9-64-190': {
    code: '9-64-190',
    title: 'Rush Hour Parking Violation',
    description: 'Parking during posted rush hour restrictions',
    fineAmount: 100,
    category: 'parking',
    winProbability: 28,
    contestGrounds: [
      'Rush hour signage not present',
      'Signs were contradictory or confusing',
      'Ticket issued outside posted rush hour times',
      'Vehicle was disabled',
      'Sign did not specify days of week clearly'
    ],
    commonDefenses: [
      'Photos of signage',
      'Timestamp showing time outside restrictions',
      'Documentation of sign confusion'
    ],
    requiredEvidence: [
      'Photos of all relevant signage',
      'Ticket timestamp analysis',
      'Photos showing vehicle position'
    ]
  }
};

// Calculate average win probability by category
export function getAverageWinProbability(category?: string): number {
  const ordinances = Object.values(CHICAGO_ORDINANCES);
  const filtered = category
    ? ordinances.filter(o => o.category === category)
    : ordinances;

  const total = filtered.reduce((sum, o) => sum + (o.winProbability || 0), 0);
  return filtered.length > 0 ? Math.round(total / filtered.length) : 0;
}

// Get ordinance by code
export function getOrdinanceByCode(code: string): Ordinance | null {
  return CHICAGO_ORDINANCES[code] || null;
}

// Search ordinances by description
export function searchOrdinances(query: string): Ordinance[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(CHICAGO_ORDINANCES).filter(o =>
    o.title.toLowerCase().includes(lowerQuery) ||
    o.description.toLowerCase().includes(lowerQuery)
  );
}

// Get all categories
export function getCategories(): string[] {
  const categories = new Set(Object.values(CHICAGO_ORDINANCES).map(o => o.category));
  return Array.from(categories);
}

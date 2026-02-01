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

  // CAMERA ENFORCEMENT VIOLATIONS
  // Note: These have VERY LOW win rates (8-12%) - special handling required

  '9-102-020': {
    code: '9-102-020',
    title: 'Red Light Camera Violation',
    description: 'Automated red light enforcement - vehicle entered intersection after light turned red',
    fineAmount: 100,
    category: 'moving',
    winProbability: 10, // VERY LOW - only 10% succeed
    contestGrounds: [
      'Vehicle entered intersection while light was yellow',
      'Vehicle was stolen at time of violation (police report required)',
      'Medical emergency required running red light',
      'Making way for emergency vehicle (ambulance, fire truck)',
      'Already cited by police officer at the scene for same incident',
      'Camera malfunction or improper calibration',
      'Wrong vehicle identified in photo',
      'Yellow light duration was too short (violation of federal standards)'
    ],
    commonDefenses: [
      'Frame-by-frame video analysis showing yellow light entry',
      'Yellow light timing calculations (must be 3.0-4.0 seconds minimum)',
      'FOIA request for camera calibration records',
      'Police report showing vehicle was stolen',
      'Medical emergency documentation (hospital records)',
      'Witness statement from emergency vehicle operator',
      'Photo evidence showing different vehicle or license plate'
    ],
    requiredEvidence: [
      'CRITICAL: Frame-by-frame analysis of camera footage',
      'Yellow light timing calculations with expert analysis',
      'Police report (if vehicle stolen)',
      'Medical records (if emergency)',
      'Camera calibration records (via FOIA)'
    ]
  },

  '9-102-075': {
    code: '9-102-075',
    title: 'Speed Camera Violation - School/Park Zone',
    description: 'Automated speed enforcement in school or park safety zone - exceeded posted speed limit by 6+ mph',
    fineAmount: 35, // $35 for 6-10 mph over, $100 for 11+ mph over
    category: 'moving',
    winProbability: 8, // VERY LOW - only 8% succeed
    contestGrounds: [
      'Vehicle was stolen at time of violation (police report required)',
      'Camera malfunction or improper calibration',
      'Speedometer was recently calibrated and showed different speed',
      'Emergency situation required exceeding speed limit',
      'Signage for speed camera zone was not properly posted',
      'Camera was not operating during school zone hours (7am-7pm on school days)',
      'Wrong vehicle identified in photo',
      'Speed reading was inaccurate due to multiple vehicles'
    ],
    commonDefenses: [
      'Police report showing vehicle was stolen',
      'FOIA request for camera calibration and maintenance records',
      'Vehicle speedometer calibration certificate',
      'Photo evidence showing improper or missing signage',
      'Documentation that camera operated outside permitted hours',
      'Evidence showing camera captured wrong vehicle',
      'Expert testimony on radar interference or calibration issues'
    ],
    requiredEvidence: [
      'CRITICAL: Camera calibration records (FOIA request)',
      'Speedometer calibration certificate from mechanic',
      'Photos of all speed camera signage',
      'Police report (if vehicle stolen)',
      'Documentation of school/park zone hours',
      'Expert analysis of camera accuracy'
    ]
  },

  '9-102-076': {
    code: '9-102-076',
    title: 'Speed Camera Violation - Child Safety Zone',
    description: 'Automated speed enforcement in child safety zone near schools and parks',
    fineAmount: 35,
    category: 'moving',
    winProbability: 8,
    contestGrounds: [
      'Vehicle was stolen at time of violation',
      'Camera malfunction or improper calibration',
      'Signs not properly posted per city ordinance',
      'Camera operated outside permitted hours',
      'Medical emergency required exceeding speed',
      'Wrong vehicle or license plate in photo',
      'Speed reading inaccurate (multiple vehicles, weather conditions)'
    ],
    commonDefenses: [
      'Police report for stolen vehicle',
      'FOIA records showing camera calibration issues',
      'Photos of missing/improper signage',
      'Time/date analysis showing non-school hours',
      'Medical emergency documentation',
      'Photo comparison showing different vehicle'
    ],
    requiredEvidence: [
      'Camera calibration and maintenance records (FOIA)',
      'Photos of all relevant signage',
      'Police report if applicable',
      'Time/date analysis',
      'Expert witness on camera accuracy'
    ]
  },

  // EQUIPMENT VIOLATIONS

  '9-80-200': {
    code: '9-80-200',
    title: 'Inoperative or Missing Headlights/Taillights',
    description: 'Vehicle operated with broken, missing, or non-functioning headlights or taillights',
    fineAmount: 75,
    category: 'equipment',
    winProbability: 55,
    contestGrounds: [
      'Lights were functional at time of stop (burned out after)',
      'Lights were just repaired/replaced (show receipt)',
      'Daytime violation when lights not required',
      'Officer error - lights were actually working',
      'Emergency situation prevented immediate repair'
    ],
    commonDefenses: [
      'Repair receipt showing lights fixed within 24 hours',
      'Photo/video of working lights',
      'Witness testimony that lights were working',
      'Proof of recent purchase/installation',
      'Timestamp showing daytime hours'
    ],
    requiredEvidence: [
      'Repair receipt with date/time',
      'Photos of repaired lights',
      'Mechanic statement',
      'Purchase receipt for new bulbs/lights'
    ]
  },

  '9-80-190': {
    code: '9-80-190',
    title: 'Expired or Missing Registration',
    description: 'Vehicle operated without valid registration or with expired registration displayed',
    fineAmount: 100,
    category: 'equipment',
    winProbability: 45,
    contestGrounds: [
      'Registration was valid but not visible to officer',
      'Registration renewed but sticker not yet received',
      'Recently purchased vehicle, registration pending',
      'Temporary registration was valid',
      'Out-of-state vehicle (temporary visitor)'
    ],
    commonDefenses: [
      'Current registration receipt',
      'Secretary of State online records showing valid registration',
      'Proof of recent purchase with temp registration',
      'Out-of-state registration with proof of temporary stay'
    ],
    requiredEvidence: [
      'Registration documents',
      'Payment receipt for renewal',
      'Secretary of State records',
      'Vehicle purchase documents if recent'
    ]
  },

  '9-80-040': {
    code: '9-80-040',
    title: 'Obscured or Illegible License Plate',
    description: 'License plate obscured, covered, or not clearly visible',
    fineAmount: 75,
    category: 'equipment',
    winProbability: 40,
    contestGrounds: [
      'Plate was clearly visible at time of violation',
      'Obscured by weather conditions (snow, mud)',
      'Frame/holder came from dealership (not intentional)',
      'Recently cleaned/fixed',
      'Temporary obstruction (bike rack, cargo)'
    ],
    commonDefenses: [
      'Photos showing clean, visible plate',
      'Weather conditions documentation',
      'Dealership frame documentation',
      'Proof of cleaning/repair immediately after'
    ],
    requiredEvidence: [
      'Photos of license plate',
      'Weather reports if applicable',
      'Documentation of obstruction reason'
    ]
  },

  '9-76-190': {
    code: '9-76-190',
    title: 'Excessive Window Tint',
    description: 'Front side windows tinted beyond legal limit (35% light transmission minimum)',
    fineAmount: 100,
    category: 'equipment',
    winProbability: 35,
    contestGrounds: [
      'Tint meets legal requirements (provide measurement)',
      'Medical exemption certificate for window tint',
      'Factory tint within legal limits',
      'Tint was measured incorrectly by officer',
      'Tint has been removed since violation'
    ],
    commonDefenses: [
      'Professional tint meter reading showing compliance',
      'Medical exemption documentation',
      'Factory specifications showing legal tint',
      'Tint removal receipt'
    ],
    requiredEvidence: [
      'Professional light transmission measurement',
      'Medical exemption certificate',
      'Vehicle manufacturer specifications',
      'Proof of tint removal'
    ]
  },

  // MOVING VIOLATIONS (Non-Camera)

  '9-40-100': {
    code: '9-40-100',
    title: 'Disobeying Traffic Control Device',
    description: 'Failure to obey traffic signs or signals (non-camera enforcement)',
    fineAmount: 100,
    category: 'moving',
    winProbability: 30,
    contestGrounds: [
      'Traffic control device was not visible or missing',
      'Sign/signal was obscured by vegetation, weather, or obstruction',
      'Sign/signal was damaged or unclear',
      'Conflicting signals or signs',
      'Emergency situation required disobedience',
      'Officer error or misidentification'
    ],
    commonDefenses: [
      'Photos showing missing or obscured signage',
      'Photos of damaged or unclear signals',
      'Documentation of conflicting traffic controls',
      'Emergency documentation',
      'Witness statements'
    ],
    requiredEvidence: [
      'Photos of traffic control device from driver perspective',
      'Photos showing obstruction or damage',
      'Witness statements',
      'Emergency documentation if applicable'
    ]
  },

  '9-40-025': {
    code: '9-40-025',
    title: 'Failure to Yield to Pedestrian in Crosswalk',
    description: 'Failure to yield right-of-way to pedestrian in marked or unmarked crosswalk',
    fineAmount: 200,
    category: 'moving',
    winProbability: 25,
    contestGrounds: [
      'Pedestrian was not in crosswalk at time of violation',
      'Pedestrian entered crosswalk unsafely (darting out)',
      'Officer did not have clear view of incident',
      'Vehicle was already in intersection when pedestrian entered',
      'Pedestrian gave signal to proceed'
    ],
    commonDefenses: [
      'Dashcam video showing incident',
      'Witness testimony about pedestrian behavior',
      'Photos showing crosswalk location and sight lines',
      'Diagram showing vehicle and pedestrian positions'
    ],
    requiredEvidence: [
      'Dashcam footage if available',
      'Photos of crosswalk and intersection',
      'Witness statements',
      'Diagram of incident'
    ]
  },

  '9-40-165': {
    code: '9-40-165',
    title: 'Illegal Turn or Turn from Wrong Lane',
    description: 'Making prohibited turn or turning from incorrect lane',
    fineAmount: 100,
    category: 'moving',
    winProbability: 32,
    contestGrounds: [
      'No signage prohibiting the turn',
      'Turn signals or lane markings were unclear/missing',
      'Emergency situation required the maneuver',
      'Officer misidentified vehicle or location',
      'Road construction changed normal traffic patterns'
    ],
    commonDefenses: [
      'Photos showing lack of proper signage',
      'Photos of unclear lane markings',
      'Documentation of construction or detours',
      'Witness statements',
      'Emergency documentation'
    ],
    requiredEvidence: [
      'Photos of intersection and signage',
      'Photos of lane markings',
      'Documentation of road conditions',
      'Witness statements'
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

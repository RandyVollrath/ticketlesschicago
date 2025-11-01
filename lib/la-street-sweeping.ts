export interface LAStreetSweepingSchedule {
  route_no: string;
  council_district: string;
  time_start: string;
  time_end: string;
  boundaries: string;
  // Derived fields
  day_of_week?: string; // M, Tu, W, Th, F
  frequency?: string; // "1st & 3rd week" or "2nd & 4th week"
}

export function parseRouteNumber(routeNo: string): { day: string; frequency?: string } {
  const route = routeNo.trim();

  // Extract day from route number (e.g., "10P136 W" -> "W", "10P137 M" -> "M")
  const dayMatch = route.match(/\s+(M|Tu|W|Th|F)$/);

  if (dayMatch) {
    return { day: dayMatch[1] };
  }

  return { day: 'Unknown' };
}

export function getDayName(abbr: string): string {
  const days: { [key: string]: string } = {
    'M': 'Monday',
    'Tu': 'Tuesday',
    'W': 'Wednesday',
    'Th': 'Thursday',
    'F': 'Friday'
  };
  return days[abbr] || abbr;
}

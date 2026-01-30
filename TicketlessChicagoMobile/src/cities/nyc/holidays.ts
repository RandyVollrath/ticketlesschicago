/**
 * NYC Alternate Side Parking Holiday Calendar
 *
 * NYC suspends alternate side parking on 30+ holidays.
 * This is a critical feature - ASP holidays are THE killer feature for NYC drivers.
 */

export interface ASPHoliday {
  date: string; // YYYY-MM-DD
  holiday: string;
  aspSuspended: boolean;
  metersFree: boolean;
}

// 2026 NYC Alternate Side Parking Suspension Calendar
// Source: NYC DOT official calendar
export const NYC_ASP_CALENDAR_2026: ASPHoliday[] = [
  // January
  { date: '2026-01-01', holiday: "New Year's Day", aspSuspended: true, metersFree: true },
  { date: '2026-01-06', holiday: 'Three Kings Day', aspSuspended: true, metersFree: false },
  { date: '2026-01-19', holiday: 'Martin Luther King Jr. Day', aspSuspended: true, metersFree: false },
  { date: '2026-01-28', holiday: "Lunar New Year's Eve", aspSuspended: true, metersFree: false },
  { date: '2026-01-29', holiday: 'Lunar New Year', aspSuspended: true, metersFree: false },

  // February
  { date: '2026-02-12', holiday: "Lincoln's Birthday", aspSuspended: true, metersFree: false },
  { date: '2026-02-16', holiday: 'Presidents Day', aspSuspended: true, metersFree: false },
  { date: '2026-02-17', holiday: 'Losar (Tibetan New Year)', aspSuspended: true, metersFree: false },
  { date: '2026-02-18', holiday: 'Ash Wednesday', aspSuspended: true, metersFree: false },

  // March
  { date: '2026-03-05', holiday: 'Purim', aspSuspended: true, metersFree: false },
  { date: '2026-03-20', holiday: 'Eid al-Fitr (1st day)', aspSuspended: true, metersFree: false },
  { date: '2026-03-21', holiday: 'Eid al-Fitr (2nd day)', aspSuspended: true, metersFree: false },

  // April
  { date: '2026-04-02', holiday: 'Passover (1st day)', aspSuspended: true, metersFree: false },
  { date: '2026-04-03', holiday: 'Passover (2nd day) / Good Friday', aspSuspended: true, metersFree: false },
  { date: '2026-04-02', holiday: 'Holy Thursday', aspSuspended: true, metersFree: false },
  { date: '2026-04-08', holiday: 'Passover (7th day)', aspSuspended: true, metersFree: false },
  { date: '2026-04-09', holiday: 'Passover (8th day)', aspSuspended: true, metersFree: false },

  // May
  { date: '2026-05-21', holiday: 'Solemnity of the Ascension', aspSuspended: true, metersFree: false },
  { date: '2026-05-25', holiday: 'Memorial Day', aspSuspended: true, metersFree: false },
  { date: '2026-05-27', holiday: 'Eid al-Adha (1st day)', aspSuspended: true, metersFree: false },
  { date: '2026-05-28', holiday: 'Eid al-Adha (2nd day)', aspSuspended: true, metersFree: false },
  { date: '2026-05-31', holiday: 'Shavuot (1st day)', aspSuspended: true, metersFree: false },

  // June
  { date: '2026-06-01', holiday: 'Shavuot (2nd day)', aspSuspended: true, metersFree: false },

  // July
  { date: '2026-07-04', holiday: 'Independence Day', aspSuspended: true, metersFree: true },

  // August
  { date: '2026-08-15', holiday: 'Feast of the Assumption', aspSuspended: true, metersFree: false },

  // September
  { date: '2026-09-07', holiday: 'Labor Day', aspSuspended: true, metersFree: false },
  { date: '2026-09-25', holiday: 'Rosh Hashanah (1st day)', aspSuspended: true, metersFree: false },
  { date: '2026-09-26', holiday: 'Rosh Hashanah (2nd day)', aspSuspended: true, metersFree: false },

  // October
  { date: '2026-10-04', holiday: 'Yom Kippur', aspSuspended: true, metersFree: false },
  { date: '2026-10-09', holiday: 'Sukkot (1st day)', aspSuspended: true, metersFree: false },
  { date: '2026-10-10', holiday: 'Sukkot (2nd day)', aspSuspended: true, metersFree: false },
  { date: '2026-10-12', holiday: 'Columbus Day', aspSuspended: true, metersFree: false },
  { date: '2026-10-16', holiday: 'Shemini Atzeret', aspSuspended: true, metersFree: false },
  { date: '2026-10-17', holiday: 'Simchat Torah', aspSuspended: true, metersFree: false },

  // November
  { date: '2026-11-01', holiday: 'All Saints Day', aspSuspended: true, metersFree: false },
  { date: '2026-11-03', holiday: 'Election Day', aspSuspended: true, metersFree: false },
  { date: '2026-11-04', holiday: 'Diwali', aspSuspended: true, metersFree: false },
  { date: '2026-11-11', holiday: 'Veterans Day', aspSuspended: true, metersFree: false },
  { date: '2026-11-26', holiday: 'Thanksgiving', aspSuspended: true, metersFree: true },

  // December
  { date: '2026-12-08', holiday: 'Immaculate Conception', aspSuspended: true, metersFree: false },
  { date: '2026-12-25', holiday: 'Christmas', aspSuspended: true, metersFree: true },
  { date: '2026-12-26', holiday: 'Kwanzaa (1st day)', aspSuspended: true, metersFree: false },
];

/**
 * Check if ASP is suspended on a given date
 */
export function isASPSuspended(date: Date): ASPHoliday | null {
  const dateStr = formatDateYYYYMMDD(date);
  return NYC_ASP_CALENDAR_2026.find((h) => h.date === dateStr) || null;
}

/**
 * Check if meters are free on a given date
 */
export function areMeterssFree(date: Date): boolean {
  const holiday = isASPSuspended(date);
  return holiday?.metersFree ?? false;
}

/**
 * Get upcoming ASP holidays from a given date
 */
export function getUpcomingASPHolidays(
  from: Date,
  count: number = 5
): ASPHoliday[] {
  const fromStr = formatDateYYYYMMDD(from);
  return NYC_ASP_CALENDAR_2026.filter((h) => h.date >= fromStr).slice(0, count);
}

/**
 * Get all ASP holidays for a specific month
 */
export function getASPHolidaysForMonth(year: number, month: number): ASPHoliday[] {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  return NYC_ASP_CALENDAR_2026.filter((h) => h.date.startsWith(monthStr));
}

/**
 * Get total count of ASP suspension days
 */
export function getTotalASPSuspensionDays(): number {
  return NYC_ASP_CALENDAR_2026.filter((h) => h.aspSuspended).length;
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default {
  NYC_ASP_CALENDAR_2026,
  isASPSuspended,
  areMeterssFree,
  getUpcomingASPHolidays,
  getASPHolidaysForMonth,
  getTotalASPSuspensionDays,
};

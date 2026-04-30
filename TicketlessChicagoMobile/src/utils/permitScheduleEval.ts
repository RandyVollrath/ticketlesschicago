// Evaluate a permit-zone restriction-schedule string against a Chicago
// wall-clock instant. Schedule strings come from the city in many shapes:
//   "M-F 8am-6pm"
//   "Mon-Fri 8am-6pm, Sat 8am-12pm"
//   "24 hours"
//   "All times"
//   "8am-6pm Mon-Fri"
//   ""  (no schedule string at all)
//
// We err on the side of "uncertain" rather than guessing wrong. The user
// sees "permit required (hours uncertain)" instead of a confident wrong
// answer — better for trust per CLAUDE.md "never make up numbers" rule.
//
// Time is evaluated in the Chicago timezone — the input Date should
// already be in Chicago wall-clock (use chicagoTime helpers).

import { toChicagoWallClock } from './chicagoTime';

export type ScheduleEval =
  | { state: 'active'; reason: string }
  | { state: 'inactive'; reason: string }
  | { state: 'uncertain'; reason: string };

const DAY_TOKENS: Record<string, number> = {
  // single-letter Chicago shorthand (M-F, S-Sun is ambiguous, so single S is omitted)
  m: 1, t: 2, w: 3, r: 4, f: 5,
  // standard abbreviations
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

interface DayRange { start: number; end: number; }
interface HourRange { startHour: number; endHour: number; } // 0-24, end can be 24 for midnight

interface ParsedRule {
  days: number[]; // explicit list of day-of-week numbers
  hours: HourRange | 'all'; // 'all' means 24-hour rule
  raw: string;
}

function parseDayList(s: string): DayRange | number[] | null {
  const lower = s.toLowerCase().replace(/\./g, '').trim();

  // Range: "M-F", "Mon-Fri", "Mon-Sat"
  const rangeMatch = lower.match(/^([a-z]+)\s*-\s*([a-z]+)$/);
  if (rangeMatch) {
    const start = DAY_TOKENS[rangeMatch[1]];
    const end = DAY_TOKENS[rangeMatch[2]];
    if (start !== undefined && end !== undefined) {
      const days: number[] = [];
      let d = start;
      while (true) {
        days.push(d);
        if (d === end) break;
        d = (d + 1) % 7;
        if (days.length > 7) break;
      }
      return days;
    }
  }

  // Single day: "Sat"
  if (DAY_TOKENS[lower] !== undefined) return [DAY_TOKENS[lower]];

  // M letter range: "M-F" already handled by rangeMatch since 'm' is in DAY_TOKENS via mon
  // Comma list: "Mon, Wed, Fri"
  if (lower.includes(',')) {
    const parts = lower.split(',').map(p => p.trim());
    const days: number[] = [];
    for (const p of parts) {
      const inner = parseDayList(p);
      if (Array.isArray(inner)) days.push(...inner);
      else return null;
    }
    return days;
  }

  return null;
}

// "8am-6pm", "8:30am-6pm", "8 AM - 6 PM"
function parseHourRange(s: string): HourRange | null {
  const cleaned = s.toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?-(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;

  const [, startH, startM, startP, endH, endM, endP] = match;
  let s1 = parseInt(startH, 10);
  let e1 = parseInt(endH, 10);
  const sm = startM ? parseInt(startM, 10) / 60 : 0;
  const em = endM ? parseInt(endM, 10) / 60 : 0;

  const sp = startP || endP; // if start has no period, assume same as end
  const ep = endP || startP;

  if (sp === 'pm' && s1 !== 12) s1 += 12;
  if (sp === 'am' && s1 === 12) s1 = 0;
  if (ep === 'pm' && e1 !== 12) e1 += 12;
  if (ep === 'am' && e1 === 12) e1 = 0;

  return { startHour: s1 + sm, endHour: e1 + em };
}

function parseRule(chunk: string): ParsedRule | null {
  const trimmed = chunk.trim();
  if (!trimmed) return null;

  // "24 hours", "all times", "anytime"
  if (/^(24\s*hours?|all\s*times|anytime|always)$/i.test(trimmed)) {
    return { days: [0, 1, 2, 3, 4, 5, 6], hours: 'all', raw: trimmed };
  }

  // Tokenize on whitespace. The schedule has two parts (days + hours)
  // somewhere in the chunk. Try both orders.
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  // Walk every split point; left side = days, right side = hours, or vice versa.
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join(' ');
    const right = parts.slice(i).join(' ');

    // Try days-then-hours
    const days1 = parseDayList(left);
    const hours1 = parseHourRange(right);
    if (Array.isArray(days1) && hours1) {
      return { days: days1, hours: hours1, raw: trimmed };
    }
    // Try hours-then-days
    const hours2 = parseHourRange(left);
    const days2 = parseDayList(right);
    if (hours2 && Array.isArray(days2)) {
      return { days: days2, hours: hours2, raw: trimmed };
    }
  }
  return null;
}

function parseSchedule(schedule: string): ParsedRule[] | null {
  if (!schedule || !schedule.trim()) return null;
  const chunks = schedule.split(/[,;]|\s+and\s+/i).map(c => c.trim()).filter(Boolean);
  // Re-join chunks if a comma was internal to a day list (e.g. "Mon, Wed, Fri 8am-6pm")
  // Heuristic: if a chunk has no digit, glue it to the next chunk.
  const merged: string[] = [];
  let buffer = '';
  for (const c of chunks) {
    if (buffer) {
      buffer += ', ' + c;
      if (/\d/.test(c)) { merged.push(buffer); buffer = ''; }
    } else if (!/\d/.test(c)) {
      buffer = c;
    } else {
      merged.push(c);
    }
  }
  if (buffer) merged.push(buffer);

  const rules: ParsedRule[] = [];
  for (const chunk of merged) {
    const rule = parseRule(chunk);
    if (rule) rules.push(rule);
  }
  return rules.length > 0 ? rules : null;
}

function ruleIsActiveAt(rule: ParsedRule, dow: number, hourDecimal: number): boolean {
  if (!rule.days.includes(dow)) return false;
  if (rule.hours === 'all') return true;
  const { startHour, endHour } = rule.hours;
  if (startHour <= endHour) {
    return hourDecimal >= startHour && hourDecimal < endHour;
  }
  // Overnight (e.g., 9pm-6am)
  return hourDecimal >= startHour || hourDecimal < endHour;
}

export function evalPermitSchedule(schedule: string | undefined | null, when: Date): ScheduleEval {
  if (!schedule || !schedule.trim()) {
    return { state: 'uncertain', reason: 'Permit zone hours not on file for this block' };
  }

  const rules = parseSchedule(schedule);
  if (!rules) {
    return { state: 'uncertain', reason: `Hours read as "${schedule}" — couldn't auto-evaluate` };
  }

  const chicago = toChicagoWallClock(when);
  const dow = chicago.getDay();
  const hourDecimal = chicago.getHours() + chicago.getMinutes() / 60;

  for (const rule of rules) {
    if (ruleIsActiveAt(rule, dow, hourDecimal)) {
      return { state: 'active', reason: `Enforced ${rule.raw}` };
    }
  }
  return { state: 'inactive', reason: `Not enforced at this time (rule: ${schedule})` };
}

// Chicago timezone helpers for the mobile app. The device may be in any
// timezone (a user travels to NYC, opens the app, asks "what's parking like
// at 7 PM tomorrow at 123 N State"). All restriction logic must evaluate in
// America/Chicago — the rules don't care about the device clock.

const TZ = 'America/Chicago';

// Returns a Date whose UTC fields are the wall-clock fields of "now" in
// Chicago. So getHours(), getDate(), getDay() on the returned Date describe
// Chicago wall-clock, regardless of device timezone.
export function getChicagoNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

// Same idea, but for an arbitrary instant.
export function toChicagoWallClock(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: TZ }));
}

// YYYY-MM-DD in Chicago tz. Used for find-section's startDate/endDate params,
// which are date-only strings interpreted in Chicago.
export function chicagoDateISO(date?: Date): string {
  const d = date ? toChicagoWallClock(date) : getChicagoNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "Tue, May 6" — formatted in Chicago tz from a YYYY-MM-DD string.
export function formatChicagoDate(iso: string): string {
  // Anchor at noon Chicago to avoid DST edge cases shifting the day.
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ,
  });
}

// "7:00 PM" — formatted in Chicago tz from a Date.
export function formatChicagoTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  });
}

// Build a Date instant that represents "this YYYY-MM-DD at this hour:00 in
// Chicago." We do this by computing the offset between Chicago wall-clock
// and UTC for the target date — getTimezoneOffset() on the device can't be
// trusted because the device may not be in Chicago.
export function chicagoDateTimeToInstant(iso: string, hour: number): Date {
  // First guess: treat the wall-clock string as if it were UTC.
  const guess = new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00Z`);
  // Find what wall-clock that instant maps to in Chicago.
  const chicagoWall = toChicagoWallClock(guess);
  const wallMs = Date.UTC(
    chicagoWall.getFullYear(),
    chicagoWall.getMonth(),
    chicagoWall.getDate(),
    chicagoWall.getHours(),
    chicagoWall.getMinutes(),
    chicagoWall.getSeconds(),
  );
  // Difference is the Chicago offset for that date. Subtract to get the
  // true UTC instant whose Chicago wall-clock matches our intent.
  const offsetMs = wallMs - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

// Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD string, in Chicago tz.
export function chicagoDayOfWeek(iso: string): number {
  const d = new Date(iso + 'T12:00:00Z');
  return toChicagoWallClock(d).getDay();
}

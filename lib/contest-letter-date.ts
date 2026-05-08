/**
 * Format a YYYY-MM-DD violation date as "Month D, YYYY" using UTC so the
 * displayed day is exactly the day stored in the database.
 *
 * Why this exists: `detected_tickets.violation_date` is stored as YYYY-MM-DD
 * (date, no time, no zone). Calling `new Date('2026-04-15').toLocaleDateString()`
 * on a server in any timezone behind UTC silently rolls the date back to
 * April 14. The original bug shipped a real customer letter (Jesse Randall,
 * May 2026) saying "April 14, 2026" for a ticket dated 2026-04-15, because
 * the LLM that wrote the letter received the raw ISO string and reformatted
 * it through some implicit local timezone. Pre-formatting in UTC and giving
 * the AI the human-readable form removes the off-by-one entirely.
 */
export function formatViolationDate(dateString: string | null | undefined): string {
  if (!dateString) return 'Unknown date';

  const date = new Date(`${dateString}T00:00:00Z`); // Force UTC interpretation
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();

  return `${month} ${day}, ${year}`;
}

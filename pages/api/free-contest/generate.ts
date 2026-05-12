import type { NextApiRequest, NextApiResponse } from 'next';
import { DEFENSE_TEMPLATES } from '../../../lib/contest-templates';

interface Body {
  full_name?: string;
  email?: string;
  mailing_address?: string;
  mailing_city?: string;
  mailing_state?: string;
  mailing_zip?: string;
  plate?: string;
  plate_state?: string;
  ticket_number?: string;
  violation_date?: string;
  violation_type?: string;
  violation_description?: string;
  amount?: string;
  location?: string;
}

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function formatDateLong(iso: string): string {
  // Accepts YYYY-MM-DD or free text. Returns "Month D, YYYY" or the raw value
  // if parsing fails (we never want to silently rewrite user-entered dates).
  if (!iso) return 'the date indicated';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatAmount(raw: string): string {
  if (!raw) return 'the amount shown';
  const cleaned = raw.replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return raw;
  return `$${n.toFixed(2)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.FREE_CONTEST_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: 'Preview not configured.' });
  }
  const submitted = (req.headers['x-free-contest-password'] || '').toString();
  if (submitted !== expected) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const body = (req.body || {}) as Body;
  const fullName = s(body.full_name);
  const mailingAddress = s(body.mailing_address);
  const mailingCity = s(body.mailing_city);
  const mailingState = s(body.mailing_state);
  const mailingZip = s(body.mailing_zip);
  const plate = s(body.plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const plateState = s(body.plate_state).toUpperCase().slice(0, 2) || 'IL';
  const ticketNumber = s(body.ticket_number);
  const violationDateRaw = s(body.violation_date);
  const violationType = s(body.violation_type) || 'other_unknown';
  const violationDescription = s(body.violation_description) || 'parking violation';
  const amountRaw = s(body.amount);
  const location = s(body.location) || 'the cited location';

  if (!fullName || !mailingAddress || !mailingCity || !mailingState || !mailingZip) {
    return res.status(400).json({ error: 'Name and full mailing address are required.' });
  }
  if (!plate || !ticketNumber || !violationDateRaw) {
    return res.status(400).json({ error: 'Plate, ticket number, and violation date are required.' });
  }

  const template = DEFENSE_TEMPLATES[violationType] || DEFENSE_TEMPLATES.other_unknown;

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const violationDate = formatDateLong(violationDateRaw);
  const amount = formatAmount(amountRaw);

  const body_filled = template.template
    .replace(/{ticket_number}/g, ticketNumber)
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, violationDescription)
    .replace(/{amount}/g, amount)
    .replace(/{location}/g, location)
    .replace(/{plate}/g, plate)
    .replace(/{state}/g, plateState);

  const addressLines = [
    mailingAddress,
    `${mailingCity}, ${mailingState} ${mailingZip}`.trim(),
  ];

  const letter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticketNumber}
License Plate: ${plate} (${plateState})
Violation Date: ${violationDate}
Amount: ${amount}

To Whom It May Concern:

${body_filled}

Thank you for your consideration of this matter.

Sincerely,


${fullName}
${addressLines.join('\n')}`;

  return res.status(200).json({
    letter,
    defenseType: template.type,
    violationType,
  });
}

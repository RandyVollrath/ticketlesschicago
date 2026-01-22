/**
 * Admin endpoint to upload VA findings CSV
 *
 * Accepts the CSV format exported by the cron job:
 * last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_date, amount
 *
 * Only processes rows where ticket_number is filled in (indicating VA found a ticket)
 *
 * On upload:
 * 1. Creates ticket in detected_tickets
 * 2. Generates contest letter in contest_letters
 * 3. Emails user asking for evidence within 72 hours
 * 4. Sets evidence_deadline (72 hours from now)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import { getEvidenceGuidance, generateEvidenceQuestionsHtml, generateQuickTipsHtml } from '../../../../lib/contest-kits/evidence-guidance';

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send email via Resend with automatic retry on rate limits
 * Resend has a rate limit of 2 requests per second
 */
async function sendResendEmailWithRetry(
  payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    reply_to?: string;
  },
  maxRetries: number = 5,
  baseDelayMs: number = 1000
): Promise<{ success: boolean; error?: string; retries?: number }> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'API key not configured' };
  }

  let lastError: string = '';
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // Check for rate limiting (429 status)
      if (response.status === 429) {
        retries = attempt;

        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.log(`⏳ Rate limited by Resend. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
          await sleep(delay);
          continue;
        }

        return {
          success: false,
          error: 'Rate limit exceeded after max retries',
          retries,
        };
      }

      if (!response.ok) {
        const errorText = await response.text();

        // Check if error message indicates rate limiting
        if (errorText.toLowerCase().includes('rate limit') || errorText.toLowerCase().includes('too many requests')) {
          retries = attempt;

          if (attempt < maxRetries) {
            const delay = baseDelayMs * Math.pow(2, attempt);
            console.log(`⏳ Rate limited by Resend. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
            await sleep(delay);
            continue;
          }
        }

        console.error('Resend error:', errorText);
        return { success: false, error: errorText, retries };
      }

      // Success
      if (retries > 0) {
        console.log(`✅ Email sent successfully after ${retries} retries`);
      }

      return { success: true, retries };

    } catch (err: any) {
      lastError = err.message || 'Unknown error';
      retries = attempt;

      // Network errors might be transient, retry
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`⏳ Network error sending email. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(delay);
        continue;
      }
    }
  }

  return {
    success: false,
    error: lastError || 'Max retries exceeded',
    retries,
  };
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false, // We'll handle file parsing ourselves
  },
};

interface ParsedTicket {
  last_name: string;
  first_name: string;
  plate: string;
  state: string;
  user_id: string;
  ticket_number: string;
  violation_code: string;
  violation_type: string;
  violation_date: string;
  amount: string;
  // Optional fields (not required in CSV)
  violation_description?: string;
  location?: string;
}

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

// Default sender address when user hasn't added their own
const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

/**
 * Parse date from various formats that spreadsheets might auto-generate
 * Handles: "1-10-26", "1/10/26", "01-10-2026", "2026-01-10", "1/10/2026", etc.
 * Returns ISO date string (YYYY-MM-DD) or null if unparseable
 */
function parseDateFlexible(dateStr?: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const cleaned = dateStr.trim();
  if (!cleaned) return null;

  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return cleaned;
    }
  }

  // Parse various M/D/Y or M-D-Y formats
  const separatorMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (separatorMatch) {
    let [, month, day, year] = separatorMatch;

    // Handle 2-digit year (assume 20xx for years < 50, 19xx otherwise)
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      year = yearNum < 50 ? `20${year}` : `19${year}`;
    }

    // Pad month and day
    const paddedMonth = month.padStart(2, '0');
    const paddedDay = day.padStart(2, '0');

    const isoDate = `${year}-${paddedMonth}-${paddedDay}`;
    const date = new Date(isoDate);

    // Validate the date is real (e.g., no Feb 30)
    if (!isNaN(date.getTime()) &&
        date.getMonth() + 1 === parseInt(paddedMonth, 10) &&
        date.getDate() === parseInt(paddedDay, 10)) {
      return isoDate;
    }
  }

  // Try native Date parsing as fallback
  const fallbackDate = new Date(cleaned);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString().split('T')[0];
  }

  console.log(`  Warning: Could not parse date "${dateStr}"`);
  return null;
}

// Normalize violation type from various formats to our enum values
function normalizeViolationType(input: string): string {
  const normalized = input.toLowerCase().trim();

  // Map common variations to our enum values
  if (normalized.includes('expired') && (normalized.includes('plate') || normalized.includes('registration') || normalized.includes('sticker'))) {
    return 'expired_plates';
  }
  if (normalized.includes('city sticker') || normalized.includes('no sticker') || normalized.includes('wheel tax')) {
    return 'no_city_sticker';
  }
  if (normalized.includes('meter') || normalized.includes('parking meter')) {
    return 'expired_meter';
  }
  if (normalized.includes('disabled') || normalized.includes('handicap')) {
    return 'disabled_zone';
  }
  if (normalized.includes('street clean') || normalized.includes('sweeping')) {
    return 'street_cleaning';
  }
  if (normalized.includes('rush hour') || normalized.includes('rush-hour') || normalized.includes('tow zone')) {
    return 'rush_hour';
  }
  if (normalized.includes('hydrant') || normalized.includes('fire')) {
    return 'fire_hydrant';
  }
  if (normalized.includes('speed') || normalized.includes('camera')) {
    return 'speed_camera';
  }
  if (normalized.includes('red light')) {
    return 'red_light';
  }

  // If already in correct format, return as-is
  const validTypes = ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
                      'street_cleaning', 'rush_hour', 'fire_hydrant', 'speed_camera',
                      'red_light', 'other_unknown'];
  if (validTypes.includes(normalized)) {
    return normalized;
  }

  return 'other_unknown';
}

// Defense templates by violation type
// These templates request DISMISSAL BY MAIL - not hearings
// Strategy: Challenge the citation, request city's evidence, cite procedural requirements
const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly expired registration.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: Under Illinois law, the City bears the burden of proving the violation occurred. I request the City provide documentation showing the officer verified the registration status through the Illinois Secretary of State database at the time of citation.

2. PROCEDURAL REQUIREMENTS: Chicago Municipal Code Section 9-100-050 requires that parking violations be properly documented. I request copies of any photographs or documentation taken at the time of the alleged violation.

3. REGISTRATION VERIFICATION: Vehicle registration status can change rapidly due to online renewals, grace periods, and processing delays. Without verification through official state records at the exact time of citation, the violation cannot be conclusively established.

I request that this ticket be dismissed. If the City cannot provide adequate documentation supporting this citation, dismissal is the appropriate remedy.`,
  },
  no_city_sticker: {
    type: 'sticker_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly lacking a Chicago city vehicle sticker.

I respectfully request that this citation be DISMISSED for the following reasons:

1. EXEMPTION VERIFICATION: Under Chicago Municipal Code Section 3-56-020, numerous exemptions exist for the wheel tax requirement, including vehicles registered outside Chicago, vehicles owned by disabled persons, and vehicles in transit. The issuing officer cannot determine exemption status by visual inspection alone.

2. BURDEN OF PROOF: The City must prove that the vehicle was required to display a city sticker AND that no valid sticker existed. I request documentation showing the officer verified through City records that no valid sticker was registered to this vehicle.

3. PROCEDURAL REQUIREMENTS: I request any photographs taken at the time of citation and documentation of the officer's verification process.

4. TIMING CONSIDERATIONS: City sticker purchases may not immediately appear in City systems. If this ticket was issued near a renewal deadline or shortly after a purchase, system lag may explain the apparent violation.

I request that this ticket be dismissed. Without documentation proving both the requirement to display AND the absence of a valid sticker in City records, dismissal is appropriate.`,
  },
  expired_meter: {
    type: 'meter_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for an allegedly expired parking meter.

I respectfully request that this citation be DISMISSED for the following reasons:

1. METER FUNCTIONALITY: Chicago parking meters are known to malfunction, fail to accept payment, or display incorrect time remaining. Under Chicago Municipal Code, a citation may be dismissed if the meter was malfunctioning. I request maintenance records for this meter for the week surrounding the citation date.

2. PAYMENT VERIFICATION: If payment was made via the ParkChicago app or other digital payment method, there may be a discrepancy between the app's records and the meter display. I request that the City verify no digital payment was active for this location at the time of citation.

3. SIGNAGE REQUIREMENTS: Metered parking zones must have clear signage indicating hours of operation and rates. I request photographs documenting compliant signage at this location.

4. TIMING ACCURACY: The citation must accurately reflect the time of violation. I request documentation of the precise time the violation was observed and how it was determined that paid time had expired.

I request that this ticket be dismissed. If meter functionality, payment records, or proper signage cannot be verified, dismissal is the appropriate remedy.`,
  },
  disabled_zone: {
    type: 'disability_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking in a disabled zone.

I respectfully request that this citation be DISMISSED for the following reasons:

1. PLACARD/PLATE VERIFICATION: Disability placards and plates may be valid but not visible to the issuing officer due to placement, lighting conditions, or viewing angle. I request any photographs taken showing the vehicle's windshield and license plate areas.

2. ZONE MARKING REQUIREMENTS: Under the Americans with Disabilities Act and Illinois Accessibility Code, disabled parking spaces must be properly marked with both signage and pavement markings. I request documentation that this space met all marking requirements at the time of citation.

3. AUTHORIZATION VERIFICATION: The Secretary of State maintains records of all valid disability placards and plates. I request that the City verify through state records whether a valid authorization existed for this vehicle at the time of citation.

4. PROCEDURAL REQUIREMENTS: Before issuing this citation, the officer should have verified no valid placard was displayed. I request documentation of the verification steps taken.

I request that this ticket be dismissed. Given the serious nature of disability parking violations and the potential for valid authorizations to be overlooked, thorough verification is required before a citation can be upheld.`,
  },
  street_cleaning: {
    type: 'signage_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a street cleaning violation.

I respectfully request that this citation be DISMISSED for the following reasons:

1. SIGNAGE REQUIREMENTS: Chicago Municipal Code requires that street cleaning restrictions be posted with signs that are visible, legible, and accurate. I request photographs documenting all posted signage within 100 feet of where my vehicle was parked, showing the signs were compliant and visible.

2. SCHEDULE VERIFICATION: Street cleaning schedules are frequently modified due to weather, holidays, or operational changes. I request documentation that street cleaning actually occurred on this date at this location, and that the posted schedule matched the actual cleaning.

3. SIGN PLACEMENT: Signs must be posted at intervals that provide adequate notice to drivers. If signage was obscured by foliage, damaged, missing, or improperly placed, the citation should be dismissed.

4. WEATHER CANCELLATION: Street cleaning is often cancelled due to weather conditions. I request verification that cleaning was not cancelled on this date.

I request that this ticket be dismissed. Street cleaning violations require proper notice through compliant signage, and without documentation of proper signage and actual cleaning activity, dismissal is appropriate.`,
  },
  rush_hour: {
    type: 'rush_hour_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a rush hour parking violation.

I respectfully request that this citation be DISMISSED for the following reasons:

1. SIGNAGE CLARITY: Rush hour restrictions must be clearly posted with signs indicating the specific hours and days of restriction. I request photographs of all signage at this location documenting that the restrictions were clearly posted and the signs were not contradictory or confusing.

2. TIME VERIFICATION: The citation must accurately reflect that the violation occurred during posted rush hour restriction times. I request documentation of the precise time of the alleged violation and how it was verified to fall within restricted hours.

3. SIGN VISIBILITY: Signs must be visible and not obscured by foliage, other signs, or obstructions. I request documentation that all required signs were visible from the parking location.

4. CONFLICTING REGULATIONS: Many locations have multiple parking signs with different restrictions. If signs at this location presented conflicting or confusing information, dismissal is appropriate.

I request that this ticket be dismissed. Rush hour restrictions require clear, unambiguous signage, and without documentation of compliant signage and accurate timing, dismissal is the appropriate remedy.`,
  },
  fire_hydrant: {
    type: 'distance_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking too close to a fire hydrant.

I respectfully request that this citation be DISMISSED for the following reasons:

1. DISTANCE MEASUREMENT: Illinois law requires vehicles to park at least 15 feet from a fire hydrant. I request documentation of how the distance was measured at the time of citation. Visual estimation alone is insufficient to establish a violation.

2. PHOTOGRAPHIC EVIDENCE: I request any photographs taken at the time of citation showing the vehicle's position relative to the hydrant, including reference points that would allow accurate distance determination.

3. HYDRANT VISIBILITY: If the hydrant was obscured by snow, vegetation, construction equipment, or other obstructions, I could not have reasonably known of its location. I request documentation of the hydrant's visibility at the time of citation.

4. MEASUREMENT METHODOLOGY: The 15-foot requirement is measured from the nearest point of the vehicle to the nearest point of the hydrant. Without documented measurement methodology, the violation cannot be conclusively established.

I request that this ticket be dismissed. Fire hydrant violations require accurate distance measurement, and without documented evidence of the actual distance, dismissal is appropriate.`,
  },
  // Note: Red light camera and speed camera tickets excluded due to legal complexity
  other_unknown: {
    type: 'general_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date}.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: The City bears the burden of proving the alleged violation occurred. I request all documentation, photographs, and evidence supporting this citation.

2. PROCEDURAL REQUIREMENTS: Under Chicago Municipal Code, parking violations must be properly documented at the time of citation. I request verification that all procedural requirements were followed.

3. SIGNAGE COMPLIANCE: If this violation relates to posted restrictions, I request photographs documenting that all required signage was properly posted, visible, and unambiguous at the time of the alleged violation.

4. EVIDENCE REQUEST: I request copies of any photographs taken, officer notes, and all other documentation related to this citation.

I request that this ticket be dismissed. Without adequate documentation supporting the alleged violation, dismissal is the appropriate remedy.`,
  },
};

function parseCSV(content: string): ParsedTicket[] {
  const lines = content.split('\n');
  const tickets: ParsedTicket[] = [];

  // Find the header line (skip comment lines starting with #)
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      headerIndex = i;
      break;
    }
  }

  const headerLine = lines[headerIndex];
  if (!headerLine) return tickets;

  // Parse header to get column indices
  // Normalize headers: lowercase, remove quotes, convert spaces to underscores
  const headers = headerLine.split(',').map(h =>
    h.trim().toLowerCase().replace(/"/g, '').replace(/\s+/g, '_')
  );

  // Map expected columns (also try common alternative names)
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    colIndex[h] = i;
    // Also map alternative column names
    if (h === 'ticketnumber' || h === 'ticket_num' || h === 'ticket_#') colIndex['ticket_number'] = i;
    if (h === 'violationtype' || h === 'violation') colIndex['violation_type'] = i;
    if (h === 'violationcode' || h === 'violation_#' || h === 'code') colIndex['violation_code'] = i;
    if (h === 'violationdate' || h === 'date') colIndex['violation_date'] = i;
    if (h === 'lastname') colIndex['last_name'] = i;
    if (h === 'firstname') colIndex['first_name'] = i;
    if (h === 'userid') colIndex['user_id'] = i;
    if (h === 'licenseplate' || h === 'license_plate') colIndex['plate'] = i;
  });

  // Process data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Parse CSV line (handle quoted values)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim()); // Last value

    // Extract values by column name
    const getValue = (key: string): string => {
      const idx = colIndex[key];
      if (idx === undefined) return '';
      return (values[idx] || '').replace(/^"|"$/g, '').trim();
    };

    const ticket: ParsedTicket = {
      last_name: getValue('last_name'),
      first_name: getValue('first_name'),
      plate: getValue('plate'),
      state: getValue('state'),
      user_id: getValue('user_id'),
      ticket_number: getValue('ticket_number'),
      violation_code: getValue('violation_code'),
      violation_type: normalizeViolationType(getValue('violation_type')),
      violation_description: getValue('violation_description'),
      violation_date: getValue('violation_date'),
      amount: getValue('amount'),
      location: getValue('location'),
    };

    // Only include rows where ticket_number is filled in
    if (ticket.ticket_number && ticket.plate) {
      tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * Generate letter content from template
 */
function generateLetterContent(
  ticketData: {
    ticket_number: string;
    violation_date: string | null;
    violation_description: string | null;
    violation_type: string;
    amount: number | null;
    location: string | null;
    plate: string;
    state: string;
  },
  profile: UserProfile,
  template: { type: string; template: string }
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const violationDate = ticketData.violation_date
    ? new Date(ticketData.violation_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date indicated';

  // Build full address
  const addressLines = [
    profile.mailing_address,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  const fullName = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Vehicle Owner';

  // Replace template variables
  let content = template.template
    .replace(/{ticket_number}/g, ticketData.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticketData.violation_description || 'parking violation')
    .replace(/{amount}/g, ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'the amount shown')
    .replace(/{location}/g, ticketData.location || 'the cited location')
    .replace(/{plate}/g, ticketData.plate)
    .replace(/{state}/g, ticketData.state);

  // Build full letter
  const fullLetter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticketData.ticket_number}
License Plate: ${ticketData.plate} (${ticketData.state})
Violation Date: ${violationDate}
Amount: ${ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${fullName}
${addressLines.join('\n')}`;

  return fullLetter;
}


/**
 * Send email to admin when VA upload has errors
 */
async function sendAdminUploadNotification(
  filename: string,
  results: {
    processed: number;
    ticketsCreated: number;
    skipped: number;
    errors: string[];
  }
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping admin notification');
    return false;
  }

  const hasErrors = results.errors.length > 0;
  const hasIssues = hasErrors || results.ticketsCreated === 0;

  // Only send notification if there are issues
  if (!hasIssues) {
    return true;
  }

  const statusColor = hasErrors ? '#dc2626' : '#f59e0b'; // Red for errors, yellow for warnings
  const statusText = hasErrors ? 'Upload Had Errors' : 'No Tickets Created';

  const errorsHtml = results.errors.length > 0
    ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin: 0 0 12px; color: #991b1b; font-size: 16px;">Errors (${results.errors.length})</h3>
        <ul style="margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 13px; line-height: 1.8;">
          ${results.errors.map(e => `<li>${e}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${statusColor}; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">VA Upload ${statusText}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Admin Notification</p>
      </div>

      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          A VA upload was just processed with the following results:
        </p>

        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Filename:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${filename}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Rows Processed:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${results.processed}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tickets Created:</td>
              <td style="padding: 8px 0; color: ${results.ticketsCreated > 0 ? '#059669' : '#dc2626'}; font-size: 14px; font-weight: 600;">${results.ticketsCreated}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Skipped:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${results.skipped}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Errors:</td>
              <td style="padding: 8px 0; color: ${results.errors.length > 0 ? '#dc2626' : '#059669'}; font-size: 14px; font-weight: 600;">${results.errors.length}</td>
            </tr>
          </table>
        </div>

        ${errorsHtml}

        <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
          Please review the upload and correct any issues. Common problems include:
        </p>
        <ul style="color: #6b7280; font-size: 14px; line-height: 1.8;">
          <li>Mismatched plate numbers (plate not found in system)</li>
          <li>Invalid date formats (use YYYY-MM-DD)</li>
          <li>Missing required columns (ticket_number, plate)</li>
          <li>Duplicate tickets (already in system)</li>
        </ul>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated notification from Autopilot America Admin.
        </p>
      </div>
    </div>
  `;

  const result = await sendResendEmailWithRetry({
    from: 'Autopilot America <alerts@autopilotamerica.com>',
    to: ['randyvollrath@gmail.com'], // Admin email
    subject: `VA Upload ${statusText} - ${results.errors.length} errors, ${results.ticketsCreated}/${results.processed} tickets created`,
    html,
  });

  if (result.success) {
    console.log('Admin notification sent' + (result.retries ? ` (after ${result.retries} retries)` : ''));
    return true;
  } else {
    console.error('Admin notification failed:', result.error);
    return false;
  }
}

/**
 * Send email to user about detected ticket
 * Uses the evidence guidance system to provide ticket-specific questions,
 * win rates, tips, and pitfalls to help users provide the most useful evidence.
 */
async function sendTicketDetectedEmail(
  userEmail: string,
  userName: string,
  ticketId: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  location: string | null,
  plate: string,
  evidenceDeadline: Date
): Promise<boolean> {
  const formattedDeadline = evidenceDeadline.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  const violationTypeDisplay = violationType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());

  // Get ticket-specific evidence guidance (includes win rates, tips, and smart questions)
  const guidance = getEvidenceGuidance(violationType);
  const questionsHtml = generateEvidenceQuestionsHtml(guidance);
  const quickTipsHtml = generateQuickTipsHtml(guidance);

  // Format win rate as percentage
  const winRatePercent = Math.round(guidance.winRate * 100);

  // Color the win rate based on odds
  const winRateColor = guidance.winRate >= 0.5 ? '#059669' : guidance.winRate >= 0.3 ? '#d97706' : '#dc2626';
  const winRateText = guidance.winRate >= 0.5 ? 'Good odds!' : guidance.winRate >= 0.3 ? 'Worth trying' : 'Challenging but possible';

  // Generate pitfalls HTML
  const pitfallsHtml = guidance.pitfalls.length > 0 ? `
    <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <h4 style="margin: 0 0 8px; color: #991b1b; font-size: 14px;">⚠️ Avoid These Mistakes</h4>
      <ul style="margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 13px; line-height: 1.6;">
        ${guidance.pitfalls.map(p => `<li>${p}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${guidance.title}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Your evidence can make the difference</p>
      </div>

      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hi ${userName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          ${guidance.intro}
        </p>

        <!-- Win Rate Badge -->
        <div style="text-align: center; margin: 20px 0;">
          <div style="display: inline-block; background: ${winRateColor}; color: white; padding: 12px 24px; border-radius: 20px;">
            <span style="font-size: 24px; font-weight: bold;">${winRatePercent}%</span>
            <span style="font-size: 14px; margin-left: 8px;">Win Rate • ${winRateText}</span>
          </div>
        </div>

        <!-- Ticket Details -->
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #374151; font-size: 16px;">Ticket Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Ticket Number:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${ticketNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Violation Type:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${violationTypeDisplay}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Violation Date:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${violationDateFormatted}</td>
            </tr>
            ${amount ? `<tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">$${amount.toFixed(2)}</td>
            </tr>` : ''}
            ${location ? `<tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${location}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">License Plate:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${plate}</td>
            </tr>
          </table>
        </div>

        <!-- Evidence Questions -->
        <div style="background: #fffbeb; border: 2px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 16px; color: #92400e; font-size: 18px;">📝 Help Us Win Your Case</h3>
          <p style="margin: 0 0 16px; color: #92400e; font-size: 14px; line-height: 1.6;">
            Please <strong>reply to this email</strong> with answers to these questions. Each question is designed to get the evidence that wins cases:
          </p>
          ${questionsHtml}
        </div>

        <!-- Quick Tips -->
        ${quickTipsHtml}

        <!-- Pitfalls -->
        ${pitfallsHtml}

        <!-- Deadline -->
        <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>⏰ Evidence Deadline:</strong> ${formattedDeadline}
          </p>
          <p style="margin: 8px 0 0; color: #1e40af; font-size: 14px;">
            We will send your contest letter with or without evidence after this deadline.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
          No evidence? No problem. We'll automatically send a contest letter on your behalf after the deadline. But any evidence you provide significantly increases your chances of winning!
        </p>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated email from Autopilot America.<br>
          Questions? Reply to this email or contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;

  // Use ticket-specific reply-to so evidence goes to the right ticket
  // Format: evidence+TICKET_ID@autopilotamerica.com (plus addressing)
  const ticketSpecificReplyTo = `evidence+${ticketId}@autopilotamerica.com`;

  const result = await sendResendEmailWithRetry({
    from: 'Autopilot America <alerts@autopilotamerica.com>',
    to: [userEmail],
    subject: guidance.emailSubject,
    html,
    reply_to: ticketSpecificReplyTo,
  });

  if (result.success) {
    if (result.retries) {
      console.log(`Email sent to ${userEmail} after ${result.retries} retries`);
    }
    return true;
  } else {
    console.error('Email send failed:', result.error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the uploaded file
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB limit

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read file content
    const content = fs.readFileSync(file.filepath, 'utf-8');

    // Parse CSV
    const tickets = parseCSV(content);

    if (tickets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No tickets with ticket_number found in CSV. Make sure the VA filled in ticket data.'
      });
    }

    console.log(`📥 Processing ${tickets.length} ticket findings from VA upload`);

    // Track detailed info for each row
    interface RowResult {
      row: number;
      plate: string;
      state: string;
      ticket_number: string;
      status: 'created' | 'skipped' | 'error';
      reason?: string;
      usingDefaultAddress?: boolean;
      emailFailed?: boolean;
      noEmail?: boolean;
    }

    const results = {
      success: true,
      processed: tickets.length,
      ticketsCreated: 0,
      lettersGenerated: 0,
      emailsSent: 0,
      skipped: 0,
      errors: [] as string[],
      rowDetails: [] as RowResult[],
    };

    // Calculate evidence deadline (72 hours from now)
    const now = new Date();
    const evidenceDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const rowNum = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

      try {
        // Find the monitored plate - use user_id from CSV if provided (handles multiple users with same plate)
        let plateQuery = supabaseAdmin
          .from('monitored_plates')
          .select('id, user_id')
          .eq('plate', ticket.plate.toUpperCase())
          .eq('state', ticket.state.toUpperCase())
          .eq('status', 'active');

        // If user_id is in CSV, filter by it (critical when multiple users monitor same plate)
        if (ticket.user_id) {
          plateQuery = plateQuery.eq('user_id', ticket.user_id);
        }

        const { data: plates, error: plateError } = await plateQuery;
        const plate = plates?.[0]; // Take first match

        if (!plate) {
          console.log(`  Skipping ${ticket.plate}: No active monitored plate found`);
          results.skipped++;
          results.rowDetails.push({
            row: rowNum,
            plate: ticket.plate,
            state: ticket.state,
            ticket_number: ticket.ticket_number,
            status: 'skipped',
            reason: `Plate ${ticket.plate} (${ticket.state}) not found in monitored plates`,
          });
          continue;
        }

        // Check if ticket already exists
        const { data: existingTicket } = await supabaseAdmin
          .from('detected_tickets')
          .select('id')
          .eq('ticket_number', ticket.ticket_number)
          .single();

        if (existingTicket) {
          console.log(`  Skipping ${ticket.ticket_number}: Already exists`);
          results.skipped++;
          results.rowDetails.push({
            row: rowNum,
            plate: ticket.plate,
            state: ticket.state,
            ticket_number: ticket.ticket_number,
            status: 'skipped',
            reason: `Ticket #${ticket.ticket_number} already exists in system`,
          });
          continue;
        }

        // Get user profile for letter generation
        const { data: profile } = await supabaseAdmin
          .from('user_profiles')
          .select('*')
          .eq('user_id', plate.user_id)
          .single();

        // Get user email
        const { data: userData } = await supabaseAdmin
          .from('auth.users')
          .select('email')
          .eq('id', plate.user_id)
          .single();

        // Try to get email from auth.users directly via admin API
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(plate.user_id);
        const userEmail = authUser?.user?.email;

        // Parse amount if provided
        let amount: number | null = null;
        if (ticket.amount) {
          const parsed = parseFloat(ticket.amount.replace(/[^0-9.]/g, ''));
          if (!isNaN(parsed)) amount = parsed;
        }

        // Parse the date flexibly (handles "1-10-26", "1/10/2026", "2026-01-10", etc.)
        const parsedDate = parseDateFlexible(ticket.violation_date);

        // Create ticket record with evidence deadline
        const { data: newTicket, error: ticketError } = await supabaseAdmin
          .from('detected_tickets')
          .insert({
            user_id: plate.user_id,
            plate_id: plate.id,
            plate: ticket.plate.toUpperCase(),
            state: ticket.state.toUpperCase(),
            ticket_number: ticket.ticket_number,
            violation_code: ticket.violation_code || null,
            violation_type: ticket.violation_type || 'other_unknown',
            violation_description: ticket.violation_description || null,
            violation_date: parsedDate,
            amount: amount,
            location: ticket.location || null,
            status: 'pending_evidence',
            found_at: now.toISOString(),
            source: 'va_upload',
            evidence_requested_at: now.toISOString(),
            evidence_deadline: evidenceDeadline.toISOString(),
          })
          .select()
          .single();

        if (ticketError || !newTicket) {
          const errorMsg = `Failed to create ticket ${ticket.ticket_number}: ${ticketError?.message}`;
          results.errors.push(errorMsg);
          results.rowDetails.push({
            row: rowNum,
            plate: ticket.plate,
            state: ticket.state,
            ticket_number: ticket.ticket_number,
            status: 'error',
            reason: ticketError?.message || 'Unknown database error',
          });
          continue;
        }

        results.ticketsCreated++;
        results.rowDetails.push({
          row: rowNum,
          plate: ticket.plate,
          state: ticket.state,
          ticket_number: ticket.ticket_number,
          status: 'created',
        });
        console.log(`  Created ticket ${ticket.ticket_number} for plate ${ticket.plate}`);

        // Generate contest letter - use default address if user hasn't added their own
        const template = DEFENSE_TEMPLATES[ticket.violation_type] || DEFENSE_TEMPLATES.other_unknown;

        // Build profile with fallback to default address
        const letterProfile: UserProfile = {
          full_name: profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Vehicle Owner',
          first_name: profile?.first_name || null,
          last_name: profile?.last_name || null,
          mailing_address: profile?.mailing_address || DEFAULT_SENDER_ADDRESS.address,
          mailing_city: profile?.mailing_city || DEFAULT_SENDER_ADDRESS.city,
          mailing_state: profile?.mailing_state || DEFAULT_SENDER_ADDRESS.state,
          mailing_zip: profile?.mailing_zip || DEFAULT_SENDER_ADDRESS.zip,
        };

        const usingDefaultAddress = !profile?.mailing_address;

        const letterContent = generateLetterContent(
          {
            ticket_number: ticket.ticket_number,
            violation_date: parsedDate,
            violation_description: ticket.violation_description || null,
            violation_type: ticket.violation_type || 'other_unknown',
            amount: amount,
            location: ticket.location || null,
            plate: ticket.plate.toUpperCase(),
            state: ticket.state.toUpperCase(),
          },
          letterProfile,
          template
        );

        const { error: letterError } = await supabaseAdmin
          .from('contest_letters')
          .insert({
            ticket_id: newTicket.id,
            user_id: plate.user_id,
            letter_content: letterContent,
            letter_text: letterContent, // Also save to letter_text for compatibility
            defense_type: template.type,
            status: 'pending_evidence',
            using_default_address: usingDefaultAddress,
          });

        if (!letterError) {
          results.lettersGenerated++;
          if (usingDefaultAddress) {
            console.log(`    Generated contest letter (using default address - user has no mailing address)`);
            // Note in row details that default address was used
            const rowDetail = results.rowDetails.find(r => r.row === rowNum);
            if (rowDetail) {
              rowDetail.usingDefaultAddress = true;
            }
          } else {
            console.log(`    Generated contest letter`);
          }
        } else {
          console.error(`    Failed to generate letter: ${letterError.message}`);
          results.errors.push(`Failed to generate letter for ticket ${ticket.ticket_number}: ${letterError.message}`);
        }

        // Send email notification to user
        if (userEmail) {
          const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'there';
          const emailSent = await sendTicketDetectedEmail(
            userEmail,
            userName,
            newTicket.id,
            ticket.ticket_number,
            ticket.violation_type || 'other_unknown',
            ticket.violation_date || null,
            amount,
            ticket.location || null,
            ticket.plate.toUpperCase(),
            evidenceDeadline
          );

          if (emailSent) {
            results.emailsSent++;
            console.log(`    Sent evidence request email to ${userEmail}`);
          } else {
            console.error(`    Failed to send email to ${userEmail}`);
            const rowDetail = results.rowDetails.find(r => r.row === rowNum);
            if (rowDetail) {
              rowDetail.emailFailed = true;
            }
          }
        } else {
          console.log(`    No email found for user ${plate.user_id}`);
          const rowDetail = results.rowDetails.find(r => r.row === rowNum);
          if (rowDetail) {
            rowDetail.noEmail = true;
          }
        }

        // Log to audit
        await supabaseAdmin
          .from('ticket_audit_log')
          .insert({
            ticket_id: newTicket.id,
            user_id: plate.user_id,
            action: 'ticket_detected',
            details: {
              source: 'va_upload',
              evidence_deadline: evidenceDeadline.toISOString(),
              email_sent: userEmail ? true : false,
            },
            performed_by: 'va_upload',
          });

      } catch (err: any) {
        const errorMsg = `Error processing ${ticket.ticket_number}: ${err.message}`;
        results.errors.push(errorMsg);
        results.rowDetails.push({
          row: rowNum,
          plate: ticket.plate,
          state: ticket.state,
          ticket_number: ticket.ticket_number,
          status: 'error',
          reason: err.message || 'Unexpected error',
        });
      }
    }

    // Log the upload
    await supabaseAdmin
      .from('va_uploads')
      .insert({
        original_filename: file.originalFilename || 'upload.csv',
        row_count: tickets.length,
        tickets_created: results.ticketsCreated,
        letters_generated: results.lettersGenerated,
        letters_sent: 0,
        errors: results.errors.length > 0 ? results.errors : null,
        status: results.ticketsCreated > 0 ? 'complete' : 'no_tickets',
        created_at: new Date().toISOString(),
      });

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    console.log(`✅ VA Upload complete:`, results);

    // Send admin notification if there were any issues
    await sendAdminUploadNotification(
      file.originalFilename || 'upload.csv',
      results
    );

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process upload'
    });
  }
}

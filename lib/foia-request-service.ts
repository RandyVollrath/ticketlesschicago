/**
 * FOIA Evidence Request Service
 *
 * Automates Freedom of Information Act requests to the Chicago Department of Finance
 * for parking ticket enforcement records. When the city fails to produce records,
 * it becomes a powerful argument: "Prima Facie Case Not Established by City."
 *
 * FOIA submission: email to DOFfoia@cityofchicago.org
 * Legal basis: Illinois FOIA (5 ILCS 140)
 * Response deadline: 5 business days (can extend to 10 with written notice)
 *
 * For the user's OWN ticket copies (not enforcement records), no FOIA needed:
 * Mail to: City of Chicago, Attention: Ticket Copies, P.O. Box 6289, Chicago, IL 60680-6289
 * But we want enforcement records (officer notes, photos, device data) — that requires FOIA.
 */

import { nanoid } from 'nanoid';

/**
 * Generate a unique reference ID for an evidence FOIA request.
 * Prefix APE = Autopilot Evidence. Included in the email subject for
 * reliable response matching when the city replies.
 */
export function generateEvidenceReferenceId(): string {
  return `APE-${nanoid(12)}`;
}

// Records we request based on violation type
const BASE_RECORDS = [
  'The issuing officer\'s field notes, observations, and contemporaneous written records for this citation',
  'Any photographs taken by the issuing officer at the time of the citation',
  'The handheld citation device data and timestamps for this ticket, including GPS coordinates',
];

const VIOLATION_SPECIFIC_RECORDS: Record<string, string[]> = {
  street_cleaning: [
    'Street cleaning schedule and route map for this block on the violation date',
    'GPS tracking data showing whether the street sweeper actually serviced this block on the violation date',
    'Sign posting records and most recent sign survey for this block',
  ],
  expired_meter: [
    'Meter maintenance and repair logs for the meter at this location for the 30 days preceding the violation',
    'Meter calibration records and last inspection date',
    'ParkChicago or payment system transaction records for this meter/zone at the time of the citation',
  ],
  no_city_sticker: [
    'City vehicle sticker purchase records associated with this license plate number',
    'Any grace period or exemption records for this vehicle',
  ],
  expired_plates: [
    'Illinois Secretary of State registration status query results for this plate at the time of the citation',
  ],
  fire_hydrant: [
    'Sign posting records and curb marking maintenance records for this fire hydrant location',
    'Any photographs or measurements documenting the distance between the cited vehicle and the hydrant',
  ],
  residential_permit: [
    'Current residential permit zone map and boundary documentation for this location',
    'Sign posting records for the permit zone signage at this block',
    'Any temporary or visitor permits associated with this vehicle or address',
  ],
  no_standing_time_restricted: [
    'Sign posting records and most recent sign survey for this block',
    'Any temporary restriction orders (construction, events) in effect at this location on the violation date',
  ],
  snow_route: [
    'Snow emergency declaration time and official notification records for the violation date',
    'Public notification records (website, social media, alert systems) for this snow emergency',
  ],
  bike_lane: [
    'Lane marking maintenance and last repaint date for the bike lane at this location',
    'Camera system calibration and accuracy records if this was an automated citation',
  ],
  bus_lane: [
    'Camera system calibration, accuracy testing, and maintenance records for the bus lane enforcement camera at this location',
    'Most recent system accuracy audit for this enforcement camera',
  ],
  speed_camera: [
    'Speed camera calibration records, accuracy testing results, and maintenance logs for the camera at this location for the 90 days preceding the violation',
    'The complete violation video/image package including all frames captured, with chain of custody documentation',
    'Speed limit signage survey and posting records for this location',
    'Camera vendor maintenance visit logs and any system error/fault reports for this camera for the 30 days preceding the violation',
  ],
  red_light: [
    'Red light camera calibration records, accuracy testing results, and maintenance logs for the camera at this intersection for the 90 days preceding the violation',
    'Yellow light timing records and the complete signal timing plan (including yellow change interval duration, all-red clearance interval, and cycle length) for this intersection on the violation date',
    'The complete violation video/image package including all frames captured, with chain of custody documentation',
    'The intersection width (curb-to-curb measurement) and approach speed limit for each approach',
    'The most recent traffic engineering study or safety analysis conducted for this intersection',
    'Camera vendor maintenance visit logs and any system error/fault reports for this camera for the 30 days preceding the violation',
  ],
  parking_prohibited: [
    'Sign posting records and most recent sign survey for this block',
    'Any temporary restriction orders (construction, events, film permits) in effect at this location on the violation date',
  ],
  commercial_loading: [
    'Loading zone permit and designation records for this location',
    'Sign posting records showing loading zone hours and restrictions',
  ],
  disabled_zone: [
    'Disability parking space designation records for this location',
    'Sign and pavement marking maintenance records for this disability parking space',
  ],
  double_parking: [
    'Any photographs taken by the issuing officer documenting the double-parking condition',
  ],
  missing_plate: [
    'Photographs documenting the alleged missing or obscured plate condition',
  ],
  parking_alley: [],
  bus_stop: [
    'CTA bus stop designation records and route information for this location',
    'Sign and curb marking maintenance records for this bus stop',
  ],
};

/**
 * Build the list of records to request for a specific violation type.
 */
export function getRecordsToRequest(violationType: string): string[] {
  const specific = VIOLATION_SPECIFIC_RECORDS[violationType] || [];
  return [...BASE_RECORDS, ...specific];
}

/**
 * Generate a FOIA request email body (plain text) for a specific ticket.
 */
export function generateFoiaRequestEmail(params: {
  ticketNumber: string;
  violationDate: string; // formatted date string
  violationLocation: string; // e.g. "1234 N Main St"
  violationType: string;
  violationDescription: string;
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string; // full mailing address
  plate: string;
  referenceId?: string; // Unique tracking ID for response matching
}): { subject: string; body: string } {
  const records = getRecordsToRequest(params.violationType);

  const recordsList = records
    .map((r, i) => `   ${i + 1}. ${r}`)
    .join('\n');

  const refSuffix = params.referenceId ? ` [Ref: ${params.referenceId}]` : '';
  const subject = `FOIA Request - Parking Citation #${params.ticketNumber} - Enforcement Records${refSuffix}`;

  const body = `Department of Finance
FOIA Officer
121 North LaSalle Street, 7th Floor
Chicago, Illinois 60602

Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Re: Freedom of Information Act Request
    Parking Citation #${params.ticketNumber}
    Violation Date: ${params.violationDate}
    Location: ${params.violationLocation}
    Vehicle Plate: ${params.plate}

Dear FOIA Officer:

Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am writing on behalf of ${params.requesterName}, the registered owner of the vehicle cited above (plate: ${params.plate}). ${params.requesterName} has authorized Autopilot America to act as their agent for the purpose of submitting this FOIA request and receiving responsive records. A copy of this authorization is on file and available upon request.

On behalf of ${params.requesterName}, I am requesting copies of the following records related to the above-referenced citation:

${recordsList}

These records are requested in connection with the administrative contest of this citation by the vehicle owner.

Please provide responsive records in electronic format via email to foia@autopilotamerica.com. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).

Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).

Thank you for your prompt attention to this matter.

Sincerely,

Autopilot America
Authorized Agent for ${params.requesterName}
${params.requesterAddress}
Contact: ${params.requesterEmail}
Agent Contact: foia@autopilotamerica.com`;

  return { subject, body };
}

/**
 * Generate an HTML-formatted FOIA request (for Lob physical mail as backup).
 */
export function generateFoiaRequestHtml(params: {
  ticketNumber: string;
  violationDate: string;
  violationLocation: string;
  violationType: string;
  violationDescription: string;
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string;
  plate: string;
}): string {
  const records = getRecordsToRequest(params.violationType);
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const recordsList = records
    .map((r, i) => `<li style="margin-bottom: 6px;">${r}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      margin: 0.75in;
    }
  </style>
</head>
<body>
  <p>${today}</p>

  <p>
    Department of Finance<br>
    FOIA Officer<br>
    121 North LaSalle Street, 7th Floor<br>
    Chicago, Illinois 60602
  </p>

  <p>
    <strong>Re: Freedom of Information Act Request</strong><br>
    Parking Citation #${params.ticketNumber}<br>
    Violation Date: ${params.violationDate}<br>
    Location: ${params.violationLocation}<br>
    Vehicle Plate: ${params.plate}
  </p>

  <p>Dear FOIA Officer:</p>

  <p>Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am writing on behalf of <strong>${params.requesterName}</strong>, the registered owner of the vehicle cited above (plate: ${params.plate}). ${params.requesterName} has authorized Autopilot America to act as their agent for the purpose of submitting this FOIA request and receiving responsive records. A copy of this authorization is on file and available upon request.</p>

  <p>On behalf of ${params.requesterName}, I am requesting copies of the following records related to the above-referenced citation:</p>

  <ol style="font-size: 10pt;">
    ${recordsList}
  </ol>

  <p>These records are requested in connection with the administrative contest of this citation by the vehicle owner.</p>

  <p>Please provide responsive records in electronic format via email to <strong>foia@autopilotamerica.com</strong>. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).</p>

  <p>Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).</p>

  <p>Thank you for your prompt attention to this matter.</p>

  <p>
    Sincerely,<br><br><br>
    Autopilot America<br>
    Authorized Agent for ${params.requesterName}<br>
    ${params.requesterAddress}<br>
    Contact: ${params.requesterEmail}<br>
    Agent Contact: foia@autopilotamerica.com
  </p>
</body>
</html>`;
}

/**
 * FOIA request email destinations
 *
 * Finance (DOF): Ticket records, enforcement data, officer notes
 * CDOT: Signal timing, intersection engineering, camera hardware/calibration
 *
 * Red light camera tickets need BOTH — Finance for the citation records,
 * CDOT for the intersection engineering records that prove whether the
 * yellow light met the Illinois +1 second statutory minimum.
 */
export const CHICAGO_FINANCE_FOIA_EMAIL = 'DOFfoia@cityofchicago.org';
export const CHICAGO_CDOT_FOIA_EMAIL = 'cdotfoia@cityofchicago.org';

/**
 * Send a FOIA request via email using Resend.
 * Returns the Resend email ID on success.
 */
export async function sendFoiaRequestEmail(params: {
  ticketNumber: string;
  violationDate: string;
  violationLocation: string;
  violationType: string;
  violationDescription: string;
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string;
  plate: string;
  referenceId?: string;
}): Promise<{ success: boolean; emailId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const { subject, body } = generateFoiaRequestEmail(params);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Autopilot America - Agent for ${params.requesterName} <foia@autopilotamerica.com>`,
        to: [CHICAGO_FINANCE_FOIA_EMAIL],
        subject,
        text: body,
        reply_to: params.requesterEmail,
        headers: {
          'X-Entity-Ref-ID': params.referenceId || `foia-${params.ticketNumber}`, // Unique ID for response matching
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Resend API error: ${errorText}` };
    }

    const data = await response.json();
    return { success: true, emailId: data.id };
  } catch (err: any) {
    return { success: false, error: `Send exception: ${err.message}` };
  }
}

/**
 * CDOT Signal Timing FOIA — records to request.
 * These go to CDOT (not Finance) because signal timing is an engineering function.
 */
const CDOT_SIGNAL_TIMING_RECORDS = [
  'The complete signal timing plan for this intersection, including yellow change interval, all-red clearance interval, cycle length, and phase sequence, as programmed on the date of the violation',
  'Any signal timing changes or re-timing events at this intersection within the 12 months preceding the violation',
  'The intersection approach speed limit and the engineering basis for the current yellow light duration',
  'The intersection geometry including curb-to-curb width for each approach',
  'The most recent traffic signal permit or signal modification order for this intersection',
  'Compliance verification records showing this camera-enforced intersection meets the yellow light minimum required by 625 ILCS 5/11-306(c-5) (MUTCD minimum plus one second)',
];

/**
 * Generate a CDOT FOIA request email for signal timing and intersection engineering records.
 * This is a SEPARATE FOIA from the Finance FOIA — it goes to CDOT which maintains the signals.
 */
export function generateCdotFoiaRequestEmail(params: {
  ticketNumber: string;
  violationDate: string;
  violationLocation: string; // intersection name, e.g. "Western Ave & Belmont Ave"
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string;
  plate: string;
  referenceId?: string;
}): { subject: string; body: string } {
  const recordsList = CDOT_SIGNAL_TIMING_RECORDS
    .map((r, i) => `   ${i + 1}. ${r}`)
    .join('\n');

  const refSuffix = params.referenceId ? ` [Ref: ${params.referenceId}]` : '';
  const subject = `FOIA Request - Signal Timing Records - ${params.violationLocation} - Citation #${params.ticketNumber}${refSuffix}`;

  const body = `Chicago Department of Transportation
FOIA Officer
2 North LaSalle Street, Suite 1110
Chicago, Illinois 60602

Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Re: Freedom of Information Act Request
    Signal Timing & Intersection Engineering Records
    Intersection: ${params.violationLocation}
    Related Citation: #${params.ticketNumber}
    Violation Date: ${params.violationDate}

Dear FOIA Officer:

Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am writing on behalf of ${params.requesterName} in connection with the administrative contest of an automated red light camera citation issued at the above intersection. ${params.requesterName} has authorized Autopilot America to act as their agent for the purpose of submitting this FOIA request and receiving responsive records.

Illinois law (625 ILCS 5/11-306(c-5)) requires that intersections equipped with automated traffic law enforcement systems must have a yellow change interval duration that is not less than the established engineering standard, plus an additional one second. I am requesting the following records to verify compliance:

${recordsList}

These records are necessary to determine whether the yellow light duration at this camera-enforced intersection meets the statutory minimum required by Illinois law at the time this citation was issued.

Please provide responsive records in electronic format via email to foia@autopilotamerica.com. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).

Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).

Thank you for your prompt attention to this matter.

Sincerely,

Autopilot America
Authorized Agent for ${params.requesterName}
${params.requesterAddress}
Contact: ${params.requesterEmail}
Agent Contact: foia@autopilotamerica.com`;

  return { subject, body };
}

/**
 * Send a CDOT FOIA request for signal timing records via Resend.
 * Returns the Resend email ID on success.
 */
export async function sendCdotFoiaRequestEmail(params: {
  ticketNumber: string;
  violationDate: string;
  violationLocation: string;
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string;
  plate: string;
  referenceId?: string;
}): Promise<{ success: boolean; emailId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const { subject, body } = generateCdotFoiaRequestEmail(params);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Autopilot America - Agent for ${params.requesterName} <foia@autopilotamerica.com>`,
        to: [CHICAGO_CDOT_FOIA_EMAIL],
        subject,
        text: body,
        reply_to: params.requesterEmail,
        headers: {
          'X-Entity-Ref-ID': params.referenceId || `cdot-foia-${params.ticketNumber}`,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Resend API error (CDOT): ${errorText}` };
    }

    const data = await response.json();
    return { success: true, emailId: data.id };
  } catch (err: any) {
    return { success: false, error: `Send exception (CDOT): ${err.message}` };
  }
}

/**
 * Build the FOIA section for a contest letter when the city failed to respond.
 */
export function buildFoiaNonResponseArgument(params: {
  foiaSentDate: string; // ISO date string
  ticketNumber: string;
  daysElapsed: number;
}): string {
  const sentFormatted = new Date(params.foiaSentDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `On ${sentFormatted}, I submitted a Freedom of Information Act request (5 ILCS 140) to the Department of Finance for the enforcement records pertaining to Citation #${params.ticketNumber}, including the issuing officer's field notes, photographs, and device data. As of this date, ${params.daysElapsed} days have elapsed and the Department has not produced the requested records, exceeding the statutory five-business-day response period.

The absence of these enforcement records raises significant questions about the completeness and accuracy of the citation. Without the officer's contemporaneous notes and photographic evidence, the City cannot establish a prima facie case that the cited violation actually occurred as described on the citation. I respectfully submit that the City's failure to produce these records supports a finding of Not Liable.`;
}

/**
 * Build the FOIA section for a contest letter when records were produced but incomplete.
 */
export function buildFoiaIncompleteResponseArgument(params: {
  foiaSentDate: string;
  ticketNumber: string;
  missingRecords: string[];
}): string {
  const sentFormatted = new Date(params.foiaSentDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const missingList = params.missingRecords.map(r => `- ${r}`).join('\n');

  return `On ${sentFormatted}, I submitted a Freedom of Information Act request for the enforcement records pertaining to Citation #${params.ticketNumber}. The Department's response was incomplete — the following records were not produced:

${missingList}

The absence of these records is significant because complete enforcement documentation is necessary for the City to establish a prima facie case. I respectfully request that the hearing officer consider this incomplete record when evaluating this contest.`;
}

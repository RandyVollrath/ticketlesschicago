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

// Records we request based on violation type
const BASE_RECORDS = [
  'The issuing officer\'s field notes, observations, and contemporaneous written records for this citation',
  'Any photographs taken by the issuing officer at the time of the citation',
  'The handheld citation device data and timestamps for this ticket, including GPS coordinates',
  'Training and certification records for the issuing officer relevant to this violation type',
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
    'Speed camera calibration records, accuracy testing results, and maintenance logs for the camera at this location',
    'The complete violation video/image package including all frames captured',
    'Speed limit signage survey and posting records for this location',
  ],
  red_light: [
    'Red light camera calibration records and accuracy testing for the camera at this intersection',
    'Yellow light timing records and signal timing plan for this intersection',
    'The complete violation video/image package including all frames captured',
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
}): { subject: string; body: string } {
  const records = getRecordsToRequest(params.violationType);

  const recordsList = records
    .map((r, i) => `   ${i + 1}. ${r}`)
    .join('\n');

  const subject = `FOIA Request - Parking Citation #${params.ticketNumber} - Enforcement Records`;

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

Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am requesting copies of the following records related to the above-referenced parking citation:

${recordsList}

I am the registered owner of the cited vehicle and am requesting these records in connection with my administrative contest of this citation.

Please provide these records in electronic format via email to ${params.requesterEmail}. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).

Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).

I am willing to pay reasonable copying fees up to $25.00. If fees will exceed this amount, please notify me before processing.

Thank you for your prompt attention to this matter.

Sincerely,

${params.requesterName}
${params.requesterAddress}
${params.requesterEmail}`;

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

  <p>Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am requesting copies of the following records related to the above-referenced parking citation:</p>

  <ol style="font-size: 10pt;">
    ${recordsList}
  </ol>

  <p>I am the registered owner of the cited vehicle and am requesting these records in connection with my administrative contest of this citation.</p>

  <p>Please provide these records in electronic format via email to <strong>${params.requesterEmail}</strong>. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).</p>

  <p>Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).</p>

  <p>I am willing to pay reasonable copying fees up to $25.00. If fees will exceed this amount, please notify me before processing.</p>

  <p>Thank you for your prompt attention to this matter.</p>

  <p>
    Sincerely,<br><br><br>
    ${params.requesterName}<br>
    ${params.requesterAddress}<br>
    ${params.requesterEmail}
  </p>
</body>
</html>`;
}

/**
 * FOIA request email destination
 */
export const CHICAGO_FINANCE_FOIA_EMAIL = 'DOFfoia@cityofchicago.org';

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
        from: `${params.requesterName} via Autopilot <foia@autopilotamerica.com>`,
        to: [CHICAGO_FINANCE_FOIA_EMAIL],
        subject,
        text: body,
        reply_to: params.requesterEmail,
        headers: {
          'X-Entity-Ref-ID': `foia-${params.ticketNumber}`, // Prevent threading/dedup
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

/**
 * AHMS (Administrative Hearings Management System) fetcher.
 *
 * Purpose: after a contest letter is mailed, the City of Chicago assigns
 * a docket number and schedules a hearing. The docket number appears on
 * the City's mailed acknowledgement / summons. Once we know it, the
 * AHMS flow at https://webapps1.chicago.gov/payments-web (cityServiceId
 * for ahms) exposes:
 *   - The full violation address (not available on the parking portal)
 *   - Hearing date
 *   - Structured evidence photos the City plans to use at the hearing
 *
 * This module:
 *   1. Given a docket number + address + zip, POSTs /api/mets/documents
 *      to retrieve the structured violation record + evidence photos.
 *   2. Returns a parsed finding with { docket, violationAddress, hearing
 *      Date, imageUrls, disposition(?) }.
 *   3. Is designed to be called from a follow-up cron that runs after
 *      contest letters have been mailed ~21–45 days earlier.
 *
 * Caveat: all three query params (docket, address, zip) are required by
 * the city's backend. We need to capture the docket number from the
 * city's response (mailed acknowledgement, email, FOIA reply) before
 * this module can fire. The caller is responsible for extracting and
 * storing the docket; this module is pure lookup.
 */

export interface AhmsDocketDetails {
  docketNumber: string;
  violationAddress: string | null; // single-line "1234 N State St, Chicago, IL 60614"
  violationDate: string | null;
  hearingDate: string | null;
  imageUrls: string[]; // city-supplied evidence photos
  raw: any; // full API response for debugging
}

const AHMS_DOCUMENTS_ENDPOINT =
  'https://webapps1.chicago.gov/payments-web/api/mets/documents';

/**
 * Call AHMS and return docket details. Returns null on any failure — the
 * caller treats null as "still waiting for docket-number data" and
 * retries later.
 */
export async function fetchAhmsDocketDetails(params: {
  docketNumber: string;
  violationAddress: string; // user-supplied or OCR'd from mailed notice
  zipCode: string;
}): Promise<AhmsDocketDetails | null> {
  const { docketNumber, violationAddress, zipCode } = params;
  if (!docketNumber || !violationAddress || !zipCode) return null;

  const body = {
    docketNumber,
    violationAddress,
    violationZipCode: zipCode,
  };

  try {
    const resp = await fetch(AHMS_DOCUMENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Autopilot America / docket-tracker',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const addr = data?.documentsResponse?.data?.violationAddress;
    const formattedAddress = addr
      ? [addr.fromNumber, addr.direction, addr.streetName, addr.streetType].filter(Boolean).join(' ') +
        (addr.city ? `, ${addr.city}` : '') +
        (addr.state ? `, ${addr.state}` : '') +
        (addr.zipcode ? ` ${addr.zipcode}` : '')
      : null;

    return {
      docketNumber,
      violationAddress: formattedAddress,
      violationDate: data?.documentsResponse?.data?.violationDate || null,
      hearingDate: data?.documentsResponse?.data?.hearingDate || null,
      imageUrls: Array.isArray(data?.imageUrls) ? data.imageUrls : [],
      raw: data,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a docket number from a city acknowledgement letter / email.
 * Chicago dockets are 7-digit numbers, sometimes prefixed "Docket #" or
 * "Dkt. No.".
 */
export function extractDocketNumberFromText(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /docket\s*(?:number|no\.?|#)?\s*:?\s*([0-9-]{6,12})/i,
    /\bdkt\.?\s*(?:no\.?|#)?\s*:?\s*([0-9-]{6,12})/i,
    /case\s*(?:number|no\.?|#)?\s*:?\s*([0-9-]{6,12})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/-/g, '');
  }
  return null;
}

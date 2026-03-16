/**
 * FOIA Response Parser
 *
 * Uses Google Gemini Flash to parse FOIA response emails from the City of Chicago.
 * Two main use cases:
 *
 * 1. Evidence FOIA responses: Classify as denial/fulfillment, detect attachment types
 * 2. History FOIA responses: Extract structured ticket data from response body/attachments
 *
 * Uses Gemini 2.0 Flash — fast, cheap ($0.10/1M input tokens), good at structured extraction.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Types ───────────────────────────────────────────────────

export interface ParsedHistoryTicket {
  ticket_number: string;
  violation_date: string | null;
  violation_type: string | null;
  amount: number | null;
  status: string | null;    // paid, unpaid, dismissed, etc.
  location: string | null;
}

export interface HistoryParseResult {
  tickets: ParsedHistoryTicket[];
  total_fines: number;
  summary: string;
  raw_response: string;
  model: string;
}

export interface EvidenceClassification {
  type: 'denial' | 'fulfillment_with_records' | 'partial_response' | 'acknowledgment' | 'unclear';
  has_officer_notes: boolean;
  has_photos: boolean;
  has_device_data: boolean;
  missing_records: string[];
  summary: string;
  raw_response: string;
  model: string;
}

// ─── Gemini Client ───────────────────────────────────────────

function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
}

const MODEL_NAME = 'gemini-2.0-flash';

// ─── History FOIA Response Parsing ───────────────────────────

/**
 * Parse a history FOIA response email to extract structured ticket data.
 * The city typically responds with a list/table of all tickets for a plate.
 */
export async function parseHistoryFoiaResponse(params: {
  subject: string;
  body: string;
  licensePlate: string;
  licenseState: string;
}): Promise<HistoryParseResult | null> {
  const genAI = getGeminiClient();
  if (!genAI) return null;

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are parsing a FOIA (Freedom of Information Act) response from the City of Chicago Department of Finance. The response contains ticket/citation history for license plate ${params.licenseState} ${params.licensePlate}.

Extract ALL tickets/citations mentioned in the email. For each ticket, extract:
- ticket_number: The citation/ticket number (usually 10+ digits)
- violation_date: Date of the violation (format: YYYY-MM-DD if possible)
- violation_type: Type of violation (e.g., "street cleaning", "expired meter", etc.)
- amount: Fine amount in dollars (number only, no $ sign)
- status: Current status (paid, unpaid, dismissed, defaulted, etc.)
- location: Street address where violation occurred

IMPORTANT:
- Extract EVERY ticket mentioned, even if some fields are missing
- If a field is not available, use null
- Amounts should be numbers (e.g., 50, not "$50.00")
- Parse dates into YYYY-MM-DD format when possible
- If the response says "no records found" or similar, return an empty tickets array

Respond with ONLY valid JSON in this exact format:
{
  "tickets": [
    {
      "ticket_number": "string",
      "violation_date": "YYYY-MM-DD or null",
      "violation_type": "string or null",
      "amount": number_or_null,
      "status": "string or null",
      "location": "string or null"
    }
  ],
  "summary": "Brief 1-2 sentence summary of what the city provided"
}

Email subject: ${params.subject}

Email body:
${params.body.substring(0, 15000)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Extract JSON from the response (Gemini may wrap it in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Gemini response did not contain valid JSON');
      return {
        tickets: [],
        total_fines: 0,
        summary: 'Failed to parse response',
        raw_response: text,
        model: MODEL_NAME,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const tickets: ParsedHistoryTicket[] = (parsed.tickets || []).map((t: any) => ({
      ticket_number: String(t.ticket_number || ''),
      violation_date: t.violation_date || null,
      violation_type: t.violation_type || null,
      amount: typeof t.amount === 'number' ? t.amount : null,
      status: t.status || null,
      location: t.location || null,
    }));

    const total_fines = tickets.reduce((sum, t) => sum + (t.amount || 0), 0);

    return {
      tickets,
      total_fines,
      summary: parsed.summary || `Found ${tickets.length} ticket(s)`,
      raw_response: text,
      model: MODEL_NAME,
    };
  } catch (err: any) {
    console.error(`Gemini parsing failed: ${err.message}`);
    return {
      tickets: [],
      total_fines: 0,
      summary: `Parse error: ${err.message}`,
      raw_response: '',
      model: MODEL_NAME,
    };
  }
}

// ─── Evidence FOIA Response Classification ───────────────────

/**
 * Classify an evidence FOIA response — what did the city provide?
 * This determines which argument we use in the contest letter:
 * - denial → "Prima Facie Case Not Established"
 * - partial → "Incomplete Records" argument
 * - fulfillment → Analyze what they provided for weaknesses
 */
export async function classifyEvidenceFoiaResponse(params: {
  subject: string;
  body: string;
  attachmentFilenames: string[];
  ticketNumber: string;
}): Promise<EvidenceClassification | null> {
  const genAI = getGeminiClient();
  if (!genAI) return null;

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are analyzing a FOIA response from the City of Chicago Department of Finance regarding parking citation #${params.ticketNumber}. We requested enforcement records: officer's field notes, photographs, handheld device data, and violation-specific records.

Classify this response and identify what was provided vs missing.

Email subject: ${params.subject}
Attachments: ${params.attachmentFilenames.join(', ') || 'None'}

Email body:
${params.body.substring(0, 10000)}

Respond with ONLY valid JSON:
{
  "type": "denial|fulfillment_with_records|partial_response|acknowledgment|unclear",
  "has_officer_notes": boolean,
  "has_photos": boolean,
  "has_device_data": boolean,
  "missing_records": ["list of requested records NOT provided"],
  "summary": "Brief description of what city provided or denied"
}

Classification guide:
- "denial": City says no records exist, can't find records, or refuses the request
- "fulfillment_with_records": City provides attachments/records
- "partial_response": City provides some records but explicitly states others are unavailable
- "acknowledgment": City acknowledges receipt but hasn't provided records yet (extension notice)
- "unclear": Can't determine from the email content`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        type: 'unclear',
        has_officer_notes: false,
        has_photos: false,
        has_device_data: false,
        missing_records: [],
        summary: 'Failed to parse AI classification',
        raw_response: text,
        model: MODEL_NAME,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      type: parsed.type || 'unclear',
      has_officer_notes: Boolean(parsed.has_officer_notes),
      has_photos: Boolean(parsed.has_photos),
      has_device_data: Boolean(parsed.has_device_data),
      missing_records: Array.isArray(parsed.missing_records) ? parsed.missing_records : [],
      summary: parsed.summary || 'Classification complete',
      raw_response: text,
      model: MODEL_NAME,
    };
  } catch (err: any) {
    console.error(`Gemini classification failed: ${err.message}`);
    return {
      type: 'unclear',
      has_officer_notes: false,
      has_photos: false,
      has_device_data: false,
      missing_records: [],
      summary: `Classification error: ${err.message}`,
      raw_response: '',
      model: MODEL_NAME,
    };
  }
}

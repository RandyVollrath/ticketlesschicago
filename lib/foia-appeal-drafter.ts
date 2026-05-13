/**
 * FOIA Appeal Drafter
 *
 * When the City denies a parking-ticket history FOIA (status = fulfilled_denial),
 * generate a draft Request for Review under 5 ILCS 140/9.5 addressed to the
 * Public Access Counselor (PAC) at the IL Attorney General. The draft is
 * persisted to `foia_history_appeals` and surfaced in the daily admin digest
 * with a signed magic-link "Send" button. Admin clicks the link → endpoint
 * verifies the HMAC, sends the email to public.access@atg.state.il.us, and
 * flips the appeal to status='sent'.
 *
 * We are NOT autonomous — every appeal requires explicit admin click. The
 * drafter just prepares the letter so the click is the only human step.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const MODEL_NAME = 'gemini-2.0-flash';
export const PAC_EMAIL = 'public.access@atg.state.il.us';

// Two-letter state code → full name. Used so the prompt can say "Virginia
// license plate" instead of the AI guessing "Illinois license plate VA …".
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
function stateAbbrToName(abbr: string): string {
  return STATE_NAMES[(abbr || '').toUpperCase()] || abbr;
}

function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

interface DrafterInput {
  historyRequest: {
    id: string;
    license_state: string;
    license_plate: string;
    name: string;
    email: string;
    reference_id: string | null;
    created_at: string;
  };
  denialBody: string;
  denialFrom: string;
  denialReceivedAt: string;
}

interface DrafterResult {
  appealId: string;
  draftSubject: string;
  draftBody: string;
}

/**
 * Draft a PAC Request for Review and persist it. Returns the new appeal id.
 * If a draft already exists for this history request in `draft` status, this
 * regenerates it (incrementing regenerated_count) rather than creating a second
 * row — admins typically only need one live draft per denial.
 */
export async function draftHistoryFoiaAppeal(
  supabase: SupabaseClient,
  input: DrafterInput,
): Promise<DrafterResult | null> {
  const genAI = getGeminiClient();
  if (!genAI) {
    console.error('[appeal-drafter] GEMINI_API_KEY missing — skipping draft');
    return null;
  }

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago',
  });

  const stateName = stateAbbrToName(input.historyRequest.license_state);

  const prompt = `You are drafting a Request for Review under 5 ILCS 140/9.5 to the Illinois Attorney General's Public Access Counselor. The City of Chicago Department of Finance has denied a FOIA request seeking parking-ticket and traffic-citation history for a license plate. The requester is the registered owner of that plate.

CRITICAL FACTS — do not alter or paraphrase:
- Requester's full name: ${input.historyRequest.name}
- Requester's email address (use this EXACT string in the closing — do not invent a placeholder): ${input.historyRequest.email}
- Vehicle license plate number: ${input.historyRequest.license_plate}
- Vehicle license plate is registered in: ${stateName} (state abbreviation: ${input.historyRequest.license_state})
- Records-holding agency: City of Chicago Department of Finance
- Original FOIA reference id: ${input.historyRequest.reference_id ?? '[reference id unavailable]'}
- Original FOIA submission date: ${new Date(input.historyRequest.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
- Denial received: ${new Date(input.denialReceivedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
- Today's date (for the letter header): ${today}

Draft a professional, lawyerly letter addressed to:
  Public Access Counselor
  Office of the Attorney General
  500 South Second Street
  Springfield, IL 62701
  public.access@atg.state.il.us

The letter MUST:
- Open with: "Re: Request for Review — Denial by City of Chicago Department of Finance — FOIA Reference ${input.historyRequest.reference_id ?? '[reference id unavailable]'}"
- State that the requester is the registered owner of a vehicle bearing ${stateName} license plate ${input.historyRequest.license_plate}. NEVER call it an "Illinois plate" — the plate is registered in ${stateName}. The FOIA is to the City of Chicago because the citations were issued in Chicago.
- State that an authorization signed by the requester was filed with the original FOIA, and that Scarlet Carson, Inc. d/b/a Autopilot America acts as the requester's authorized agent.
- Summarize the original FOIA request, seeking ticket/citation history for the plate.
- Describe DOF's denial, quoting briefly from the denial language.
- Argue that the denial is improper, citing specifically:
  * 5 ILCS 140/7(1)(b) does NOT shield records the requester is the subject of.
  * Parking citation records are routinely produced as public records keyed to plate; DOF's own historical practice undermines the categorical denial.
  * The PAC has previously rejected blanket 7(1)(b) claims for plate-keyed records (do NOT cite specific PAC binding opinion numbers — keep the legal argument principle-based rather than citing inventories you cannot verify).
  * Even if some fields (e.g. owner home address) were exempt under 7(1)(b), 5 ILCS 140/7(1) requires redaction-and-release, not categorical withholding.
- Request that the PAC direct DOF to produce the responsive records, redacted only as strictly required.
- Close with the requester's contact info: name "${input.historyRequest.name}" and email "${input.historyRequest.email}" — use the email VERBATIM, do not invent a placeholder. Then the agent contact: foia@autopilotamerica.com.

Output ONLY a JSON object with two fields: { "subject": string, "body": string }. The body must be plain text, formatted with line breaks, ready to paste into an email. No markdown. No code fences. No commentary.

DENIAL EMAIL FROM CITY (verbatim, may be partial):
"""
From: ${input.denialFrom}
Received: ${input.denialReceivedAt}

${input.denialBody.substring(0, 4000)}
"""

Today's date in the letter: ${today}.`;

  let parsed: { subject: string; body: string } | null = null;
  try {
    const resp = await model.generateContent(prompt);
    const text = resp.response.text().trim();
    // Strip any accidental code fences before parsing.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    console.error('[appeal-drafter] Gemini draft failed:', e?.message ?? e);
    return null;
  }

  if (!parsed?.subject || !parsed?.body) {
    console.error('[appeal-drafter] Gemini returned malformed JSON');
    return null;
  }

  // Upsert: one live draft per history request. If a previous draft exists,
  // bump regenerated_count and overwrite the body. Cast supabase to any —
  // generated types haven't picked up the new table yet.
  const sb = supabase as any;

  const { data: existing } = await sb
    .from('foia_history_appeals')
    .select('id, regenerated_count')
    .eq('history_request_id', input.historyRequest.id)
    .eq('status', 'draft')
    .maybeSingle();

  if (existing) {
    await sb
      .from('foia_history_appeals')
      .update({
        draft_subject: parsed.subject,
        draft_body: parsed.body,
        ai_model: MODEL_NAME,
        raw_denial_excerpt: input.denialBody.substring(0, 2000),
        regenerated_count: ((existing as any).regenerated_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existing as any).id);
    return { appealId: (existing as any).id, draftSubject: parsed.subject, draftBody: parsed.body };
  }

  const { data: inserted, error } = await sb
    .from('foia_history_appeals')
    .insert({
      history_request_id: input.historyRequest.id,
      status: 'draft',
      draft_subject: parsed.subject,
      draft_body: parsed.body,
      ai_model: MODEL_NAME,
      raw_denial_excerpt: input.denialBody.substring(0, 2000),
    })
    .select('id')
    .single();

  if (error || !inserted) {
    console.error('[appeal-drafter] insert failed:', error);
    return null;
  }

  return { appealId: (inserted as any).id, draftSubject: parsed.subject, draftBody: parsed.body };
}

// ─── Magic-link signing ──────────────────────────────────────────
// The daily admin digest contains a per-draft "Send" button that hits
// /api/foia-appeals/send?id=...&exp=...&sig=...
// We HMAC the (id, exp) tuple with FOIA_APPEAL_LINK_SECRET so possession of
// the link is sufficient authorization. Anyone with access to the admin
// inbox can fire the appeal — that is the intended trust boundary.

function getLinkSecret(): string {
  // Fall back to CRON_SECRET so we don't require a brand-new env var to ship.
  // If neither is set we throw, because an unsigned magic link would be a
  // serious security regression.
  const s = process.env.FOIA_APPEAL_LINK_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error('FOIA_APPEAL_LINK_SECRET (or CRON_SECRET) must be set');
  return s;
}

export function signAppealLink(appealId: string, action: 'send' | 'regenerate' | 'view', ttlSeconds = 14 * 24 * 60 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${appealId}.${action}.${exp}`;
  const sig = crypto.createHmac('sha256', getLinkSecret()).update(payload).digest('hex');
  return `id=${encodeURIComponent(appealId)}&action=${action}&exp=${exp}&sig=${sig}`;
}

export function verifyAppealLink(
  appealId: string,
  action: 'send' | 'regenerate' | 'view',
  exp: string,
  sig: string,
): { ok: true } | { ok: false; reason: string } {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return { ok: false, reason: 'bad-exp' };
  if (expNum < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  const payload = `${appealId}.${action}.${expNum}`;
  const expected = crypto.createHmac('sha256', getLinkSecret()).update(payload).digest('hex');
  // Constant-time compare to prevent timing attacks.
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'bad-sig' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-sig' };
  return { ok: true };
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS, RedLightEvidenceExhibit } from '../../../lib/lob-service';
import { computeEvidenceHash } from '../../../lib/red-light-evidence-report';
import { analyzeRedLightDefense, type AnalysisInput } from '../../../lib/red-light-defense-analysis';
import { getAdminAlertEmails } from '../../../lib/admin-alert-emails';
import * as Sentry from '@sentry/nextjs';

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000 }) : null;
const gemini = (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY)
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY!)
  : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface LetterToMail {
  id: string;
  ticket_id: string;
  user_id: string;
  updated_at: string;
  letter_content: string;
  letter_text: string;
  defense_type: string | null;
  status: string;
  approved_via?: string | null;
  street_view_exhibit_urls: string[] | null;
  street_view_date: string | null;
  street_view_address: string | null;
}

interface EvidenceData {
  attachment_urls?: string[];
  [key: string]: any;
}

interface UserProfile {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
}

interface Subscription {
  status: string;
  letters_included_remaining?: number | null;
  letters_used_this_period?: number | null;
  letters_included?: number | null;
}

interface AIReviewResult {
  pass: boolean;
  correctedLetter?: string;
  issues: string[];
  qualityScore: number;
  provider: 'anthropic' | 'gemini' | 'openai' | 'heuristic';
}

function isAdminApprovedLetter(letter: { status: string; approved_via?: string | null }): boolean {
  if (letter.status !== 'approved') return false;
  return letter.approved_via === 'admin_review' ||
    letter.approved_via === 'auto_deadline_safety_net' ||
    letter.approved_via === 'smoke_test';
}

/**
 * Check if kill switches are active
 */
async function checkKillSwitches(): Promise<{ proceed: boolean; message?: string }> {
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['pause_all_mail', 'pause_ticket_processing']);

  if (settingsError) {
    console.error('Failed to check kill switches:', settingsError.message);
    return { proceed: false, message: 'Kill switch check failed — halting to be safe' };
  }

  for (const setting of settings || []) {
    if (setting.key === 'pause_all_mail' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: mailing disabled' };
    }
    if (setting.key === 'pause_ticket_processing' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: ticket processing paused' };
    }
  }

  return { proceed: true };
}

/**
 * Check if test mode is enabled.
 * Priority: DB setting (admin toggle) > env var.
 * If admin explicitly set lob_test_mode in the DB, that takes priority.
 * Otherwise falls back to LOB_TEST_MODE env var.
 */
async function isTestModeEnabled(): Promise<boolean> {
  // Check database setting first (admin dashboard toggle takes priority)
  const { data } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('value')
    .eq('key', 'lob_test_mode')
    .maybeSingle();
  // If DB row exists, it's the authoritative source (admin explicitly set it)
  if (data) return !!data.value?.enabled;
  // No DB row — fall back to env var
  return process.env.LOB_TEST_MODE === 'true';
}

/**
 * Validate letter has no unfilled placeholders or quality issues.
 * Returns { pass: true } or { pass: false, issues: string[] }
 *
 * This is the first-pass "cheap" validation (no AI call). It catches
 * obvious structural problems before the more expensive AI review runs.
 */
function validateLetterContent(
  letterContent: string,
  ticketData: { ticket_number: string; violation_date: string; violation_type?: string; violation_description?: string; user_evidence_text?: string | null }
): { pass: boolean; issues: string[] } {
  const issues: string[] = [];

  // ── 1. Unfilled placeholders ──
  const placeholderRegex = /\[([A-Z][A-Z0-9_]{2,})\]/g;
  const placeholders = letterContent.match(placeholderRegex);
  if (placeholders && placeholders.length > 0) {
    const unique = [...new Set(placeholders)];
    issues.push(`Unfilled placeholders found: ${unique.join(', ')}`);
  }

  // Also catch {{PLACEHOLDER}} and <PLACEHOLDER> patterns
  const mustachePlaceholders = letterContent.match(/\{\{[A-Z][A-Z0-9_]+\}\}/g);
  if (mustachePlaceholders && mustachePlaceholders.length > 0) {
    issues.push(`Unfilled mustache placeholders: ${[...new Set(mustachePlaceholders)].join(', ')}`);
  }
  const anglePlaceholders = letterContent.match(/<([A-Z][A-Z0-9_]{2,})>/g);
  if (anglePlaceholders && anglePlaceholders.length > 0) {
    // Filter out actual HTML tags — these are ALL-CAPS which isn't valid HTML
    issues.push(`Unfilled angle-bracket placeholders: ${[...new Set(anglePlaceholders)].join(', ')}`);
  }

  // ── 2. Malformed sentences (expanded duplicate word patterns) ──
  if (letterContent.includes('which was there is')) issues.push('Malformed sentence: "which was there is"');
  if (letterContent.includes('was was')) issues.push('Malformed sentence: duplicate "was was"');
  if (letterContent.includes('the the')) issues.push('Malformed sentence: duplicate "the the"');
  if (/\bI I\b/.test(letterContent)) issues.push('Malformed sentence: duplicate "I I"');
  if (letterContent.includes('is is')) issues.push('Malformed sentence: duplicate "is is"');
  if (letterContent.includes('that that')) issues.push('Malformed sentence: duplicate "that that"');
  if (/\bin in\b/i.test(letterContent)) issues.push('Malformed sentence: duplicate "in in"');
  if (/\bto to\b/i.test(letterContent)) issues.push('Malformed sentence: duplicate "to to"');
  if (/\bfor for\b/i.test(letterContent)) issues.push('Malformed sentence: duplicate "for for"');

  // ── 3. Letter length checks ──
  if (letterContent.length < 300) issues.push('Letter is suspiciously short (< 300 chars)');
  if (letterContent.length > 15000) issues.push('Letter is suspiciously long (> 15000 chars) — may contain debug data');

  // ── 4. Ticket number presence ──
  if (ticketData.ticket_number && !letterContent.includes(ticketData.ticket_number)) {
    issues.push(`Letter does not contain ticket number "${ticketData.ticket_number}"`);
  }

  // ── 5. Required structural elements ──
  // RE: line (standard contest letter format)
  if (!/\bRE:/i.test(letterContent) && !/\bRe:/i.test(letterContent)) {
    issues.push('Missing RE: line (required for contest letters)');
  }

  // Must have a closing (Sincerely, Respectfully, etc.)
  if (!/\b(sincerely|respectfully|regards|thank you)/i.test(letterContent)) {
    issues.push('Missing formal closing (Sincerely, Respectfully, etc.)');
  }

  // Must reference the city or department
  if (!/\b(department of finance|city of chicago|hearing officer)/i.test(letterContent)) {
    issues.push('Letter does not reference the Department of Finance or City of Chicago');
  }

  // ── 6. Date consistency ──
  if (ticketData.violation_date) {
    const vDate = new Date(ticketData.violation_date);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const correctDateStr = `${monthNames[vDate.getUTCMonth()]} ${vDate.getUTCDate()}, ${vDate.getUTCFullYear()}`;
    const dateInLetter = letterContent.match(/Violation Date:\s*(\w+ \d{1,2}, \d{4})/);
    if (dateInLetter && dateInLetter[1] !== correctDateStr) {
      issues.push(`Date mismatch: letter says "${dateInLetter[1]}" but ticket date is "${correctDateStr}"`);
    }
  }

  // ── 7. Defense-violation coherence (basic check) ──
  const descLower = (ticketData.violation_description || '').toLowerCase();
  const contentLower = letterContent.toLowerCase();

  // If violation is "prohibited anytime" / "tow zone", arguments about "outside restricted hours" or "expired meter" are incoherent
  if ((descLower.includes('prohibited') || descLower.includes('tow zone') || descLower.includes('no parking anytime')) &&
      (contentLower.includes('outside restricted hours') || contentLower.includes('outside the posted hours') || contentLower.includes('meter had not expired'))) {
    issues.push('Defense mismatch: "outside restricted hours" argument used for an anytime-prohibited violation');
  }

  // If violation is about expired meter, arguments about "no signs posted" are incoherent
  if (descLower.includes('expired') && descLower.includes('meter') &&
      contentLower.includes('no signs posted')) {
    issues.push('Defense mismatch: "no signs posted" argument used for an expired meter violation');
  }

  // ── 8. Suspicious content ──
  // AI sometimes outputs system-prompt-like text
  if (contentLower.includes('as an ai') || contentLower.includes('language model') || contentLower.includes('i cannot')) {
    issues.push('Letter contains AI self-reference ("as an AI", "language model", etc.)');
  }

  // ── 9. User-evidence-text integration check ──
  // When the user replied with factual claims, the letter MUST incorporate
  // them. Strip email chrome (signatures, quoted replies, URLs) and extract
  // content nouns (5+ letters) — if NONE of the user's top content nouns
  // appear in the letter, the AI silently dropped the user's claim. Flag.
  if (ticketData.user_evidence_text && ticketData.user_evidence_text.trim()) {
    const cleaned = ticketData.user_evidence_text
      .replace(/^>.*$/gm, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/On\s+\w+,\s+\w+\s+\d+,\s+\d{4}\s+at\s+\d+:\d+[^\n]*wrote:[\s\S]*$/, '')
      .toLowerCase();

    // Stopwords + email-metadata words we don't want to count as "content".
    const STOP = new Set([
      'actually','attachment','email','reply','thanks','please','sincerely','regards',
      'hello','there','that','this','have','would','could','should','where','which',
      'about','after','before','cannot','check','linkedin','twitter','facebook',
      'yahoo','gmail','hotmail','phone','cell','https','http',
    ]);
    const words = (cleaned.match(/\b[a-z]{5,}\b/g) || []).filter(w => !STOP.has(w));
    // Dedupe and take up to 6 content nouns.
    const unique = Array.from(new Set(words)).slice(0, 6);
    if (unique.length >= 2) {
      const hits = unique.filter(w => contentLower.includes(w));
      // Require at least one meaningful user-content-word to appear in the
      // letter. If zero match, the letter demonstrably doesn't address the
      // user's claim.
      if (hits.length === 0) {
        issues.push(`Letter does not reference any content from the user's written statement (checked: ${unique.join(', ')})`);
      }
    }
  }

  return { pass: issues.length === 0, issues };
}

function buildAIReviewPrompt(
  letterContent: string,
  ticketData: { ticket_number: string; violation_date: string; violation_description: string; violation_type: string; amount: number; location: string },
  userName: string
): string {
  return `You are a legal quality assurance reviewer for parking ticket contest letters sent to the City of Chicago Department of Finance. These letters are printed and mailed to a government agency on behalf of real people — quality matters.

Review the following letter and return a JSON response (no markdown, just raw JSON):

LETTER TO REVIEW:
---
${letterContent}
---

TICKET FACTS (ground truth — the letter MUST be consistent with these):
- Ticket Number: ${ticketData.ticket_number}
- Violation Date: ${ticketData.violation_date}
- Violation: ${ticketData.violation_description} (${ticketData.violation_type})
- Amount: $${ticketData.amount}
- Location: ${ticketData.location || 'Unknown'}
- Respondent: ${userName}

SCORING CRITERIA (check each — deduct points for failures):

1. PLACEHOLDERS (-30 pts each): Any unfilled text like [PLACEHOLDER], [POSTED_HOURS], {{VARIABLE}}, <FIELD_NAME>. These indicate the letter was not properly generated. This is the #1 most critical issue — a letter with placeholders MUST NOT be mailed.

2. TICKET NUMBER (-25 pts): The letter MUST contain the exact ticket number "${ticketData.ticket_number}". Missing ticket number means the city cannot process the contest.

3. DATE ACCURACY (-20 pts): The violation date in the letter must match "${ticketData.violation_date}". A wrong date makes the entire contest invalid.

4. DEFENSE COHERENCE (-25 pts): The defense strategy MUST match the violation type:
   - "PROHIBITED ANYTIME" / "TOW ZONE" → cannot argue "outside restricted hours"
   - "EXPIRED METER/PLATES" → cannot argue "no signs posted" or "outside hours"
   - "STREET CLEANING" → should reference signage, schedule accuracy, or compliance
   - "RED LIGHT" / "SPEED CAMERA" → should reference proper calibration, notice requirements, right-on-red, or yellow light timing
   An incoherent defense makes the letter useless and wastes the user's money.

5. STRUCTURAL REQUIREMENTS (-10 pts each missing):
   - Today's date at the top
   - Addressee (City of Chicago Department of Finance or similar)
   - RE: line with ticket number and violation date
   - Formal salutation ("To Whom It May Concern" or "Dear Hearing Officer")
   - Substantive defense arguments (not just "I disagree")
   - Formal closing ("Sincerely," "Respectfully,")
   - Respondent's printed name

6. GRAMMAR & COHERENCE (-5 pts each): Broken sentences, duplicate words, incomplete thoughts, run-on sentences, subject-verb disagreement.

7. PROFESSIONALISM (-15 pts): Must be formal legal tone. No slang, no emotional pleas, no threats. Must not contain AI self-references ("as an AI", "I'm a language model").

8. FACTUAL CONSISTENCY (-10 pts): Ticket number, location, amounts, and dates must be consistent throughout the letter — no contradictions.

9. LEGAL CITATIONS (bonus +5 pts): Correctly citing Chicago Municipal Code sections, Illinois Vehicle Code, or relevant ordinances adds credibility.

RESPOND WITH THIS JSON FORMAT ONLY:
{
  "qualityScore": <0-100>,
  "issues": ["issue 1", "issue 2"],
  "canAutoFix": true/false,
  "correctedLetter": "<if canAutoFix is true, provide the COMPLETE corrected letter text here. Remove ALL placeholders — if data is missing, write around it naturally without brackets. Fix ALL date errors, malformed sentences, and defense mismatches. Keep the same general structure and evidence. Do NOT add made-up facts. Ensure the ticket number ${ticketData.ticket_number} appears in the RE: line.>"
}`;
}

function parseAIReviewResponse(responseText: string, provider: AIReviewResult['provider']): AIReviewResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`${provider} response did not contain JSON`);
  }

  const review = JSON.parse(jsonMatch[0]);
  const qualityScore = typeof review.qualityScore === 'number' ? review.qualityScore : 0;
  const issues = Array.isArray(review.issues) ? review.issues.map((issue: unknown) => String(issue)) : [];
  const correctedLetter = review.canAutoFix && typeof review.correctedLetter === 'string'
    ? review.correctedLetter
    : undefined;

  return {
    pass: qualityScore >= 70 && issues.length === 0,
    correctedLetter,
    issues,
    qualityScore,
    provider,
  };
}

async function reviewWithAnthropic(prompt: string): Promise<AIReviewResult> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';
  return parseAIReviewResponse(responseText, 'anthropic');
}

/** Wrap a promise with a timeout. Rejects with TimeoutError if deadline exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

const AI_REVIEW_TIMEOUT_MS = 30_000; // 30s per provider (Anthropic has its own 60s client timeout)

async function reviewWithGemini(prompt: string): Promise<AIReviewResult> {
  if (!gemini) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await withTimeout(model.generateContent(prompt), AI_REVIEW_TIMEOUT_MS, 'Gemini review');
  return parseAIReviewResponse(result.response.text(), 'gemini');
}

async function reviewWithOpenAI(prompt: string): Promise<AIReviewResult> {
  if (!openai) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const completion = await withTimeout(
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
    AI_REVIEW_TIMEOUT_MS,
    'OpenAI review',
  );

  return parseAIReviewResponse(completion.choices[0]?.message?.content || '', 'openai');
}

/**
 * AI quality review: prefers Claude, falls back to Gemini Flash, then OpenAI,
 * and finally a deterministic heuristic pass when explicitly allowed.
 */
async function aiQualityReview(
  letterContent: string,
  ticketData: { ticket_number: string; violation_date: string; violation_description: string; violation_type: string; amount: number; location: string },
  userName: string,
  options?: { allowHeuristicPass?: boolean }
): Promise<AIReviewResult> {
  const reviewPrompt = buildAIReviewPrompt(letterContent, ticketData, userName);
  const providerErrors: string[] = [];
  const providers: Array<{ name: AIReviewResult['provider']; run: () => Promise<AIReviewResult> }> = [
    { name: 'anthropic', run: () => reviewWithAnthropic(reviewPrompt) },
    { name: 'gemini', run: () => reviewWithGemini(reviewPrompt) },
    { name: 'openai', run: () => reviewWithOpenAI(reviewPrompt) },
  ];

  for (const provider of providers) {
    try {
      const result = await provider.run();
      console.log(`    AI Quality Score (${provider.name}): ${result.qualityScore}/100`);
      if (result.issues.length > 0) {
        console.log(`    AI Issues (${provider.name}): ${result.issues.join('; ')}`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      providerErrors.push(`${provider.name}: ${message}`);
      console.error(`    AI quality review failed via ${provider.name}:`, error);
    }
  }

  // All AI providers failed. Never silently pass a letter through to Lob
  // without real AI review — route it to admin review instead. The
  // previous behavior (pass:true, qualityScore:70 == threshold) meant a
  // full AI outage silently mailed unreviewed letters.
  //
  // The `allowHeuristicPass` option is kept for backward compatibility
  // but no longer short-circuits review. Regardless of its value, a
  // heuristic result now indicates "AI unavailable, hold for human".
  const issuesText = providerErrors.length > 0 ? `AI review unavailable: ${providerErrors.join(' | ')}` : 'AI review unavailable';
  console.error(`    ❌ AI cascade exhausted — letter held for admin review. ${issuesText}`);
  return {
    pass: false,
    issues: [issuesText],
    // Below 70 threshold so existing needs_admin_review branch kicks in
    // at the callsite. Distinct from 0 so we can tell "AI totally missing"
    // apart from "AI ran and judged the letter unfit".
    qualityScore: 50,
    provider: 'heuristic',
  };
}

/**
 * Second-opinion persuasiveness review.
 *
 * The first AI review (aiQualityReview) checks for structural correctness —
 * placeholders, dates, defense coherence. This second pass checks whether
 * the letter actually makes the STRONGEST possible case:
 *
 * - Does it cite the specific legal basis for dismissal?
 * - Does it reference all available evidence (FOIA, street view, weather)?
 * - Is the argument structured to maximize persuasion with the hearing officer?
 * - Could the defense be stronger with a different angle?
 *
 * Returns an improved letter if it finds ways to strengthen the case,
 * or null if the letter is already strong.
 */
async function persuasivenessReview(
  letterContent: string,
  ticketData: { ticket_number: string; violation_date: string; violation_description: string; violation_type: string; amount: number; location: string },
  userName: string,
  availableEvidence: {
    hasStreetView: boolean;
    hasFoiaResponse: boolean;
    hasWeatherData: boolean;
    hasUserPhotos: boolean;
    foiaWinRate: number | null;
  },
): Promise<{
  score: number;
  improved: boolean;
  improvedLetter: string | null;
  suggestions: string[];
  provider: string;
}> {
  const prompt = `You are an expert Chicago parking ticket defense attorney reviewing a contest letter before it is mailed. Your job is NOT to check for errors (that's already done) — your job is to make this letter WIN.

LETTER:
---
${letterContent}
---

TICKET FACTS:
- Ticket: ${ticketData.ticket_number}
- Violation: ${ticketData.violation_description} (${ticketData.violation_type})
- Date: ${ticketData.violation_date}
- Amount: $${ticketData.amount}
- Location: ${ticketData.location || 'Unknown'}
- Respondent: ${userName}

AVAILABLE EVIDENCE:
- Street View imagery: ${availableEvidence.hasStreetView ? 'YES (attached as exhibit)' : 'NO'}
- FOIA response from city: ${availableEvidence.hasFoiaResponse ? 'YES' : 'NO'}
- Weather data: ${availableEvidence.hasWeatherData ? 'YES' : 'NO'}
- User photos: ${availableEvidence.hasUserPhotos ? 'YES' : 'NO'}
${availableEvidence.foiaWinRate !== null ? `- FOIA win rate for this violation: ${availableEvidence.foiaWinRate}% of similar tickets were dismissed` : ''}

EVALUATE ON THESE CRITERIA (score 0-100):

1. LEGAL SPECIFICITY (25 pts): Does it cite specific Municipal Code sections, Illinois Vehicle Code provisions, or relevant case law? Generic "I believe this ticket was issued in error" scores low. Citing "MCC 9-64-170(a)" scores high.

2. EVIDENCE UTILIZATION (25 pts): Does it reference ALL available evidence? If street view is available, does it discuss what the images show? If weather data exists, is it mentioned? Missing available evidence is a wasted opportunity.

3. ARGUMENT STRUCTURE (25 pts): Is the strongest argument presented first? Is there a clear theory of defense? Does it address likely counterarguments? A scattered letter with 5 weak arguments loses to a focused letter with 2 strong ones.

4. PERSUASIVE TONE (25 pts): Does it read like a confident legal brief, or a timid complaint? Does it assert rights firmly without being aggressive? Would a hearing officer take this seriously?

RESPOND WITH JSON ONLY:
{
  "persuasivenessScore": <0-100>,
  "suggestions": ["specific improvement 1", "specific improvement 2"],
  "canStrengthen": true/false,
  "strengthenedLetter": "<if canStrengthen, provide the COMPLETE improved letter. Keep the same facts and evidence — just make the argument stronger. Do NOT invent evidence or cite codes you aren't certain about. Preserve the exact ticket number, dates, and respondent name.>"
}`;

  // Try Claude first (best at legal writing), then Gemini, then OpenAI
  const providers = [
    { name: 'anthropic', run: async () => {
      if (!anthropic) throw new Error('No Anthropic key');
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      return resp.content[0].type === 'text' ? resp.content[0].text : '';
    }},
    { name: 'gemini', run: async () => {
      if (!gemini) throw new Error('No Gemini key');
      const model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    }},
    { name: 'openai', run: async () => {
      if (!openai) throw new Error('No OpenAI key');
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      });
      return resp.choices[0].message?.content || '';
    }},
  ];

  for (const provider of providers) {
    try {
      const text = await provider.run();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      const score = typeof parsed.persuasivenessScore === 'number' ? parsed.persuasivenessScore : 50;
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [];
      const strengthened = parsed.canStrengthen && typeof parsed.strengthenedLetter === 'string' && parsed.strengthenedLetter.length > 200
        ? parsed.strengthenedLetter
        : null;

      console.log(`    Persuasiveness (${provider.name}): ${score}/100${strengthened ? ' — improved version available' : ''}`);
      if (suggestions.length > 0) {
        console.log(`    Suggestions: ${suggestions.join('; ')}`);
      }

      return {
        score,
        improved: strengthened !== null,
        improvedLetter: strengthened,
        suggestions,
        provider: provider.name,
      };
    } catch (err: any) {
      console.log(`    Persuasiveness review failed (${provider.name}): ${err.message}`);
    }
  }

  // All providers failed — don't block, just return neutral score
  return { score: 75, improved: false, improvedLetter: null, suggestions: [], provider: 'none' };
}

/**
 * Mail a single letter via Lob
 */
async function mailLetter(
  letter: LetterToMail,
  profile: UserProfile,
  ticketNumber: string,
  evidenceImages?: string[],
  redLightEvidence?: RedLightEvidenceExhibit,
  foiaExhibits?: import('../../../lib/lob-service').FoiaExhibit[],
): Promise<{ success: boolean; lobId?: string; expectedDelivery?: string; pdfUrl?: string; error?: string; alreadyMailed?: boolean; skipped?: boolean }> {
  console.log(`  Mailing letter ${letter.id} for ticket ${ticketNumber}...`);

  try {
    // Guard: Check if a Lob letter was already created for this letter ID.
    // If the cron crashed after sendLetter() but before the DB update,
    // the letter row still has its old status and will be retried — without
    // this check, we'd create a duplicate physical letter.
    const { data: existingLetter } = await supabaseAdmin
      .from('contest_letters')
      .select('lob_letter_id')
      .eq('id', letter.id)
      .maybeSingle();

    if (existingLetter?.lob_letter_id) {
      console.log(`    Already mailed (Lob ID: ${existingLetter.lob_letter_id}), skipping duplicate`);
      // Fix the status that got missed
      await supabaseAdmin
        .from('contest_letters')
        .update({ status: 'sent', mailed_at: new Date().toISOString() })
        .eq('id', letter.id);
      return { success: true, lobId: existingLetter.lob_letter_id, alreadyMailed: true };
    }

    // Atomically claim this letter for mailing without changing status.
    // We use updated_at as the optimistic-lock token because the DB constraint
    // does not allow a transient "mailing" status.
    const { data: claimedLetter, error: claimError } = await supabaseAdmin
      .from('contest_letters')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', letter.id)
      .eq('status', letter.status)
      .eq('updated_at', letter.updated_at)
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error(`    Failed to claim letter ${letter.id} for mailing: ${claimError.message}`);
      return { success: false, error: claimError.message };
    }

    if (!claimedLetter?.id) {
      console.log(`    Letter ${letter.id} status changed since query — another run may be mailing it, skipping`);
      return { success: true, skipped: true };
    }

    // Build sender name
    const senderName = profile.full_name ||
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
      'Vehicle Owner';

    // Build sender address (user's address)
    const fromAddress = {
      name: senderName,
      address: profile.mailing_address,
      city: profile.mailing_city,
      state: profile.mailing_state,
      zip: profile.mailing_zip,
    };

    // Determine recipient address
    // In test mode, send to user's address instead of city hall
    const testMode = await isTestModeEnabled();
    const toAddress = testMode ? fromAddress : CHICAGO_PARKING_CONTEST_ADDRESS;

    if (testMode) {
      console.log(`    ⚠️ TEST MODE: Sending letter to user's address instead of city hall`);
    }

    // Get letter content (prefer letter_content, fall back to letter_text)
    const letterText = letter.letter_content || letter.letter_text;
    if (!letterText) {
      throw new Error('No letter content found');
    }

    // Format letter as HTML with evidence images, Street View exhibits,
    // red-light sensor data, and FOIA response exhibits.
    const htmlContent = formatLetterAsHTML(letterText, {
      evidenceImages: evidenceImages,
      streetViewImages: letter.street_view_exhibit_urls || undefined,
      streetViewDate: letter.street_view_date || undefined,
      streetViewAddress: letter.street_view_address || undefined,
      redLightEvidence: redLightEvidence,
      foiaExhibits: foiaExhibits,
    });

    if (foiaExhibits && foiaExhibits.length > 0) {
      console.log(`    Including ${foiaExhibits.length} FOIA response exhibit(s) in letter`);
    }

    if (evidenceImages && evidenceImages.length > 0) {
      console.log(`    Including ${evidenceImages.length} evidence image(s) in letter`);
    }
    if (letter.street_view_exhibit_urls && letter.street_view_exhibit_urls.length > 0) {
      console.log(`    Including ${letter.street_view_exhibit_urls.length} Street View exhibit(s) in letter`);
    }
    if (redLightEvidence) {
      console.log(`    Including red-light camera sensor data exhibit (${redLightEvidence.tracePointCount} GPS points, full_stop=${redLightEvidence.fullStopDetected})`);
    }

    // Send via Lob
    // Idempotency key = letter.id ensures the same letter can never create two
    // physical mailings, even if the cron crashes after the Lob API call but
    // before the DB update. Lob deduplicates for 24 hours per key.
    const result = await sendLetter({
      from: fromAddress,
      to: toAddress,
      letterContent: htmlContent,
      description: `Contest letter for ticket ${ticketNumber}${testMode ? ' (TEST)' : ''}`,
      metadata: {
        ticket_id: letter.ticket_id,
        letter_id: letter.id,
        user_id: letter.user_id,
        test_mode: testMode ? 'true' : 'false',
      },
      idempotencyKey: `letter_${letter.id}`,
    });

    console.log(`    Mailed! Lob ID: ${result.id}`);

    // ─── Post-Lob DB consistency: the letter has physically mailed.
    // If these DB updates fail we risk:
    //   a) Re-mailing (next cron sees draft status) — mitigated by Lob's
    //      24h idempotency key on `letter_${letter.id}`, but only 24h.
    //   b) Permanent drift — letter mailed but UI shows draft forever.
    // So retry up to 3x with backoff. If that still fails, file a
    // reconciliation record in ticket_audit_log with enough data to
    // repair by hand, and alert admin loudly.
    const letterUpdatePayload = {
      status: 'sent',
      lob_letter_id: result.id,
      letter_pdf_url: result.url,
      tracking_number: result.tracking_number || null,
      mailed_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    };
    let letterUpdateErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabaseAdmin
        .from('contest_letters')
        .update(letterUpdatePayload)
        .eq('id', letter.id);
      if (!error) { letterUpdateErr = null; break; }
      letterUpdateErr = error;
      console.error(`    ⚠️ contest_letters update attempt ${attempt}/3 failed: ${error.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
    }
    if (letterUpdateErr) {
      console.error(`    🚨 contest_letters update PERMANENTLY FAILED after 3 attempts. Letter physically mailed but DB state is draft. Filing reconciliation.`);
      // Reconciliation record — admin can replay this to fix the DB.
      await supabaseAdmin
        .from('ticket_audit_log')
        .insert({
          ticket_id: letter.ticket_id,
          user_id: letter.user_id,
          action: 'letter_mail_reconciliation_needed',
          details: {
            letter_id: letter.id,
            lob_letter_id: result.id,
            letter_pdf_url: result.url,
            tracking_number: result.tracking_number || null,
            expected_delivery: result.expected_delivery_date,
            error: letterUpdateErr.message,
            performed_by_system: 'autopilot_cron',
          },
          performed_by: null,
        });
      // Admin alert
      if (process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Autopilot America <alerts@autopilotamerica.com>',
              to: getAdminAlertEmails(),
              subject: `🚨 Contest letter DB reconciliation needed — letter ${letter.id}`,
              html: `
                <p>Letter <code>${letter.id}</code> was physically mailed via Lob (<code>${result.id}</code>) but the contest_letters UPDATE failed 3 times.</p>
                <p>The letter exists in the real world but the DB still shows it as draft. Next cron could attempt to re-mail (protected by Lob's 24h idempotency window, which will lapse).</p>
                <p><strong>Manual fix:</strong> run <code>UPDATE contest_letters SET status='sent', lob_letter_id='${result.id}', letter_pdf_url='${result.url ?? ''}', mailed_at=now(), sent_at=now() WHERE id='${letter.id}';</code></p>
                <p>Reconciliation row filed in ticket_audit_log with action=letter_mail_reconciliation_needed.</p>
                <p>DB error: <code>${letterUpdateErr.message}</code></p>
              `,
            }),
          });
        } catch {}
      }
    } else {
      console.log(`    ✅ Updated contest_letters ${letter.id} to 'sent'`);
    }

    // Update ticket status (same retry pattern — less critical but still
    // important for user-facing status)
    let ticketUpdateErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'mailed' })
        .eq('id', letter.ticket_id);
      if (!error) { ticketUpdateErr = null; break; }
      ticketUpdateErr = error;
      if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
    }
    if (ticketUpdateErr) {
      console.error(`    ❌ Failed to update detected_tickets status after 3 attempts: ${ticketUpdateErr.message}`);
    }

    // Log to audit (performed_by is null for system actions)
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        action: 'letter_mailed',
        details: {
          lob_letter_id: result.id,
          tracking_number: result.tracking_number,
          expected_delivery: result.expected_delivery_date,
          performed_by_system: 'autopilot_cron',
        },
        performed_by: null,
      });

    return {
      success: true,
      lobId: result.id,
      expectedDelivery: result.expected_delivery_date || null,
      pdfUrl: result.url || null,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`    Error mailing letter: ${errorMessage}`);

    // Update letter status to failed
    await supabaseAdmin
      .from('contest_letters')
      .update({ status: 'failed' })
      .eq('id', letter.id);

    // Log error to audit (performed_by is null for system actions)
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        action: 'letter_mail_failed',
        details: {
          error: errorMessage,
          performed_by_system: 'autopilot_cron',
        },
        performed_by: null,
      });

    // Notify admin immediately so we can fix Lob failures ASAP
    if (resend) {
      try {
        await resend.emails.send({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: getAdminAlertEmails(),
          subject: `🚨 Lob Mailing FAILED — Ticket ${ticketNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #DC2626; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">Letter Mailing Failed</h2>
              </div>
              <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="margin: 0 0 12px; color: #374151;"><strong>Ticket:</strong> ${ticketNumber}</p>
                <p style="margin: 0 0 12px; color: #374151;"><strong>Letter ID:</strong> ${letter.id}</p>
                <p style="margin: 0 0 12px; color: #374151;"><strong>User ID:</strong> ${letter.user_id}</p>
                <p style="margin: 0 0 12px; color: #DC2626;"><strong>Error:</strong> ${errorMessage}</p>
                <p style="margin: 0; font-size: 13px; color: #6b7280;">Check Lob dashboard and Supabase contest_letters table. Letter status set to 'failed'.</p>
              </div>
            </div>
          `,
        });
      } catch (notifyErr) {
        console.error('    Failed to send admin failure notification:', notifyErr);
      }
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Send email notification that letter was mailed
 */
async function sendLetterMailedNotification(
  userId: string,
  ticketNumber: string,
  expectedDeliveryDate: string | null,
  pdfUrl: string | null
): Promise<void> {
  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_letter_sent')
    .eq('user_id', userId)
    .maybeSingle();

  // Default to true if setting doesn't exist
  if (settings && settings.email_on_letter_sent === false) {
    console.log(`  User ${userId} has email_on_letter_sent disabled, skipping notification`);
    return;
  }

  // Get user email and profile
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) {
    console.log(`  User ${userId} has no email, skipping notification`);
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .maybeSingle();

  const firstName = profile?.first_name || 'there';
  const email = userData.user.email;

  if (!resend) {
    console.log(`  RESEND not configured, would send to ${email}: Letter mailed for ticket ${ticketNumber}`);
    return;
  }

  try {
    // Format expected delivery date
    let deliveryText = '';
    if (expectedDeliveryDate) {
      const deliveryDate = new Date(expectedDeliveryDate);
      deliveryText = deliveryDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✉️ Your Contest Letter Has Been Mailed!</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
        </div>

        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
            Hi ${firstName},
          </p>

          <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
            Great news! Your contest letter for ticket #${ticketNumber} has been printed and mailed to the City of Chicago's Department of Finance.
          </p>

          <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 24px; margin-right: 12px;">📬</span>
              <span style="font-size: 18px; font-weight: bold; color: #166534;">Letter Mailed Successfully</span>
            </div>
            ${deliveryText ? `
            <p style="margin: 0; font-size: 14px; color: #166534;">
              <strong>Expected Delivery:</strong> ${deliveryText}
            </p>
            ` : ''}
          </div>

          <h3 style="margin: 0 0 12px; font-size: 16px; color: #374151;">What happens next?</h3>
          <ol style="margin: 0 0 20px; padding-left: 20px; color: #4b5563; font-size: 14px; line-height: 1.8;">
            <li>The city will receive your letter within 3-5 business days</li>
            <li>They'll review your contest and any evidence provided</li>
            <li>You'll receive a decision by mail, typically within 2-4 weeks</li>
            <li>If successful, the ticket will be dismissed or reduced</li>
          </ol>

          ${pdfUrl ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${pdfUrl}"
               style="display: inline-block; background: #0F172A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View Your Letter (PDF)
            </a>
            <p style="margin: 8px 0 0; font-size: 12px; color: #9CA3AF;">
              This link expires in 30 days. Save or download a copy for your records.
            </p>
          </div>
          ` : ''}

          <div style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 14px; color: #92400E;">
              <strong>Pro tip:</strong> Keep an eye on your mailbox for the city's response. If you don't hear back within 4 weeks, you can check the ticket status on the <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/svcs/check_ticket_status.html" style="color: #92400E;">City of Chicago website</a>.
            </p>
          </div>

          <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
            Questions? Reply to this email or contact support@autopilotamerica.com
          </p>
        </div>

        <p style="margin: 20px 0 0; font-size: 12px; color: #9CA3AF; text-align: center;">
          You're receiving this because you have Autopilot ticket monitoring enabled.<br>
          <a href="https://autopilotamerica.com/settings" style="color: #6B7280;">Manage notification preferences</a>
        </p>
      </div>
    `;

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [email],
      subject: `✉️ Contest Letter Mailed - Ticket #${ticketNumber}`,
      html,
    });

    console.log(`  ✅ Sent letter mailed notification to ${email}`);

  } catch (error) {
    console.error(`  ❌ Failed to send letter mailed notification to ${email}:`, error);
  }
}

/**
 * Increment user's letter count and check if they've exceeded included letters
 */
async function incrementLetterCount(userId: string): Promise<{ exceeded: boolean; count: number }> {
  // Use atomic SQL increment to prevent race conditions with concurrent mailing
  const { data: updated, error } = await supabaseAdmin
    .rpc('increment_letters_used', { p_user_id: userId });

  // Fallback if RPC doesn't exist yet
  if (error) {
    console.warn(`  RPC increment_letters_used failed (${error.message}), using fallback`);
    const { data: sub } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub) {
      return { exceeded: false, count: 0 };
    }

    const subRecord = sub as Record<string, unknown>;
    const lettersIncludedRemaining = typeof subRecord.letters_included_remaining === 'number'
      ? subRecord.letters_included_remaining
      : null;
    const lettersUsedThisPeriod = typeof subRecord.letters_used_this_period === 'number'
      ? subRecord.letters_used_this_period
      : null;
    const lettersIncluded = typeof subRecord.letters_included === 'number'
      ? subRecord.letters_included
      : null;

    if (typeof lettersIncludedRemaining === 'number') {
      const currentRemaining = lettersIncludedRemaining;
      const nextRemaining = currentRemaining > 0 ? currentRemaining - 1 : 0;

      const { data: updatedRemaining, error: updateRemainingError } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .update({ letters_included_remaining: nextRemaining })
        .eq('user_id', userId)
        .eq('letters_included_remaining', currentRemaining)
        .select('*')
        .maybeSingle();

      if (updateRemainingError) {
        console.error(`  incrementLetterCount remaining fallback: update failed for user ${userId}: ${updateRemainingError.message}`);
      }

      const effectiveSub = (updatedRemaining || sub) as Record<string, unknown>;
      const included = typeof effectiveSub.letters_included === 'number' ? effectiveSub.letters_included : lettersIncluded;
      const count = included !== null
        ? Math.max(0, included - (typeof effectiveSub.letters_included_remaining === 'number' ? effectiveSub.letters_included_remaining : 0))
        : Math.max(0, typeof effectiveSub.letters_used_this_period === 'number' ? effectiveSub.letters_used_this_period : (lettersUsedThisPeriod || 0));

      if (!updatedRemaining) {
        console.warn(`  incrementLetterCount remaining fallback: concurrent update for user ${userId}, count may be stale`);
      }

      return {
        exceeded: currentRemaining <= 0,
        count,
      };
    }

    const currentCount = lettersUsedThisPeriod || 0;
    const newCount = currentCount + 1;

    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .update({ letters_used_this_period: newCount })
      .eq('user_id', userId)
      .eq('letters_used_this_period', currentCount) // optimistic lock
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error(`  incrementLetterCount fallback: update failed for user ${userId}: ${updateError.message}`);
    }

    if (!updatedRow?.id) {
      console.warn(`  incrementLetterCount fallback: concurrent update for user ${userId}, retrying`);
      // Re-read and retry once
      const { data: sub2 } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if (!sub2) return { exceeded: false, count: 0 };
      const sub2Record = sub2 as Record<string, unknown>;
      const retryCurrentCount = typeof sub2Record.letters_used_this_period === 'number' ? sub2Record.letters_used_this_period : 0;
      const retryCount = retryCurrentCount + 1;
      const { data: retryUpdatedRow, error: retryError } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .update({ letters_used_this_period: retryCount })
        .eq('user_id', userId)
        .eq('letters_used_this_period', retryCurrentCount) // optimistic lock on retry too
        .select('id')
        .maybeSingle();
      if (retryError) {
        console.error(`  incrementLetterCount retry: update failed for user ${userId}: ${retryError.message}`);
      }
      if (!retryUpdatedRow?.id) {
        console.warn(`  incrementLetterCount: second concurrent update for user ${userId}, count may be stale`);
      }
      return { exceeded: retryCount > ((typeof sub2Record.letters_included === 'number' ? sub2Record.letters_included : lettersIncluded) || 1), count: retryCount };
    }

    return {
      exceeded: newCount > ((lettersIncluded || 1)),
      count: newCount,
    };
  }

  // RPC returns { new_count, letters_included }
  const newCount = updated?.new_count ?? 0;
  const included = updated?.letters_included ?? 1;

  return {
    exceeded: newCount > included,
    count: newCount,
  };
}

async function enqueueFoiaRequestForTicket(params: {
  ticketId: string;
  letterId: string;
  userId: string;
  ticketNumber: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    ticket_id: params.ticketId,
    contest_letter_id: params.letterId,
    user_id: params.userId,
    request_type: 'ticket_evidence_packet',
    status: 'queued',
    source: 'autopilot_mailing',
    request_payload: {
      ticket_number: params.ticketNumber,
      queued_by: 'autopilot_mail_letters_cron',
    },
    requested_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin
    .from('ticket_foia_requests' as any)
    .upsert(payload as any, { onConflict: 'ticket_id,request_type' });

  if (error) {
    console.error(`    Failed to queue FOIA request for ticket ${params.ticketNumber}: ${error.message}`);
    return;
  }

  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: params.ticketId,
      action: 'foia_request_queued',
      details: {
        request_type: 'ticket_evidence_packet',
        source: 'autopilot_mailing',
      },
      performed_by: null,
    });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📬 Starting Autopilot letter mailing...');

  // Check if LOB_API_KEY is configured
  if (!process.env.LOB_API_KEY) {
    console.error('LOB_API_KEY not configured');
    return res.status(500).json({
      success: false,
      error: 'Lob API key not configured',
    });
  }

  try {
    // Check kill switches
    const killCheck = await checkKillSwitches();
    if (!killCheck.proceed) {
      console.log(`⚠️ ${killCheck.message}`);
      return res.status(200).json({
        success: true,
        message: killCheck.message,
        skipped: true,
      });
    }

    const now = new Date().toISOString();

    // Get letters that are ready to mail:
    // 1. status='approved' — user clicked approval link OR day-19 safety net triggered
    // 2. For auto_mail_enabled users: evidence_deadline has passed
    const { data: letters } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        letter_text,
        defense_type,
        status,
        approved_via,
        updated_at,
        street_view_exhibit_urls,
        street_view_date,
        street_view_address,
        cdot_foia_integrated,
        finance_foia_integrated,
        detected_tickets!inner (
          id,
          ticket_number,
          status,
          violation_date,
          violation_description,
          violation_type,
          amount,
          location,
          issue_datetime,
          evidence_deadline,
          auto_send_deadline,
          is_test,
          user_evidence,
          plate,
          state,
          ticket_plate,
          ticket_state,
          created_at
        )
      `)
      .or(`status.eq.approved,status.eq.ready,status.eq.awaiting_consent,status.eq.mailing`)
      .order('created_at', { ascending: true })
      .limit(50);

    if (!letters || letters.length === 0) {
      console.log('No letters to process');
      return res.status(200).json({
        success: true,
        message: 'No letters to mail',
        lettersMailed: 0,
      });
    }

    // Filter to letters that are actually ready to mail
    const readyLetters = letters.filter((l: any) => {
      const ticket = l.detected_tickets;
      if (!ticket) return false;

      // Skip test tickets
      if (ticket.is_test) {
        console.log(`  Skipping test ticket ${ticket.ticket_number}`);
        return false;
      }

      // Case -1: Letter stuck in 'mailing' from a crashed run — retry after 30 min
      if (l.status === 'mailing') {
        const updatedAt = l.updated_at ? new Date(l.updated_at).getTime() : 0;
        const stuckMinutes = (Date.now() - updatedAt) / (1000 * 60);
        if (stuckMinutes >= 30) {
          console.log(`  Letter ${l.id} stuck in 'mailing' for ${Math.round(stuckMinutes)} min — retrying`);
          return true;
        }
        console.log(`  Letter ${l.id} is 'mailing' (${Math.round(stuckMinutes)} min ago) — waiting for previous run`);
        return false;
      }

      // Case 0: Letter admin-approved — ready to mail
      if (isAdminApprovedLetter(l)) {
        return true;
      }

      // Case 1: Letter explicitly approved (user clicked link or safety net triggered)
      if (l.status === 'approved') {
        return true;
      }

      // Case 1b: Letter was waiting for consent — re-evaluate if consent is now given
      if (l.status === 'awaiting_consent') {
        // Will be checked against profile.contest_consent in the per-letter loop
        return true;
      }

      // Case 2: Ticket status is 'approved' (set by reminders cron safety net)
      if (ticket.status === 'approved') {
        return true;
      }

      // Case 3: Auto-send — evidence deadline (Day 17) has passed
      // Letters auto-mail once evidence_deadline + 1h buffer <= now.
      // The 1-hour buffer prevents a race condition where the cron fires
      // at exactly the deadline time, mailing before the user's evidence
      // window has fully expired.
      if (ticket.evidence_deadline) {
        const deadline = new Date(ticket.evidence_deadline);
        const deadlineWithBuffer = new Date(deadline.getTime() + 60 * 60 * 1000); // +1 hour
        if (deadlineWithBuffer <= new Date()) {
          return true;
        }
      }

      return false;
    });

    if (readyLetters.length === 0) {
      console.log('No letters ready to mail (waiting for evidence deadline)');
      return res.status(200).json({
        success: true,
        message: 'No letters ready (waiting for evidence deadlines)',
        lettersMailed: 0,
        pendingEvidence: letters.length,
      });
    }

    console.log(`📋 Processing ${readyLetters.length} letters (${letters.length - readyLetters.length} still waiting for evidence)`);

    let lettersMailed = 0;
    let errors = 0;
    let timedOutBeforeCompletion = false;
    let lettersSkippedDueToTimeout = 0;
    const cronStartTime = Date.now();
    const CRON_TIMEOUT_BUFFER_MS = 15_000; // Stop 15s before maxDuration to avoid mid-operation timeout
    const CRON_MAX_MS = 120_000; // maxDuration from config

    for (let i = 0; i < readyLetters.length; i++) {
      const letter = readyLetters[i];
      // Elapsed time guard: stop processing before cron timeout kills us mid-operation
      const elapsedMs = Date.now() - cronStartTime;
      if (elapsedMs > CRON_MAX_MS - CRON_TIMEOUT_BUFFER_MS) {
        lettersSkippedDueToTimeout = readyLetters.length - i;
        timedOutBeforeCompletion = true;
        console.warn(`  ⏱️ Approaching cron timeout (${Math.round(elapsedMs / 1000)}s elapsed / ${CRON_MAX_MS / 1000}s budget), stopping with ${lettersSkippedDueToTimeout} letters remaining`);
        break;
      }

      // Get user profile for mailing address
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', letter.user_id)
        .maybeSingle();

      if (!profile || !profile.mailing_address) {
        console.log(`  Skipping letter ${letter.id}: Missing profile/address info`);
        // Update letter status so it's not retried every cron run
        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'missing_address', updated_at: new Date().toISOString() })
          .eq('id', letter.id);
        errors++;
        continue;
      }

      // Validate address completeness (street alone is not enough for Lob)
      if (!profile.mailing_city || !profile.mailing_state || !profile.mailing_zip) {
        console.log(`  Skipping letter ${letter.id}: Incomplete address (missing city/state/zip)`);
        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'missing_address', updated_at: new Date().toISOString() })
          .eq('id', letter.id);
        errors++;
        continue;
      }

      // AUTHORIZATION GATE: Do not mail letters without contest consent
      // Exception: admin_approved letters bypass consent — the admin approval IS the authorization
      // (this is the Day-19 safety net: if the user never responded to consent emails,
      //  an admin can approve the letter directly)
      if (!profile.contest_consent && !isAdminApprovedLetter(letter as any)) {
        console.log(`  ⚠️ Skipping letter ${letter.id}: User ${letter.user_id} has not provided contest authorization (no e-signature on file)`);
        // Update letter status so it's not retried every run
        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'awaiting_consent' })
          .eq('id', letter.id);
        continue;
      }

      // SUBSCRIPTION GATE: Verify user has active subscription before mailing
      const { data: subscription } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .select('status, letters_included_remaining')
        .eq('user_id', letter.user_id)
        .maybeSingle();

      if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
        console.log(`  ⚠️ Skipping letter ${letter.id}: User ${letter.user_id} subscription is ${subscription?.status || 'missing'} (not active/trialing)`);
        // Update letter status so it's not retried every cron run
        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'subscription_required', updated_at: new Date().toISOString() })
          .eq('id', letter.id);
        // Update ticket status (guard: don't overwrite terminal statuses)
        await supabaseAdmin
          .from('detected_tickets')
          .update({ status: 'subscription_required' })
          .eq('id', letter.ticket_id)
          .not('status', 'in', '(dismissed,upheld,paid,won,lost,skipped)');
        errors++;
        continue;
      }

      // Build full name if not present
      if (!profile.full_name) {
        profile.full_name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
      }
      // Guard against empty name — Lob requires a non-empty name field
      if (!profile.full_name) {
        profile.full_name = 'Vehicle Owner';
      }

      const ticket = (letter as any).detected_tickets;
      const ticketNumber = ticket?.ticket_number || 'Unknown';
      const adminApproved = isAdminApprovedLetter(letter as any);

      // ── QUALITY GATE: Validate letter before mailing ──
      const letterText = letter.letter_content || letter.letter_text;
      if (letterText) {
        // Pull user_evidence.text so validation can confirm the letter
        // actually incorporates the user's factual claim.
        let userEvidenceText: string | null = null;
        try {
          const raw = (ticket as any)?.user_evidence;
          if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed?.text && typeof parsed.text === 'string' && parsed.text.trim()) {
              userEvidenceText = parsed.text;
            }
          }
        } catch { /* non-fatal */ }

        const validation = validateLetterContent(letterText, {
          ticket_number: ticketNumber,
          violation_date: ticket?.violation_date || '',
          violation_type: ticket?.violation_type || '',
          violation_description: ticket?.violation_description || '',
          user_evidence_text: userEvidenceText,
        });

        if (!validation.pass) {
          console.log(`    ⚠️ Letter quality issues found: ${validation.issues.join('; ')}`);

          // Skip AI review for unfixable issues — saves API tokens and cron time.
          // Letters that are too short, contain AI self-references, or are too long
          // need regeneration, not patching. Flag them directly for admin review.
          const unfixableIssues = validation.issues.filter(i =>
            i.includes('suspiciously short') ||
            i.includes('suspiciously long') ||
            i.includes('AI self-reference')
          );
          if (unfixableIssues.length > 0) {
            console.log(`    ⏭️ Skipping AI review — unfixable issues: ${unfixableIssues.join('; ')}`);
            await supabaseAdmin
              .from('contest_letters')
              .update({ status: 'needs_admin_review' })
              .eq('id', letter.id);

            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id,
              user_id: letter.user_id,
              action: 'letter_quality_failed',
              details: {
                validation_issues: validation.issues,
                unfixable: true,
                ai_review_skipped: true,
                performed_by_system: 'autopilot_cron',
              },
              performed_by: null,
            });
            continue;
          }

          // Try AI auto-fix for fixable issues (placeholders, date errors, etc.)
          const aiReview = await aiQualityReview(letterText, {
            ticket_number: ticketNumber,
            violation_date: ticket?.violation_date || '',
            violation_description: ticket?.violation_description || '',
            violation_type: ticket?.violation_type || '',
            amount: ticket?.amount || 0,
            location: ticket?.location || '',
          }, profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(), { allowHeuristicPass: false });

          if (aiReview.correctedLetter && aiReview.correctedLetter.length > 200) {
            // AI was able to fix the letter — save corrected version
            console.log(`    ✅ AI auto-fixed letter (score: ${aiReview.qualityScore}/100)`);
            const { error: updateErr } = await supabaseAdmin
              .from('contest_letters')
              .update({
                letter_content: aiReview.correctedLetter,
                status: 'needs_admin_review',
              })
              .eq('id', letter.id);
            if (updateErr) console.error(`    Failed to save AI-corrected letter:`, updateErr.message);

            // Log the auto-fix
            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id,
              user_id: letter.user_id,
              action: 'letter_ai_quality_fix',
              details: {
                original_issues: validation.issues,
                ai_issues: aiReview.issues,
                ai_quality_score: aiReview.qualityScore,
                performed_by_system: 'autopilot_cron',
              },
              performed_by: null,
            });
          } else {
            // AI couldn't fix — flag for admin review
            console.log(`    ❌ Letter needs admin review (score: ${aiReview.qualityScore}/100)`);
            await supabaseAdmin
              .from('contest_letters')
              .update({ status: 'needs_admin_review' })
              .eq('id', letter.id);

            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id,
              user_id: letter.user_id,
              action: 'letter_quality_failed',
              details: {
                validation_issues: validation.issues,
                ai_issues: aiReview.issues,
                ai_quality_score: aiReview.qualityScore,
                performed_by_system: 'autopilot_cron',
              },
              performed_by: null,
            });
          }
          // Either way, don't mail yet — admin must review
          continue;
        }

        if (adminApproved) {
          console.log(`    ✅ Skipping AI review for admin-approved letter ${letter.id}`);
        } else {
          // Even if placeholder check passed, run AI review for defense coherence
          const aiReview = await aiQualityReview(letterText, {
            ticket_number: ticketNumber,
            violation_date: ticket?.violation_date || '',
            violation_description: ticket?.violation_description || '',
            violation_type: ticket?.violation_type || '',
            amount: ticket?.amount || 0,
            location: ticket?.location || '',
          }, profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(), { allowHeuristicPass: true });

          if (!aiReview.pass && aiReview.qualityScore < 70) {
            const aiDown = aiReview.provider === 'heuristic';
            if (aiDown) {
              console.error(`    🚨 AI cascade exhausted for letter ${letter.id} — all three providers failed. Holding for admin review. Issues: ${aiReview.issues.join('; ')}`);
            } else {
              console.log(`    ⚠️ AI review flagged issues (score: ${aiReview.qualityScore}/100): ${aiReview.issues.join('; ')}`);
            }

            if (aiReview.correctedLetter && aiReview.correctedLetter.length > 200) {
              // Save corrected version, still require admin review
              await supabaseAdmin.from('contest_letters')
                .update({ letter_content: aiReview.correctedLetter, status: 'needs_admin_review' })
                .eq('id', letter.id);
            } else {
              await supabaseAdmin.from('contest_letters')
                .update({ status: 'needs_admin_review' })
                .eq('id', letter.id);
            }

            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id, user_id: letter.user_id,
              action: aiDown ? 'letter_ai_cascade_exhausted' : 'letter_ai_review_flagged',
              details: { ai_issues: aiReview.issues, ai_quality_score: aiReview.qualityScore, ai_provider: aiReview.provider, performed_by_system: 'autopilot_cron' },
              performed_by: null,
            });

            // Loud admin alert when AI cascade is fully down — otherwise
            // letters silently pile up in the needs_admin_review queue
            // with no one notified.
            if (aiDown && process.env.RESEND_API_KEY) {
              try {
                await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    from: 'Autopilot America <alerts@autopilotamerica.com>',
                    to: getAdminAlertEmails(),
                    subject: `🚨 AI review cascade exhausted — letter ${letter.id} held for admin`,
                    html: `
                      <p><strong>All three AI providers failed</strong> during quality review.</p>
                      <p>Letter <code>${letter.id}</code> for ticket <code>${ticketNumber}</code> (user <code>${letter.user_id}</code>) has been moved to <code>needs_admin_review</code>.</p>
                      <p>Previous behavior would have silently mailed this letter without review. It is now blocked until an admin approves or Anthropic/Gemini/OpenAI come back online.</p>
                      <p><strong>Provider errors:</strong></p>
                      <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${aiReview.issues.join('\n')}</pre>
                      <p>Check API keys, rate limits, and provider status pages.</p>
                    `,
                  }),
                });
              } catch (alertErr: any) {
                console.error(`    Admin AI-cascade alert failed: ${alertErr.message}`);
              }
            }
            continue;
          }

          console.log(`    ✅ Quality check passed (AI score: ${aiReview.qualityScore}/100)`);

          // ── PERSUASIVENESS REVIEW (second opinion) ──
          // QA passed — now check if the letter makes the strongest possible case.
          // If the AI can strengthen it, save the improved version.
          try {
            const ticketObj = ticket as any;
            const userEvidence = ticketObj?.user_evidence || {};
            const persuasion = await persuasivenessReview(letterText, {
              ticket_number: ticketNumber,
              violation_date: ticketObj?.violation_date || '',
              violation_description: ticketObj?.violation_description || '',
              violation_type: ticketObj?.violation_type || '',
              amount: ticketObj?.amount || 0,
              location: ticketObj?.location || '',
            }, profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(), {
              hasStreetView: !!(letter.street_view_exhibit_urls && letter.street_view_exhibit_urls.length > 0),
              hasFoiaResponse: !!((letter as any).finance_foia_integrated || (letter as any).cdot_foia_integrated),
              hasWeatherData: !!userEvidence?.weather_data,
              hasUserPhotos: !!(userEvidence?.attachment_urls?.length > 0),
              foiaWinRate: null, // Could query win_rate_statistics here in future
            });

            if (persuasion.improved && persuasion.improvedLetter) {
              console.log(`    ✍️ Persuasiveness improved (${persuasion.score}/100 → stronger version saved)`);
              await supabaseAdmin.from('contest_letters')
                .update({ letter_content: persuasion.improvedLetter })
                .eq('id', letter.id);

              await supabaseAdmin.from('ticket_audit_log').insert({
                ticket_id: letter.ticket_id, user_id: letter.user_id,
                action: 'letter_persuasiveness_improved',
                details: {
                  original_score: persuasion.score,
                  suggestions: persuasion.suggestions,
                  provider: persuasion.provider,
                  performed_by_system: 'autopilot_cron',
                },
                performed_by: null,
              });
            } else {
              console.log(`    ✅ Persuasiveness OK (${persuasion.score}/100)`);
            }
          } catch (persuasionErr: any) {
            // Non-blocking — if persuasiveness review fails, letter still proceeds
            console.log(`    ⚠️ Persuasiveness review error (non-blocking): ${persuasionErr.message}`);
          }
        }
      }

      // ── ADMIN REVIEW GATE: All letters must be admin-approved before mailing ──
      // Letters with status 'needs_admin_review' are caught above.
      // Letters explicitly admin-approved via approved_via proceed to mailing.
      // All other letters get flagged for admin review.
      if (!adminApproved) {
        console.log(`    ⏸ Letter ${letter.id} requires admin review before mailing`);
        if (letter.status !== 'needs_admin_review') {
          await supabaseAdmin
            .from('contest_letters')
            .update({ status: 'needs_admin_review' })
            .eq('id', letter.id);
        }
        continue;
      }

      // ── FOIA INTEGRATION STATUS: Log which FOIA data has been integrated ──
      // This is informational only — admin approval is the final gate.
      // The admin can see FOIA status on the ticket page when reviewing.
      const cdotFoia = (letter as any).cdot_foia_integrated;
      const financeFoia = (letter as any).finance_foia_integrated;
      if (cdotFoia !== undefined && financeFoia !== undefined) {
        const missingFoia: string[] = [];
        if (cdotFoia === false) missingFoia.push('CDOT FOIA');
        if (financeFoia === false) missingFoia.push('Finance FOIA');
        if (missingFoia.length > 0) {
          console.log(`    ℹ️ Letter ${letter.id} missing FOIA integration: ${missingFoia.join(', ')} (proceeding — admin approved)`);
        } else {
          console.log(`    ✅ Letter ${letter.id} has all FOIA data integrated`);
        }
      }

      // Extract evidence image URLs from user_evidence JSON
      // Note: user_evidence is stored as a text string, not JSONB, so we need to parse it
      let evidenceImages: string[] = [];
      const userEvidenceRaw = (letter as any).detected_tickets?.user_evidence;
      if (userEvidenceRaw) {
        try {
          const userEvidence: EvidenceData = typeof userEvidenceRaw === 'string'
            ? JSON.parse(userEvidenceRaw)
            : userEvidenceRaw;

          // Check attachment_urls (populated by both email and SMS evidence webhooks)
          if (userEvidence?.attachment_urls && Array.isArray(userEvidence.attachment_urls)) {
            // Filter to only include image URLs (not PDFs or other files)
            evidenceImages = userEvidence.attachment_urls.filter((url: string) => {
              const lowerUrl = url.toLowerCase();
              return lowerUrl.includes('.jpg') ||
                     lowerUrl.includes('.jpeg') ||
                     lowerUrl.includes('.png') ||
                     lowerUrl.includes('.gif') ||
                     lowerUrl.includes('.webp') ||
                     lowerUrl.includes('.heic') ||
                     // Vercel Blob evidence uploads (MMS images may not have extensions)
                     lowerUrl.includes('blob.vercel-storage.com/evidence') ||
                     lowerUrl.includes('image');
            });
          }
          // Fallback: extract image URLs from photo_analyses (each has {url, filename, description})
          if (evidenceImages.length === 0 && userEvidence?.photo_analyses && Array.isArray(userEvidence.photo_analyses)) {
            evidenceImages = userEvidence.photo_analyses
              .filter((pa: any) => pa.url)
              .map((pa: any) => pa.url);
          }
          // Fallback: also check sms_attachments (legacy SMS evidence format)
          if (evidenceImages.length === 0 && userEvidence?.sms_attachments && Array.isArray(userEvidence.sms_attachments)) {
            evidenceImages = userEvidence.sms_attachments
              .filter((att: any) => att.url && /^image\//i.test(att.content_type || ''))
              .map((att: any) => att.url);
          }
          if (evidenceImages.length > 0) {
            console.log(`    Found ${evidenceImages.length} evidence image(s) to include (source: ${userEvidence?.received_via || 'email'})`);
          } else {
            console.warn(`    ⚠️ User evidence exists but no images extracted (tried attachment_urls, photo_analyses, sms_attachments)`);
          }
        } catch (parseError) {
          console.error('    Failed to parse user_evidence JSON:', parseError);
        }
      }

      // Fetch red-light camera receipt data for red-light violations
      let redLightEvidence: RedLightEvidenceExhibit | undefined;
      const ticketViolationType = ticket?.violation_type || '';
      const ticketViolationDesc = (ticket?.violation_description || '').toLowerCase();
      if (ticketViolationType === 'red_light' || ticketViolationDesc.includes('red light')) {
        try {
          const { data: receipts } = await supabaseAdmin
            .from('red_light_receipts')
            .select('*')
            .eq('user_id', letter.user_id)
            .order('created_at', { ascending: false })
            .limit(5);

          if (receipts && receipts.length > 0) {
            // Try to match by date, fall back to most recent
            const ticketDateStr = ticket?.violation_date || '';
            const matched = receipts.find((r: any) => {
              if (!r.device_timestamp || !ticketDateStr) return false;
              return r.device_timestamp.startsWith(ticketDateStr);
            }) || receipts[0];

            const trace = Array.isArray(matched.trace) ? matched.trace : [];
            const baseTs = trace.length > 0 ? trace[0].timestamp : 0;
            const traceDuration = trace.length > 1
              ? (trace[trace.length - 1].timestamp - trace[0].timestamp) / 1000
              : 0;

            // Sample speed profile (max 25 readings for the exhibit)
            const step = trace.length <= 25 ? 1 : Math.ceil(trace.length / 25);
            const speedProfile = trace
              .filter((_: any, i: number) => i % step === 0)
              .map((t: any) => ({
                elapsedSec: (t.timestamp - baseTs) / 1000,
                speedMph: t.speedMph || 0,
              }));

            // Compute peak deceleration from accelerometer
            const accelTrace = Array.isArray(matched.accelerometer_trace) ? matched.accelerometer_trace : [];
            let peakDecelG = 0;
            for (const a of accelTrace) {
              const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
              if (mag > peakDecelG) peakDecelG = mag;
            }

            // Check for violation timestamp from detected_tickets
            let violationDatetime: string | null = null;
            let timeDiffMinutes: number | null = null;
            if (ticket?.issue_datetime) {
              violationDatetime = ticket.issue_datetime;
              const vTime = new Date(ticket.issue_datetime).getTime();
              const dTime = new Date(matched.device_timestamp).getTime();
              timeDiffMinutes = Math.abs(vTime - dTime) / 60000;
            }

            // Compute evidence hash
            const evidenceHash = matched.evidence_hash || computeEvidenceHash({
              id: matched.id,
              device_timestamp: matched.device_timestamp,
              camera_address: matched.camera_address || matched.intersection_id || '',
              camera_latitude: matched.camera_latitude || 0,
              camera_longitude: matched.camera_longitude || 0,
              intersection_id: matched.intersection_id || '',
              heading: matched.heading || 0,
              approach_speed_mph: matched.approach_speed_mph ?? null,
              min_speed_mph: matched.min_speed_mph ?? null,
              speed_delta_mph: matched.speed_delta_mph ?? null,
              full_stop_detected: matched.full_stop_detected ?? false,
              full_stop_duration_sec: matched.full_stop_duration_sec ?? null,
              horizontal_accuracy_meters: matched.horizontal_accuracy_meters ?? null,
              estimated_speed_accuracy_mph: matched.estimated_speed_accuracy_mph ?? null,
              trace: trace,
              accelerometer_trace: accelTrace,
            });

            // Run defense analysis (yellow light, right turn, weather, geometry, dilemma zone, spike, late notice, factual inconsistency)
            let defenseAnalysis: Awaited<ReturnType<typeof analyzeRedLightDefense>> | null = null;
            try {
              const postedSpeed = matched.speed_limit_mph ?? 30; // Default to 30 mph (most Chicago camera intersections)
              // For late notice: use ticket created_at (when we first detected it on portal) as proxy for notice date
              const noticeDate = ticket?.created_at || null;
              const analysisInput: AnalysisInput = {
                trace,
                cameraLatitude: matched.camera_latitude || 0,
                cameraLongitude: matched.camera_longitude || 0,
                postedSpeedMph: postedSpeed,
                approachSpeedMph: matched.approach_speed_mph ?? null,
                minSpeedMph: matched.min_speed_mph ?? null,
                fullStopDetected: matched.full_stop_detected ?? false,
                fullStopDurationSec: matched.full_stop_duration_sec ?? null,
                speedDeltaMph: matched.speed_delta_mph ?? null,
                violationDatetime,
                deviceTimestamp: matched.device_timestamp,
                cameraAddress: matched.camera_address || matched.intersection_id || undefined,
                noticeDate,
                ticketPlate: ticket?.ticket_plate || null,
                ticketState: ticket?.ticket_state || null,
                userPlate: ticket?.plate || null,
                userState: ticket?.state || null,
              };
              defenseAnalysis = await analyzeRedLightDefense(analysisInput);
              console.log(`    Defense analysis: score=${defenseAnalysis.overallDefenseScore}, args=${defenseAnalysis.defenseArguments.length}`);
            } catch (defenseErr: any) {
              console.error(`    Defense analysis failed (non-fatal): ${defenseErr.message}`);
            }

            redLightEvidence = {
              cameraAddress: matched.camera_address || matched.intersection_id || 'Unknown',
              deviceTimestamp: matched.device_timestamp,
              approachSpeedMph: matched.approach_speed_mph ?? null,
              minSpeedMph: matched.min_speed_mph ?? null,
              speedDeltaMph: matched.speed_delta_mph ?? null,
              fullStopDetected: matched.full_stop_detected ?? false,
              fullStopDurationSec: matched.full_stop_duration_sec ?? null,
              gpsAccuracyMeters: matched.horizontal_accuracy_meters ?? null,
              tracePointCount: trace.length,
              traceDurationSec: traceDuration,
              speedProfile,
              accelSamples: accelTrace.length > 0 ? accelTrace.length : undefined,
              peakDecelG: peakDecelG > 0 ? peakDecelG : undefined,
              violationDatetime,
              timeDiffMinutes,
              evidenceHash,
              receiptId: matched.id,
              // Defense analysis results
              yellowLight: defenseAnalysis?.yellowLight ? {
                postedSpeedMph: defenseAnalysis.yellowLight.postedSpeedMph,
                iteRecommendedSec: defenseAnalysis.yellowLight.iteRecommendedSec,
                chicagoActualSec: defenseAnalysis.yellowLight.chicagoActualSec,
                shortfallSec: defenseAnalysis.yellowLight.shortfallSec,
                isShorterThanStandard: defenseAnalysis.yellowLight.isShorterThanStandard,
                explanation: defenseAnalysis.yellowLight.explanation,
                standardCitation: defenseAnalysis.yellowLight.standardCitation,
              } : undefined,
              rightTurn: defenseAnalysis?.rightTurn ? {
                rightTurnDetected: defenseAnalysis.rightTurn.rightTurnDetected,
                headingChangeDeg: defenseAnalysis.rightTurn.headingChangeDeg,
                stoppedBeforeTurn: defenseAnalysis.rightTurn.stoppedBeforeTurn,
                minSpeedBeforeTurnMph: defenseAnalysis.rightTurn.minSpeedBeforeTurnMph,
                isLegalRightOnRed: defenseAnalysis.rightTurn.isLegalRightOnRed,
                explanation: defenseAnalysis.rightTurn.explanation,
              } : undefined,
              geometry: defenseAnalysis?.geometry ? {
                approachDistanceMeters: defenseAnalysis.geometry.approachDistanceMeters,
                closestPointToCamera: defenseAnalysis.geometry.closestPointToCamera,
                averageApproachSpeedMph: defenseAnalysis.geometry.averageApproachSpeedMph,
                summary: defenseAnalysis.geometry.summary,
              } : undefined,
              weather: defenseAnalysis?.weather ? {
                hasAdverseConditions: defenseAnalysis.weather.hasAdverseConditions,
                temperatureF: defenseAnalysis.weather.temperatureF,
                visibilityMiles: defenseAnalysis.weather.visibilityMiles,
                impairedVisibility: defenseAnalysis.weather.impairedVisibility,
                precipitationType: defenseAnalysis.weather.precipitationType,
                roadCondition: defenseAnalysis.weather.roadCondition,
                sunPosition: defenseAnalysis.weather.sunPosition,
                description: defenseAnalysis.weather.description,
                defenseArguments: defenseAnalysis.weather.defenseArguments,
                source: defenseAnalysis.weather.source,
              } : undefined,
              violationSpike: defenseAnalysis?.violationSpike ? {
                violationsOnDate: defenseAnalysis.violationSpike.violationsOnDate,
                averageDailyViolations: defenseAnalysis.violationSpike.averageDailyViolations,
                spikeRatio: defenseAnalysis.violationSpike.spikeRatio,
                isSpike: defenseAnalysis.violationSpike.isSpike,
                explanation: defenseAnalysis.violationSpike.explanation,
              } : undefined,
              dilemmaZone: defenseAnalysis?.dilemmaZone ? {
                inDilemmaZone: defenseAnalysis.dilemmaZone.inDilemmaZone,
                stoppingDistanceFt: defenseAnalysis.dilemmaZone.stoppingDistanceFt,
                distanceToStopBarFt: defenseAnalysis.dilemmaZone.distanceToStopBarFt,
                distanceToClearFt: defenseAnalysis.dilemmaZone.distanceToClearFt,
                canStop: defenseAnalysis.dilemmaZone.canStop,
                canClear: defenseAnalysis.dilemmaZone.canClear,
                explanation: defenseAnalysis.dilemmaZone.explanation,
              } : undefined,
              lateNotice: defenseAnalysis?.lateNotice ? {
                daysBetween: defenseAnalysis.lateNotice.daysBetween,
                exceeds90Days: defenseAnalysis.lateNotice.exceeds90Days,
                explanation: defenseAnalysis.lateNotice.explanation,
              } : undefined,
              factualInconsistency: defenseAnalysis?.factualInconsistency ? {
                hasInconsistency: defenseAnalysis.factualInconsistency.hasInconsistency,
                inconsistencyType: defenseAnalysis.factualInconsistency.inconsistencyType,
                explanation: defenseAnalysis.factualInconsistency.explanation,
              } : undefined,
              defenseScore: defenseAnalysis?.overallDefenseScore,
              defenseArguments: defenseAnalysis?.defenseArguments.map(a => ({
                type: a.type,
                strength: a.strength,
                title: a.title,
                summary: a.summary,
              })),
            };

            console.log(`    Found red-light receipt ${matched.id} — full_stop=${matched.full_stop_detected}, ${trace.length} trace points`);
          }
        } catch (redLightErr: any) {
          console.error(`    Red-light receipt lookup failed: ${redLightErr.message}`);
        }
      }

      // Fetch FOIA responses received for this ticket so they can be rendered
      // as exhibits. The incoming-email webhook matches replies from the
      // City and writes to ticket_foia_requests; here we translate the row
      // shape into what formatLetterAsHTML expects.
      let foiaExhibits: import('../../../lib/lob-service').FoiaExhibit[] | undefined;
      try {
        const { data: foiaRows } = await supabaseAdmin
          .from('ticket_foia_requests')
          .select('request_type, status, requested_at, fulfilled_at, reference_id, response_payload, notes')
          .eq('ticket_id', letter.ticket_id);

        if (foiaRows && foiaRows.length > 0) {
          const mapped: import('../../../lib/lob-service').FoiaExhibit[] = [];
          for (const row of foiaRows as any[]) {
            const rt = String(row.request_type || '');
            // Decide agency label from request_type.
            let agency: 'finance' | 'cdot' | 'cpd' = 'finance';
            let agencyLabel = 'Chicago Department of Finance';
            if (rt.includes('cdot') || rt.includes('signal')) {
              agency = 'cdot';
              agencyLabel = 'Chicago Department of Transportation';
            } else if (rt.includes('cpd') || rt.includes('police')) {
              agency = 'cpd';
              agencyLabel = 'Chicago Police Department';
            }

            // Map status → responseType. "not_needed" and "queued" are
            // skipped because they aren't actionable exhibits.
            const st = String(row.status || '');
            let responseType: 'records_produced' | 'denial' | 'no_records' | 'overdue' | null = null;
            if (st === 'fulfilled' || st === 'received' || st === 'records_produced') responseType = 'records_produced';
            else if (st === 'denied' || st === 'exempt') responseType = 'denial';
            else if (st === 'no_records') responseType = 'no_records';
            else if (st === 'overdue') responseType = 'overdue';
            // Overdue-by-calendar fallback: if requested_at > 10 days ago
            // and still 'sent', count as overdue — statute is 5 business days.
            if (!responseType && (st === 'sent' || st === 'pending') && row.requested_at) {
              const ageDays = (Date.now() - new Date(row.requested_at).getTime()) / 86400000;
              if (ageDays > 10) responseType = 'overdue';
            }
            if (!responseType) continue;

            const payload = (row.response_payload || {}) as Record<string, any>;
            mapped.push({
              agency,
              agencyLabel,
              responseType,
              referenceId: row.reference_id || null,
              requestedAt: row.requested_at || null,
              receivedAt: row.fulfilled_at || null,
              attachmentCount: typeof payload.attachment_count === 'number' ? payload.attachment_count : (Array.isArray(payload.attachments) ? payload.attachments.length : undefined),
              summaryText: payload.summary_text || payload.response_text || row.notes || null,
              attachmentUrls: Array.isArray(payload.attachment_urls) ? payload.attachment_urls : undefined,
            });
          }
          if (mapped.length > 0) foiaExhibits = mapped;
        }
      } catch (foiaFetchErr: any) {
        console.error(`    FOIA exhibit fetch failed: ${foiaFetchErr.message}`);
      }

      const result = await mailLetter(
        letter as LetterToMail,
        profile as UserProfile,
        ticketNumber,
        evidenceImages,
        redLightEvidence,
        foiaExhibits
      );

      // Flag the letter so the admin dashboard + QA report reflect FOIA
      // usage. The webhook already sets these on receipt, but we set again
      // here in case a letter was regenerated after the FOIA arrived.
      if (foiaExhibits && foiaExhibits.length > 0) {
        const hasFinance = foiaExhibits.some(f => f.agency === 'finance');
        const hasCdot = foiaExhibits.some(f => f.agency === 'cdot');
        if (hasFinance || hasCdot) {
          await supabaseAdmin
            .from('contest_letters')
            .update({
              ...(hasFinance ? { finance_foia_integrated: true, finance_foia_integrated_at: new Date().toISOString() } : {}),
              ...(hasCdot ? { cdot_foia_integrated: true, cdot_foia_integrated_at: new Date().toISOString() } : {}),
            })
            .eq('id', letter.id);
        }
      }

      if (result.success) {
        if (result.skipped) {
          console.log(`    Skipped duplicate/contended mailing path for letter ${letter.id}`);
          continue;
        }

        lettersMailed++;

        // FOIA requests are now queued at ticket detection time (autopilot-check-plates)
        // so the 5-business-day deadline expires before the letter is even generated.
        // The upsert in detection uses onConflict, so no duplicate risk.

        if (!result.alreadyMailed) {
          // Send email notification to user only on a real new mail event.
          await sendLetterMailedNotification(
            letter.user_id,
            ticketNumber,
            result.expectedDelivery || null,
            result.pdfUrl || null
          );
        } else {
          console.log(`    Not sending mailed notification for ${letter.id} because Lob already had the letter`);
        }

        // Send admin notification with full letter content only for a real new mail event.
        if (!result.alreadyMailed && process.env.RESEND_API_KEY) {
          const letterText = (letter as any).letter_content || (letter as any).letter_text || 'No letter content available';
          const userName = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown';
          const ticket = (letter as any).detected_tickets;
          const violationType = ticket?.violation_type?.replace(/_/g, ' ')?.replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Unknown';
          const amount = ticket?.amount ? `$${parseFloat(ticket.amount).toFixed(2)}` : 'N/A';

          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: getAdminAlertEmails(),
                subject: `Contest Letter Mailed: ${ticketNumber} — ${violationType} (${userName})`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
                    <div style="background: #059669; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                      <h2 style="margin: 0;">Contest Letter Mailed</h2>
                    </div>
                    <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none;">
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr><td style="padding: 6px 0; color: #6b7280; width: 150px;">User:</td><td style="padding: 6px 0; font-weight: 600;">${userName}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 6px 0; font-weight: 600;">${ticketNumber}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Violation:</td><td style="padding: 6px 0;">${violationType} (${amount})</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Lob Letter ID:</td><td style="padding: 6px 0;">${result.lobId || 'N/A'}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Expected Delivery:</td><td style="padding: 6px 0;">${result.expectedDelivery || 'TBD'}</td></tr>
                        ${result.pdfUrl ? `<tr><td style="padding: 6px 0; color: #6b7280;">PDF Preview:</td><td style="padding: 6px 0;"><a href="${result.pdfUrl}" style="color: #2563eb;">View Letter PDF</a></td></tr>` : ''}
                        <tr><td style="padding: 6px 0; color: #6b7280;">Evidence Images:</td><td style="padding: 6px 0;">${evidenceImages.length > 0 ? `${evidenceImages.length} attached` : 'None'}</td></tr>
                      </table>
                      ${redLightEvidence ? `
                      <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                        <h3 style="color: #065f46; margin: 0 0 10px; font-size: 15px;">Red-Light Camera Evidence Included</h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                          <tr><td style="padding: 4px 0; color: #047857; width: 160px;">Camera:</td><td style="padding: 4px 0; font-weight: 600; color: #065f46;">${redLightEvidence.cameraAddress}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Full Stop Detected:</td><td style="padding: 4px 0; font-weight: 600; color: ${redLightEvidence.fullStopDetected ? '#065f46' : '#b45309'};">${redLightEvidence.fullStopDetected ? 'YES' + (redLightEvidence.fullStopDurationSec != null ? ` (${redLightEvidence.fullStopDurationSec.toFixed(1)}s)` : '') : 'No'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Approach Speed:</td><td style="padding: 4px 0;">${redLightEvidence.approachSpeedMph != null ? redLightEvidence.approachSpeedMph.toFixed(1) + ' mph' : 'N/A'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Minimum Speed:</td><td style="padding: 4px 0;">${redLightEvidence.minSpeedMph != null ? redLightEvidence.minSpeedMph.toFixed(1) + ' mph' : 'N/A'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">GPS Trace Points:</td><td style="padding: 4px 0;">${redLightEvidence.tracePointCount} over ${redLightEvidence.traceDurationSec.toFixed(0)}s</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Speed Profile:</td><td style="padding: 4px 0;">${redLightEvidence.speedProfile.length} readings in exhibit</td></tr>
                          ${redLightEvidence.accelSamples ? `<tr><td style="padding: 4px 0; color: #047857;">Accelerometer:</td><td style="padding: 4px 0;">${redLightEvidence.accelSamples} samples${redLightEvidence.peakDecelG ? ` (peak: ${redLightEvidence.peakDecelG.toFixed(3)} G)` : ''}</td></tr>` : ''}
                          ${redLightEvidence.violationDatetime ? `<tr><td style="padding: 4px 0; color: #047857;">Timestamp Match:</td><td style="padding: 4px 0;">${redLightEvidence.timeDiffMinutes != null && redLightEvidence.timeDiffMinutes < 5 ? 'STRONG' : redLightEvidence.timeDiffMinutes != null && redLightEvidence.timeDiffMinutes < 60 ? 'POSSIBLE' : 'WEAK'} (${redLightEvidence.timeDiffMinutes != null ? redLightEvidence.timeDiffMinutes.toFixed(1) + ' min diff' : 'N/A'})</td></tr>` : ''}
                          <tr><td style="padding: 4px 0; color: #047857;">Evidence Hash:</td><td style="padding: 4px 0; font-family: monospace; font-size: 11px; word-break: break-all;">${redLightEvidence.evidenceHash.substring(0, 16)}...${redLightEvidence.evidenceHash.substring(redLightEvidence.evidenceHash.length - 8)}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Receipt ID:</td><td style="padding: 4px 0; font-family: monospace; font-size: 11px;">${redLightEvidence.receiptId}</td></tr>
                          ${redLightEvidence.defenseScore !== undefined ? `<tr><td style="padding: 4px 0; color: #047857;">Defense Score:</td><td style="padding: 4px 0; font-weight: 600; color: ${redLightEvidence.defenseScore >= 60 ? '#065f46' : redLightEvidence.defenseScore >= 30 ? '#b45309' : '#991b1b'};">${redLightEvidence.defenseScore}/100</td></tr>` : ''}
                        </table>
                        ${redLightEvidence.defenseArguments && redLightEvidence.defenseArguments.length > 0 ? `
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #a7f3d0;">
                          <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #065f46;">Defense Arguments:</p>
                          ${redLightEvidence.defenseArguments.map(a => `<div style="font-size: 12px; padding: 2px 0; color: #065f46;"><span style="display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; color: white; background: ${a.strength === 'strong' ? '#059669' : a.strength === 'moderate' ? '#d97706' : '#6b7280'}; margin-right: 6px;">${a.strength.toUpperCase()}</span>${a.title}: ${a.summary}</div>`).join('')}
                        </div>
                        ` : ''}
                        ${redLightEvidence.yellowLight?.isShorterThanStandard ? `
                        <div style="margin-top: 8px; padding: 8px; background: #fff7ed; border: 1px solid #f97316; border-radius: 4px; font-size: 12px; color: #9a3412;">
                          <strong>Yellow Light:</strong> Chicago ${redLightEvidence.yellowLight.chicagoActualSec}s vs ITE ${redLightEvidence.yellowLight.iteRecommendedSec}s (${redLightEvidence.yellowLight.shortfallSec.toFixed(1)}s short)
                        </div>` : ''}
                        ${redLightEvidence.rightTurn?.isLegalRightOnRed ? `
                        <div style="margin-top: 8px; padding: 8px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 4px; font-size: 12px; color: #065f46;">
                          <strong>Right Turn:</strong> Legal right-on-red detected (${redLightEvidence.rightTurn.headingChangeDeg.toFixed(0)}° turn after stop)
                        </div>` : ''}
                        ${redLightEvidence.weather?.hasAdverseConditions ? `
                        <div style="margin-top: 8px; padding: 8px; background: #eff6ff; border: 1px solid #3b82f6; border-radius: 4px; font-size: 12px; color: #1e40af;">
                          <strong>Weather:</strong> ${redLightEvidence.weather.description}${redLightEvidence.weather.roadCondition ? ` — ${redLightEvidence.weather.roadCondition}` : ''}
                        </div>` : ''}
                      </div>
                      ` : ''}
                      <hr style="border: none; border-top: 2px solid #e5e7eb; margin: 20px 0;">
                      <h3 style="color: #374151; margin: 0 0 12px;">Full Letter Content</h3>
                      <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; border-radius: 6px; white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: #1f2937;">${letterText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    </div>
                    <div style="padding: 12px 24px; background: #f3f4f6; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                      <p style="color: #6b7280; font-size: 12px; margin: 0;">This letter has been sent to the City of Chicago via Lob.com. The user has also been notified.</p>
                    </div>
                  </div>
                `,
              }),
            });
          } catch (adminErr: any) {
            console.error(`    Admin letter notification failed: ${adminErr.message}`);
          }
        }

        if (!result.alreadyMailed) {
          // Increment letter count only for a real new mail event.
          const { exceeded, count } = await incrementLetterCount(letter.user_id);
          if (exceeded) {
            console.log(`    User has used ${count} letters (exceeded included amount)`);
            // TODO: Charge for additional letter via Stripe
          }
        } else {
          console.log(`    Not incrementing letter count for ${letter.id} because the letter had already been mailed`);
        }
      } else {
        errors++;
        // Update letter status so failures are visible (not silently retried)
        await supabaseAdmin
          .from('contest_letters')
          .update({
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_reason: result.error || 'Lob API call failed',
          })
          .eq('id', letter.id);
        // Notify admin of the failure
        if (process.env.RESEND_API_KEY) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: getAdminAlertEmails(),
                subject: `Letter Mailing FAILED: ${ticketNumber} (Letter ${letter.id})`,
                html: `<p>Letter ${letter.id} for ticket ${ticketNumber} failed to mail.</p><p>Error: ${result.error || 'Unknown'}</p><p>User: ${letter.user_id}</p>`,
              }),
            });
          } catch (notifyErr: any) {
            console.error(`    Admin failure notification failed: ${notifyErr.message}`);
          }
        }
      }

      // Rate limit: 1 second between API calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const totalElapsedMs = Date.now() - cronStartTime;
    const budgetUsedPct = Math.round((totalElapsedMs / CRON_MAX_MS) * 100);
    console.log(
      `✅ Complete: ${lettersMailed} mailed, ${errors} errors, ${lettersSkippedDueToTimeout} skipped-timeout. ` +
      `Budget: ${Math.round(totalElapsedMs / 1000)}s / ${CRON_MAX_MS / 1000}s (${budgetUsedPct}%).` +
      (timedOutBeforeCompletion ? ' ⚠️ TIMEOUT PRESSURE' : '')
    );

    // Alert admin if we're consistently saturating the budget — otherwise
    // letters stay in the queue longer each day and eventually users see
    // weeks-old unmailed letters.
    if (timedOutBeforeCompletion && lettersSkippedDueToTimeout >= 3 && process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: getAdminAlertEmails(),
            subject: `⚠️ Contest mail cron budget saturated — ${lettersSkippedDueToTimeout} letters skipped`,
            html: `
              <p>The contest mail cron hit its ${CRON_MAX_MS / 1000}s timeout with <strong>${lettersSkippedDueToTimeout} letters still in queue</strong>.</p>
              <p>Stats: ${lettersMailed} mailed, ${errors} errors, ${budgetUsedPct}% of budget used before cutoff.</p>
              <p>If this persists, queue depth will grow. Options:</p>
              <ul>
                <li>Increase <code>maxDuration</code> in the cron config (currently 120s)</li>
                <li>Reduce the per-letter Lob rate-limit sleep (currently 1s between calls)</li>
                <li>Run the cron more frequently (currently daily)</li>
                <li>Batch-ify letter generation further upstream</li>
              </ul>
            `,
          }),
        });
      } catch {}
    }

    return res.status(200).json({
      success: true,
      lettersMailed,
      errors,
      lettersSkippedDueToTimeout,
      timedOutBeforeCompletion,
      budgetUsedMs: totalElapsedMs,
      budgetMaxMs: CRON_MAX_MS,
      budgetUsedPct,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Letter mailing error:', error);
    // Forward to Sentry — otherwise top-level cron failures are only
    // visible in Vercel logs, which nobody reads reactively.
    Sentry.captureException(error, { tags: { cron: 'autopilot-mail-letters' } });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  maxDuration: 120, // 2 minutes max
};

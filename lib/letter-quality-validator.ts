import { formatViolationDate } from './contest-letter-date';

/**
 * Validate letter has no unfilled placeholders or quality issues.
 * Returns { pass: true } or { pass: false, issues: string[] }
 *
 * This is the first-pass "cheap" validation (no AI call). It catches
 * obvious structural problems before the more expensive AI review runs.
 *
 * Lives in its own file (no Supabase / Resend / Anthropic imports) so the
 * smoke test in lib/contest-pipeline-smoke.ts can import it without
 * triggering eager Supabase client initialization at module load.
 */
export function validateLetterContent(
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
  const mustachePlaceholders = letterContent.match(/\{\{[A-Z][A-Z0-9_]+\}\}/g);
  if (mustachePlaceholders && mustachePlaceholders.length > 0) {
    issues.push(`Unfilled mustache placeholders: ${[...new Set(mustachePlaceholders)].join(', ')}`);
  }
  const anglePlaceholders = letterContent.match(/<([A-Z][A-Z0-9_]{2,})>/g);
  if (anglePlaceholders && anglePlaceholders.length > 0) {
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
  if (!/\bRE:/i.test(letterContent) && !/\bRe:/i.test(letterContent)) {
    issues.push('Missing RE: line (required for contest letters)');
  }
  if (!/\b(sincerely|respectfully|regards|thank you)/i.test(letterContent)) {
    issues.push('Missing formal closing (Sincerely, Respectfully, etc.)');
  }
  if (!/\b(department of finance|city of chicago|hearing officer)/i.test(letterContent)) {
    issues.push('Letter does not reference the Department of Finance or City of Chicago');
  }

  // ── 5b. Mail-in safety check — no in-person hearing language ──
  const hearingRequestPatterns: { regex: RegExp; label: string }[] = [
    { regex: /\brequest(?:ing|ed)?\s+(?:a|an|my|the)?\s*hearing\b/i, label: '"request a hearing"' },
    { regex: /\bschedul(?:e|ing|ed)\s+(?:a|an|my|the)?\s*hearing\b/i, label: '"schedule a hearing"' },
    { regex: /\b(?:appear|attend|attendance)\s+(?:in\s+person|at\s+(?:a|an|my|the)\s+hearing)\b/i, label: 'request to appear/attend in person' },
    { regex: /\blook\s+forward\s+to\s+(?:my|the|a|an)?\s*hearing\b/i, label: '"look forward to my hearing"' },
    { regex: /\bat\s+(?:my|the)\s+hearing\b/i, label: '"at my/the hearing"' },
    { regex: /\bduring\s+(?:my|the)\s+hearing\b/i, label: '"during my/the hearing"' },
    { regex: /\bwhen\s+I\s+appear\b/i, label: '"when I appear"' },
    { regex: /\bin\s+court\b/i, label: '"in court"' },
    { regex: /\bhearing\s+date\b/i, label: '"hearing date"' },
  ];
  for (const { regex, label } of hearingRequestPatterns) {
    if (regex.test(letterContent)) {
      issues.push(`Letter contains in-person hearing language (${label}) — mail-in contest must request a written determination, not a hearing`);
    }
  }

  // ── 6. Date consistency ──
  // Use the same UTC-anchored formatter the prompt and the contest-kit
  // templates use. Anything else introduces the off-by-one timezone drift
  // that bit Jesse's first letter ("April 14" vs "April 15").
  if (ticketData.violation_date) {
    const correctDateStr = formatViolationDate(ticketData.violation_date);
    const dateInLetter = letterContent.match(/Violation Date:\s*(\w+ \d{1,2}, \d{4})/);
    if (dateInLetter && dateInLetter[1] !== correctDateStr) {
      issues.push(`Date mismatch: letter says "${dateInLetter[1]}" but ticket date is "${correctDateStr}"`);
    }
  }

  // ── 7. Defense-violation coherence (basic check) ──
  const descLower = (ticketData.violation_description || '').toLowerCase();
  const contentLower = letterContent.toLowerCase();
  if ((descLower.includes('prohibited') || descLower.includes('tow zone') || descLower.includes('no parking anytime')) &&
      (contentLower.includes('outside restricted hours') || contentLower.includes('outside the posted hours') || contentLower.includes('meter had not expired'))) {
    issues.push('Defense mismatch: "outside restricted hours" argument used for an anytime-prohibited violation');
  }
  if (descLower.includes('expired') && descLower.includes('meter') && contentLower.includes('no signs posted')) {
    issues.push('Defense mismatch: "no signs posted" argument used for an expired meter violation');
  }

  // ── 8. Suspicious content ──
  if (contentLower.includes('as an ai') || contentLower.includes('language model') || contentLower.includes('i cannot')) {
    issues.push('Letter contains AI self-reference ("as an AI", "language model", etc.)');
  }

  // ── 9. User-evidence-text integration check ──
  if (ticketData.user_evidence_text && ticketData.user_evidence_text.trim()) {
    const cleaned = ticketData.user_evidence_text
      .replace(/^>.*$/gm, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/On\s+\w+,\s+\w+\s+\d+,\s+\d{4}\s+at\s+\d+:\d+[^\n]*wrote:[\s\S]*$/, '')
      .toLowerCase();

    const STOP = new Set([
      'actually','attachment','email','reply','thanks','please','sincerely','regards',
      'hello','there','that','this','have','would','could','should','where','which',
      'about','after','before','cannot','check','linkedin','twitter','facebook',
      'yahoo','gmail','hotmail','phone','cell','https','http',
    ]);
    const words = (cleaned.match(/\b[a-z]{5,}\b/g) || []).filter(w => !STOP.has(w));
    const unique = Array.from(new Set(words)).slice(0, 6);
    if (unique.length >= 2) {
      const hits = unique.filter(w => contentLower.includes(w));
      if (hits.length === 0) {
        issues.push(`Letter does not reference any content from the user's written statement (checked: ${unique.join(', ')})`);
      }
    }
  }

  return { pass: issues.length === 0, issues };
}

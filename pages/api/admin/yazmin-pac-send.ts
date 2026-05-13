/**
 * One-shot: route Yazmin's denial through the existing PAC-appeal system
 * (which the conversation didn't realize existed until after the static
 * draft was written). What this does:
 *
 *   1. Flip yazminmh1@gmail.com's foia_history_requests row from
 *      status='fulfilled' to 'fulfilled_denial' (this row predates the
 *      classifier that now sets that status automatically).
 *   2. Call draftHistoryFoiaAppeal — Gemini drafts a custom 5 ILCS 140/9.5
 *      Request for Review, persisted to foia_history_appeals.
 *   3. Email Randy the draft + signed magic-link "Send to PAC" button (same
 *      shape the daily admin digest uses, so this is the canonical send path).
 *   4. Email Yazmin the correction about her FOIA being denied (not "clean").
 *
 * Auth: CRON_SECRET bearer — so we can trigger from terminal with the same
 * key the cron jobs use. The regular admin endpoints want a Supabase session
 * which we don't have from a curl call.
 *
 * Created 2026-05-13 — safe to delete once both emails are confirmed sent.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { draftHistoryFoiaAppeal, signAppealLink, PAC_EMAIL } from '../../../lib/foia-appeal-drafter';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YAZMIN_HTML = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.65;color:#111;max-width:640px;padding:24px">
  <p>Hi Yazmin,</p>
  <p>Quick correction on the FOIA results email we sent you yesterday.</p>
  <p>Our system told you the City of Chicago found a "clean record" for plate VA TPA4460. That's not actually what happened.</p>
  <p><strong>What actually happened:</strong> Chicago's Department of Finance received our FOIA but <strong>declined to release the records</strong>, citing the Illinois FOIA private-information exemption (5 ILCS 140/7(1)(b)). They do this routinely for out-of-state plates when a third party (us) is the requester.</p>
  <p><strong>What we're doing about it:</strong> We're filing a Request for Review with the Illinois Attorney General's Public Access Counselor under 5 ILCS 140/9.5, challenging the denial. The PAC can order the City to release records when an exemption is misapplied. We'll let you know what they decide — these reviews typically take a few weeks.</p>
  <p><strong>If you want your records faster:</strong> You can also re-file the FOIA directly as the registered owner from your Virginia address with a copy of your VA title or registration, addressed to <a href="mailto:DOFfoia@cityofchicago.org">DOFfoia@cityofchicago.org</a>. The City usually releases when the requester is also the owner. (We can't do this on your behalf because they want to see proof of ownership tied to the requester.)</p>
  <p>System is updated so this doesn't happen to the next person.</p>
  <p>— Randy, Autopilot America</p>
</div>`;

async function sendEmail(params: { to: string; subject: string; html: string; replyTo?: string }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [params.to],
      subject: params.subject,
      html: params.html,
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'Server misconfiguration' });
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 1) Locate Yazmin's row and flip status ──
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, name, email, license_plate, license_state, reference_id, created_at, status, response_data')
    .eq('email', 'yazminmh1@gmail.com')
    .maybeSingle();

  if (fetchErr || !row) {
    return res.status(404).json({ error: 'Yazmin row not found', detail: fetchErr?.message });
  }

  // Flip status if not already fulfilled_denial. This is what would have
  // happened automatically if her denial had arrived after the classifier
  // shipped — we're catching her up.
  if (row.status !== 'fulfilled_denial') {
    await supabaseAdmin
      .from('foia_history_requests')
      .update({
        status: 'fulfilled_denial',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', row.id);
  }

  // ── 2) Draft the appeal via the canonical Gemini drafter ──
  const denialBody = (row.response_data as any)?.body_preview || '';
  const denialFrom = (row.response_data as any)?.from || 'chicagoil@govqa.us';
  const denialReceivedAt = (row.response_data as any)?.received_at || new Date().toISOString();

  let draft: { appealId: string; draftSubject: string; draftBody: string } | null = null;
  try {
    draft = await draftHistoryFoiaAppeal(supabaseAdmin as any, {
      historyRequest: {
        id: row.id,
        license_state: row.license_state,
        license_plate: row.license_plate,
        name: row.name,
        email: row.email,
        reference_id: row.reference_id,
        created_at: row.created_at,
      },
      denialBody,
      denialFrom,
      denialReceivedAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: `draftHistoryFoiaAppeal failed: ${err.message}` });
  }

  if (!draft) {
    return res.status(500).json({ error: 'Drafter returned null (GEMINI_API_KEY?)' });
  }

  // ── 3) Email Randy with the draft + magic-link Send button ──
  const sendQs = signAppealLink(draft.appealId, 'send');
  const regenQs = signAppealLink(draft.appealId, 'regenerate');
  const sendUrl = `https://www.autopilotamerica.com/api/foia-appeals/send?${sendQs}`;
  const regenUrl = `https://www.autopilotamerica.com/api/foia-appeals/send?${regenQs}`;

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const adminHtml = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#111;max-width:780px">
    <h2 style="margin:0 0 12px;font-size:18px">PAC appeal ready to send — Yazmin McZorn-Hines (VA TPA4460)</h2>
    <p>The denial of Yazmin's history FOIA has been routed through the canonical appeal drafter. The draft is persisted in <code>foia_history_appeals</code> (appeal id <code>${draft.appealId}</code>) and will continue to surface in the daily digest until you click <em>Send to PAC</em>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0">
      <tr>
        <td style="padding-right:10px">
          <a href="${sendUrl}" style="display:inline-block;padding:10px 18px;background:#10B981;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Send to PAC →</a>
        </td>
        <td>
          <a href="${regenUrl}" style="display:inline-block;padding:10px 18px;background:#fff;color:#0F172A;text-decoration:none;border:1px solid #cbd5e1;border-radius:6px;font-weight:600">Regenerate draft</a>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:#475569">Send button delivers to <code>${PAC_EMAIL}</code> with the requester (<code>${row.email}</code>) on cc. Links are HMAC-signed with the same secret the cron uses; expire in 14 days.</p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #ddd"/>
    <h3 style="margin:0 0 8px;font-size:15px">Draft subject</h3>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0;margin:0 0 14px">${escHtml(draft.draftSubject)}</pre>
    <h3 style="margin:0 0 8px;font-size:15px">Draft body</h3>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:#f8fafc;padding:14px;border-radius:6px;border:1px solid #e2e8f0;margin:0">${escHtml(draft.draftBody)}</pre>
  </div>`;

  const pacRes = await sendEmail({
    to: 'randyvollrath@gmail.com',
    subject: `[PAC Appeal Ready] Yazmin McZorn-Hines — VA TPA4460 — one-click Send below`,
    html: adminHtml,
  });

  // ── 4) Email Yazmin her correction ──
  const yazRes = await sendEmail({
    to: 'yazminmh1@gmail.com',
    subject: 'Quick correction on your Chicago FOIA — VA TPA4460',
    html: YAZMIN_HTML,
    replyTo: 'randyvollrath@gmail.com',
  });

  return res.status(200).json({
    appealId: draft.appealId,
    pacDraftEmail: { ok: pacRes.ok, status: pacRes.status, body: pacRes.body.slice(0, 200) },
    yazminCorrectionEmail: { ok: yazRes.ok, status: yazRes.status, body: yazRes.body.slice(0, 200) },
  });
}

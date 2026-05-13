/**
 * Magic-link "Send appeal" endpoint.
 *
 * GET /api/foia-appeals/send?id=...&action=send&exp=...&sig=...
 *
 * Verifies the HMAC, then either:
 *   - action=send → emails the draft to public.access@atg.state.il.us and flips
 *     the appeal to status='sent'.
 *   - action=regenerate → re-runs the drafter against the original denial body
 *     and returns the admin to a confirmation page showing the new draft.
 *
 * Possession of a valid signed link is sufficient authorization. The link is
 * only ever sent to the admin email; the trust boundary is "anyone reading the
 * admin inbox can fire an appeal."
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyAppealLink, draftHistoryFoiaAppeal, PAC_EMAIL } from '../../../lib/foia-appeal-drafter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database unavailable' });

  const { id, action, exp, sig } = req.query;
  if (typeof id !== 'string' || typeof action !== 'string' || typeof exp !== 'string' || typeof sig !== 'string') {
    return res.status(400).send(renderError('Missing or malformed link parameters.'));
  }
  if (action !== 'send' && action !== 'regenerate') {
    return res.status(400).send(renderError(`Unsupported action: ${action}`));
  }

  const verification = verifyAppealLink(id, action, exp, sig);
  if (!verification.ok) {
    const reason = 'reason' in verification ? verification.reason : 'invalid';
    return res.status(401).send(renderError(`Invalid or expired link (${reason}).`));
  }

  // Load appeal + linked history request. Cast to any — the generated Supabase
  // types haven't been regenerated since the foia_history_appeals migration.
  const { data: appealRaw, error: appealErr } = await (supabaseAdmin as any)
    .from('foia_history_appeals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  const appeal = appealRaw as any;

  if (appealErr || !appeal) {
    return res.status(404).send(renderError('Appeal not found.'));
  }

  if (action === 'send') {
    if (appeal.status !== 'draft') {
      return res.status(200).send(renderInfo(
        'This appeal has already been sent.',
        `Status: ${appeal.status}. Sent at: ${appeal.sent_at ?? 'unknown'}.`,
      ));
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).send(renderError('RESEND_API_KEY not configured.'));
    }

    try {
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Autopilot America FOIA <foia@autopilotamerica.com>',
          to: [PAC_EMAIL],
          subject: appeal.draft_subject,
          text: appeal.draft_body,
          reply_to: ['foia@autopilotamerica.com'],
          headers: {
            'X-Entity-Ref-ID': `pac-appeal-${appeal.id}`,
          },
        }),
      });

      if (!emailResp.ok) {
        const errText = await emailResp.text();
        console.error('[foia-appeals/send] Resend error:', errText);
        return res.status(502).send(renderError(`Send failed: ${errText.substring(0, 300)}`));
      }

      const emailJson = await emailResp.json().catch(() => ({}));

      await (supabaseAdmin as any)
        .from('foia_history_appeals')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_to: PAC_EMAIL,
          sent_email_id: emailJson?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appeal.id);

      return res.status(200).send(renderSuccess(
        'PAC appeal sent.',
        `Sent to ${PAC_EMAIL}. Resend id: ${emailJson?.id ?? 'unknown'}. The PAC will assign a case number and respond within 60 days.`,
      ));
    } catch (e: any) {
      console.error('[foia-appeals/send] send threw:', e);
      return res.status(500).send(renderError(`Send threw: ${e?.message ?? String(e)}`));
    }
  }

  // action === 'regenerate'
  const { data: historyReqRaw, error: hrErr } = await (supabaseAdmin as any)
    .from('foia_history_requests')
    .select('*')
    .eq('id', appeal.history_request_id)
    .maybeSingle();
  const historyReq = historyReqRaw as any;

  if (hrErr || !historyReq) {
    return res.status(404).send(renderError('Linked history request not found.'));
  }

  const denialBody = historyReq.response_data?.body_preview || appeal.raw_denial_excerpt || '';
  const denialFrom = historyReq.response_data?.from || 'chicagoil@govqa.us';
  const denialReceivedAt = historyReq.response_received_at || new Date().toISOString();

  const result = await draftHistoryFoiaAppeal(supabaseAdmin as any, {
    historyRequest: {
      id: historyReq.id,
      license_state: historyReq.license_state,
      license_plate: historyReq.license_plate,
      name: historyReq.name,
      email: historyReq.email,
      reference_id: historyReq.reference_id,
      created_at: historyReq.created_at,
    },
    denialBody,
    denialFrom,
    denialReceivedAt,
  });

  if (!result) {
    return res.status(500).send(renderError('Regeneration failed (drafter returned null). Check server logs.'));
  }

  return res.status(200).send(renderSuccess(
    'Draft regenerated.',
    `New subject: ${result.draftSubject}\n\nThe next daily digest will include the refreshed draft. To send the new version, wait for tomorrow's email or hit the previous Send link (still valid).`,
  ));
}

// ─── HTML response helpers (no template engine — keep it simple) ──

function renderError(msg: string): string {
  return wrap('Error', `<p style="color:#b91c1c;">${escape(msg)}</p>`);
}
function renderInfo(title: string, body: string): string {
  return wrap(title, `<p>${escape(body)}</p>`);
}
function renderSuccess(title: string, body: string): string {
  return wrap(title, `<p style="color:#15803d;">${escape(body).replace(/\n/g, '<br>')}</p>`);
}
function wrap(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)} — FOIA Appeal</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:24px;color:#111827}h1{font-size:20px;margin:0 0 16px}p{line-height:1.55}</style>
</head><body><h1>${escape(title)}</h1>${inner}<p style="margin-top:32px;color:#6b7280;font-size:13px">Autopilot America — FOIA appeals</p></body></html>`;
}
function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

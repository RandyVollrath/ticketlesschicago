import { Resend } from 'resend';
import { supabaseAdmin } from './supabase';

const resend = new Resend(process.env.RESEND_API_KEY);

type WelcomeSource = 'stripe' | 'ios_iap' | 'android_iap' | 'manual';

export interface WelcomeEmailParams {
  userId: string;
  email: string;
  firstName?: string | null;
  planLabel?: string | null;
  magicLink?: string | null;
  source: WelcomeSource;
}

export interface WelcomeEmailResult {
  sent: boolean;
  reason?: string;
  resendId?: string;
}

export async function sendWelcomeEmailOnce(params: WelcomeEmailParams): Promise<WelcomeEmailResult> {
  const { userId, email, firstName, planLabel, magicLink, source } = params;

  if (!email) return { sent: false, reason: 'no_email' };

  // Idempotency check — skip if already sent. Graceful if column doesn't exist yet.
  try {
    const { data, error } = await (supabaseAdmin
      .from('user_profiles')
      .select('welcome_email_sent_at')
      .eq('user_id', userId)
      .maybeSingle() as any);

    if (!error && data?.welcome_email_sent_at) {
      return { sent: false, reason: 'already_sent' };
    }
  } catch (e) {
    console.warn('[welcome-email] idempotency check failed, proceeding:', e);
  }

  const displayName = (firstName && firstName.trim()) || 'there';
  const subject = 'Welcome to Autopilot America — your ticket protection is live';

  try {
    const result = await resend.emails.send({
      from: 'Autopilot America <hello@autopilotamerica.com>',
      to: email,
      subject,
      html: renderWelcomeHtml({ displayName, planLabel, magicLink, source }),
      text: renderWelcomeText({ displayName, planLabel, magicLink, source }),
    });

    // Mark as sent. Silent failure if column doesn't exist yet.
    try {
      await (supabaseAdmin
        .from('user_profiles')
        .update({ welcome_email_sent_at: new Date().toISOString() } as any)
        .eq('user_id', userId) as any);
    } catch (e) {
      console.warn('[welcome-email] could not persist welcome_email_sent_at:', e);
    }

    console.log(`[welcome-email] sent to ${email} (source=${source}) id=${result.data?.id}`);
    return { sent: true, resendId: result.data?.id };
  } catch (err: any) {
    console.error('[welcome-email] send failed:', err?.message || err);
    return { sent: false, reason: `send_failed: ${err?.message || 'unknown'}` };
  }
}

function renderWelcomeHtml({
  displayName,
  planLabel,
  magicLink,
  source,
}: {
  displayName: string;
  planLabel?: string | null;
  magicLink?: string | null;
  source: WelcomeSource;
}): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com';
  const planLine = planLabel ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;">Plan: <strong>${escapeHtml(planLabel)}</strong></p>` : '';

  const ctaBlock = magicLink
    ? `
      <div style="text-align:center;margin:32px 0;">
        <a href="${magicLink}" style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;display:inline-block;box-shadow:0 4px 6px rgba(37,99,235,0.3);">
          Sign in and finish setup
        </a>
        <p style="color:#6b7280;font-size:12px;margin-top:12px;">This sign-in link expires in 60 minutes.</p>
      </div>`
    : `
      <div style="text-align:center;margin:32px 0;">
        <a href="${siteUrl}/settings" style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;display:inline-block;box-shadow:0 4px 6px rgba(37,99,235,0.3);">
          Go to your dashboard
        </a>
      </div>`;

  const backgroundTip = source === 'stripe'
    ? `
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px 20px;margin:24px 0;">
        <h3 style="color:#92400e;margin:0 0 8px;font-size:15px;">If you use our mobile app — enable background location</h3>
        <p style="color:#78350f;font-size:14px;margin:0 0 8px;line-height:1.6;">
          Automatic parking detection (the thing that remembers where you parked and warns you before street cleaning at that spot) only works when the Autopilot America app is allowed to run in the background.
        </p>
        <ul style="color:#78350f;font-size:14px;margin:0;padding-left:20px;line-height:1.7;">
          <li><strong>iPhone:</strong> Settings → Autopilot America → Location → <strong>Always</strong>; Background App Refresh → <strong>On</strong></li>
          <li><strong>Android:</strong> Settings → Apps → Autopilot America → Battery → <strong>Unrestricted</strong>; Location → <strong>Allow all the time</strong></li>
        </ul>
      </div>`
    : `
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px 20px;margin:24px 0;">
        <h3 style="color:#92400e;margin:0 0 8px;font-size:15px;">Keep the app running in the background</h3>
        <p style="color:#78350f;font-size:14px;margin:0 0 8px;line-height:1.6;">
          Automatic parking detection only works while the app can run in the background. A quick check:
        </p>
        <ul style="color:#78350f;font-size:14px;margin:0;padding-left:20px;line-height:1.7;">
          <li><strong>iPhone:</strong> Settings → Autopilot America → Location → <strong>Always</strong>; Background App Refresh → <strong>On</strong></li>
          <li><strong>Android:</strong> Settings → Apps → Autopilot America → Battery → <strong>Unrestricted</strong>; Location → <strong>Allow all the time</strong></li>
        </ul>
      </div>`;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">Welcome to Autopilot America</h1>
        <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:16px;">Your ticket protection is active, ${escapeHtml(displayName)}.</p>
      </div>

      <div style="padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
        ${planLine}
        <p style="color:#374151;font-size:16px;line-height:1.6;margin-top:0;">
          Thanks for signing up. Starting today, here's what we're doing for you, automatically:
        </p>

        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:20px;margin:24px 0;">
          <ul style="margin:0;padding-left:20px;color:#0c4a6e;line-height:1.8;">
            <li><strong>Daily ticket monitoring</strong> — we check the City of Chicago portal for any new tickets on your plate</li>
            <li><strong>Mail-in contest letters</strong> — when a ticket shows up inside the 21-day window, we draft and mail a contest letter from your address</li>
            <li><strong>Outcome tracking</strong> — we follow up on dockets and notify you of results</li>
            <li><strong>Street cleaning reminders</strong> — for your saved home address, so you don't get a new ticket in the first place</li>
          </ul>
        </div>

        <h3 style="color:#1a1a1a;margin:28px 0 12px;font-size:18px;">Two things that help us help you</h3>
        <div style="margin:0 0 12px;">
          <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
            <div style="background:#2563eb;color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;margin-right:12px;">1</div>
            <div>
              <strong style="color:#1a1a1a;">Make sure your license plate is correct</strong>
              <p style="color:#6b7280;font-size:14px;margin:4px 0 0;">That's what we watch the City portal for.</p>
            </div>
          </div>
          <div style="display:flex;align-items:flex-start;">
            <div style="background:#2563eb;color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;margin-right:12px;">2</div>
            <div>
              <strong style="color:#1a1a1a;">Confirm your mailing address</strong>
              <p style="color:#6b7280;font-size:14px;margin:4px 0 0;">Contest letters are mailed from your address to City Hall — it has to match the plate.</p>
            </div>
          </div>
        </div>

        ${backgroundTip}

        ${ctaBlock}

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin-top:24px;">
          <h3 style="color:#9a3412;margin:0 0 8px;font-size:15px;">A quick note on timing</h3>
          <p style="color:#9a3412;font-size:14px;margin:0;line-height:1.6;">
            Chicago only allows contest-by-mail within <strong>21 days</strong> of the violation date. Tickets issued before you signed up may already be past that window — we catch those cases and won't mail a letter that can't be heard. For any new ticket going forward, we're watching.
          </p>
        </div>

        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-top:24px;">
          <p style="color:#6b7280;font-size:14px;margin:0;text-align:center;">
            Questions or something looks off? Just reply to this email — it reaches a real person.
          </p>
        </div>

        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:24px 0 0;">
          Autopilot America · autopilotamerica.com
        </p>
      </div>
    </div>
  `;
}

function renderWelcomeText({
  displayName,
  planLabel,
  magicLink,
  source,
}: {
  displayName: string;
  planLabel?: string | null;
  magicLink?: string | null;
  source: WelcomeSource;
}): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com';
  const planLine = planLabel ? `Plan: ${planLabel}\n\n` : '';
  const ctaLine = magicLink
    ? `Sign in and finish setup (expires in 60 min):\n${magicLink}\n\n`
    : `Your dashboard:\n${siteUrl}/settings\n\n`;

  return `Welcome to Autopilot America, ${displayName}.

${planLine}Your ticket protection is active. Starting today we're watching the City of Chicago portal every day for any new tickets on your plate, and when one shows up within the 21-day contest window we'll draft and mail a contest letter from your address. We'll also track the outcome and send street-cleaning reminders for your home address.

Two things that help us help you:
1. Make sure your license plate is correct — that's what we watch the portal for.
2. Confirm your mailing address — contest letters mail from your address to City Hall.

${source === 'stripe' ? 'If you use our mobile app: ' : ''}Please keep the app running in the background so parking detection works.
- iPhone: Settings → Autopilot America → Location → Always; Background App Refresh → On
- Android: Settings → Apps → Autopilot America → Battery → Unrestricted; Location → Allow all the time

${ctaLine}A note on timing: Chicago only allows contest-by-mail within 21 days of the violation date. Tickets from before you signed up may be past that window — we'll flag those and won't mail a letter that can't be heard.

Questions? Just reply to this email.

— Autopilot America
${siteUrl}
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { ensureAutopilotEnrollment } from '../../../lib/autopilot-enrollment';
import { createRewardfulAffiliate } from '../../../lib/rewardful-helper';
import {
  checkRateLimit,
  recordRateLimitAction,
  getClientIP,
} from '../../../lib/rate-limiter';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function loadAccessCodes(): Set<string> {
  const raw = process.env.PARTNER_ACCESS_CODES || '';
  return new Set(
    raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

function isValidAccessCode(code: string): boolean {
  const codes = loadAccessCodes();
  if (codes.size === 0) return false;
  return codes.has((code || '').trim().toUpperCase());
}

function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

function normalizePlate(plate: string): string {
  return (plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeState(state: string | undefined | null): string {
  return (state || 'IL').toUpperCase().trim().slice(0, 2) || 'IL';
}

async function findAuthUserByEmail(email: string) {
  if (!supabaseAdmin) throw new Error('Database not available');
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = (data.users || []) as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (users.length < perPage) return null;
    page += 1;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Service not configured' });
  }

  const ip = getClientIP(req);
  const rl = await checkRateLimit(ip, 'auth');
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const body = req.body || {};
  const accessCode = (body.accessCode || '').toString();
  const email = normalizeEmail(body.email);
  const firstName = (body.firstName || '').toString().trim();
  const lastName = (body.lastName || '').toString().trim();
  const phone = (body.phone || '').toString().trim() || null;
  const licensePlate = normalizePlate(body.licensePlate || '');
  const licenseState = normalizeState(body.licenseState);
  const vehicleMake = (body.vehicleMake || '').toString().trim() || null;
  const vehicleModel = (body.vehicleModel || '').toString().trim() || null;
  const vehicleColor = (body.vehicleColor || '').toString().trim() || null;
  const vehicleYear = (body.vehicleYear || '').toString().trim() || null;
  const mailingAddress = (body.mailingAddress || '').toString().trim();
  const mailingCity = (body.mailingCity || 'Chicago').toString().trim();
  const mailingState = normalizeState(body.mailingState);
  const mailingZip = (body.mailingZip || '').toString().trim();
  const homeAddressFull = (body.homeAddressFull || '').toString().trim() || null;
  const cityStickerExpiry = body.cityStickerExpiry || null;
  const licensePlateExpiryRaw = body.licensePlateExpiry || null;
  const wantsAffiliate = body.wantsAffiliate !== false; // default true
  const partnerOrg = (body.partnerOrg || '').toString().trim() || null;

  // Record the attempt regardless of outcome
  await recordRateLimitAction(ip, 'auth');

  if (!isValidAccessCode(accessCode)) {
    return res.status(403).json({ error: 'Invalid partner access code.' });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First and last name required.' });
  }
  if (!licensePlate) {
    return res.status(400).json({ error: 'License plate required.' });
  }
  if (!mailingAddress || !mailingZip) {
    return res.status(400).json({ error: 'Mailing address and ZIP required for contesting letters.' });
  }

  const matchedCode = accessCode.trim().toUpperCase();

  try {
    // 1) Find or create auth user
    let authUser = await findAuthUserByEmail(email);
    let createdAccount = false;

    if (!authUser) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error) {
        console.error('createUser failed:', error);
        return res.status(500).json({ error: 'Could not create account. Try again.' });
      }
      authUser = data.user;
      createdAccount = true;
    }

    if (!authUser) {
      return res.status(500).json({ error: 'Could not create account. Try again.' });
    }

    // 2) Upsert user_profiles with form data + paid flags
    const profilePatch: Record<string, any> = {
      email,
      first_name: firstName,
      last_name: lastName,
      phone_number: phone,
      license_plate: licensePlate,
      license_state: licenseState,
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      vehicle_color: vehicleColor,
      vehicle_year: vehicleYear,
      mailing_address: mailingAddress,
      mailing_city: mailingCity,
      mailing_state: mailingState,
      mailing_zip: mailingZip,
      home_address_full: homeAddressFull || mailingAddress,
      city_sticker_expiry: cityStickerExpiry,
      license_plate_expiry: licensePlateExpiryRaw,
      is_paid: true,
      has_contesting: true,
      sms_pro: true,
      role: 'user',
      updated_at: new Date().toISOString(),
    };

    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, affiliate_id')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (existingProfile) {
      // Don't clobber an existing email
      profilePatch.email = (existingProfile as any).email || email;
      const { error: updateErr } = await (supabaseAdmin.from('user_profiles') as any)
        .update(profilePatch)
        .eq('user_id', authUser.id);
      if (updateErr) {
        console.error('user_profiles update failed:', updateErr);
        return res.status(500).json({ error: 'Profile save failed.' });
      }
    } else {
      const insertPayload: Record<string, any> = {
        user_id: authUser.id,
        ...profilePatch,
        created_at: new Date().toISOString(),
      };
      const { error: insertErr } = await (supabaseAdmin.from('user_profiles') as any)
        .insert([insertPayload]);
      if (insertErr) {
        console.error('user_profiles insert failed:', insertErr);
        return res.status(500).json({ error: 'Profile create failed.' });
      }
    }

    // 3) Subscription + monitored plate (so portal scraper picks them up)
    try {
      await ensureAutopilotEnrollment(supabaseAdmin as any, {
        userId: authUser.id,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        plate: licensePlate,
        state: licenseState,
        source: 'partners_comp_signup',
        planCode: 'COMP_PARTNER',
        priceCents: 0,
      });
    } catch (enrollErr: any) {
      console.error('ensureAutopilotEnrollment failed:', enrollErr.message);
      // Continue — user_profiles flags still gate the app, but log loudly.
    }

    // 4) Rewardful affiliate (optional, non-blocking)
    let referralLink: string | null = null;
    if (wantsAffiliate) {
      try {
        const affiliateData = await createRewardfulAffiliate({
          email,
          first_name: firstName,
          last_name: lastName,
          campaign_id: process.env.REWARDFUL_PARTNER_CAMPAIGN_ID || process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID,
        });
        if (affiliateData) {
          referralLink =
            affiliateData.links?.[0]?.url ||
            (affiliateData.token ? `https://autopilotamerica.com?via=${affiliateData.token}` : null);
          await (supabaseAdmin.from('user_profiles') as any)
            .update({
              affiliate_id: affiliateData.id,
              affiliate_signup_date: new Date().toISOString(),
            })
            .eq('user_id', authUser.id);
        }
      } catch (affErr: any) {
        console.error('Rewardful affiliate creation failed (non-blocking):', affErr.message);
      }
    }

    // 5) Magic link so partner can sign in immediately
    let magicLink: string | null = null;
    try {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      if (!linkErr) magicLink = linkData?.properties?.action_link || null;
    } catch (e) {
      console.error('generateLink failed:', e);
    }

    // 6) Welcome email (best-effort)
    try {
      await resend.emails.send({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: email,
        subject: 'Welcome to Autopilot America — your partner account is ready',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Your Autopilot America account is active.</h2>
            <p>Hi ${firstName || 'there'},</p>
            <p>Thanks for partnering with us. Your account has full access to Autopilot — automatic ticket contesting, street-cleaning alerts, snow ban warnings, and the mobile app — at no cost.</p>
            ${magicLink ? `
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0;"><strong>Sign in instantly:</strong></p>
                <p style="margin: 0;"><a href="${magicLink}" style="color: #2563eb; word-break: break-all;">${magicLink}</a></p>
                <p style="margin: 10px 0 0 0; font-size: 13px; color: #475569;">This link signs you in directly — no password needed. It expires in 1 hour.</p>
              </div>
            ` : ''}
            ${referralLink ? `
              <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0;"><strong>Your referral link:</strong></p>
                <p style="margin: 0;"><a href="${referralLink}" style="color: #059669; word-break: break-all;">${referralLink}</a></p>
                <p style="margin: 10px 0 0 0; font-size: 13px; color: #065f46;">Earn $20 for each annual subscriber and $2/month per monthly subscriber you refer.</p>
              </div>
            ` : ''}
            <p>Mobile app: <a href="https://autopilotamerica.com/app">autopilotamerica.com/app</a></p>
            <p>Questions? Reply to this email or write to support@autopilotamerica.com.</p>
            <p>— The Autopilot America Team</p>
          </div>
        `,
        headers: {
          'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
    } catch (emailErr) {
      console.error('Welcome email failed (non-blocking):', emailErr);
    }

    // 6b) Admin notification email (best-effort)
    try {
      const adminTo = process.env.ADMIN_NOTIFICATION_EMAIL || 'ticketlessamerica@gmail.com';
      await resend.emails.send({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: adminTo,
        subject: `🎫 New partner signup: ${firstName} ${lastName}${partnerOrg ? ` (${partnerOrg})` : ''}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="margin: 0 0 16px 0;">New partner comp signup</h2>
            <p style="margin: 0 0 20px 0; color: #475569;">Someone just created a comp account at <a href="https://autopilotamerica.com/partners">/partners</a>.</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr><td style="padding: 6px 0; color: #64748b; width: 160px;">Name</td><td style="padding: 6px 0;"><strong>${firstName} ${lastName}</strong></td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Email</td><td style="padding: 6px 0;">${email}</td></tr>
              ${phone ? `<tr><td style="padding: 6px 0; color: #64748b;">Phone</td><td style="padding: 6px 0;">${phone}</td></tr>` : ''}
              ${partnerOrg ? `<tr><td style="padding: 6px 0; color: #64748b;">Partner org</td><td style="padding: 6px 0;">${partnerOrg}</td></tr>` : ''}
              <tr><td style="padding: 6px 0; color: #64748b;">Access code</td><td style="padding: 6px 0;"><code>${matchedCode}</code></td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Plate</td><td style="padding: 6px 0;">${licensePlate} / ${licenseState}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Vehicle</td><td style="padding: 6px 0;">${[vehicleYear, vehicleColor, vehicleMake, vehicleModel].filter(Boolean).join(' ') || '—'}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Mailing</td><td style="padding: 6px 0;">${mailingAddress}, ${mailingCity}, ${mailingState} ${mailingZip}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Affiliate link</td><td style="padding: 6px 0;">${referralLink ? `<a href="${referralLink}">${referralLink}</a>` : '— (not requested)'}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">New account?</td><td style="padding: 6px 0;">${createdAccount ? 'Yes — created' : 'No — upgraded existing'}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">User ID</td><td style="padding: 6px 0;"><code>${authUser.id}</code></td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">IP</td><td style="padding: 6px 0;">${ip}</td></tr>
            </table>
          </div>
        `,
      });
    } catch (adminEmailErr) {
      console.error('Admin notification email failed (non-blocking):', adminEmailErr);
    }

    // 7) Audit log
    try {
      await (supabaseAdmin.from('audit_logs') as any).insert({
        user_id: authUser.id,
        action_type: 'comp_access_granted',
        entity_type: 'user_profile',
        entity_id: authUser.id,
        action_details: {
          email,
          access_code: matchedCode,
          partner_org: partnerOrg,
          created_account: createdAccount,
          plate_monitored: licensePlate,
          state: licenseState,
          referral_link: referralLink,
          source: 'partners_comp_signup',
          ip_address: ip,
          granted_at: new Date().toISOString(),
        },
        status: 'success',
      });
    } catch (auditErr) {
      console.error('audit_logs insert failed (non-blocking):', auditErr);
    }

    return res.status(200).json({
      success: true,
      created: createdAccount,
      magic_link: magicLink,
      referral_link: referralLink,
    });
  } catch (err: any) {
    console.error('partners/comp-signup error:', err);
    return res.status(500).json({ error: err.message || 'Signup failed.' });
  }
}

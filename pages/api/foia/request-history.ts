/**
 * POST /api/foia/request-history
 *
 * Public endpoint: accepts a FOIA ticket history request from anyone.
 * Creates a foia_history_requests row and optionally links to a user account.
 *
 * Body: { name, email, licensePlate, licenseState?, foiaConsent, signatureName, signatureAgreedText, consentElectronicProcess, source? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendFoiaHistoryConfirmationEmail } from '../../../lib/foia-history-service';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: sends confirmation email, writes to DB
  const clientIp = getClientIP(req);
  const rateResult = await checkRateLimit(clientIp, 'api');
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Limit', rateResult.limit);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + rateResult.resetIn / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.', retryAfter: Math.ceil(rateResult.resetIn / 1000) });
  }
  await recordRateLimitAction(clientIp, 'api');

  const {
    name,
    email,
    licensePlate,
    licenseState = 'IL',
    foiaConsent,
    signatureName,
    signatureAgreedText,
    consentElectronicProcess,
    source = 'public_lookup',
  } = req.body;

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!licensePlate || typeof licensePlate !== 'string' || licensePlate.trim().length < 2) {
    return res.status(400).json({ error: 'License plate is required (at least 2 characters)' });
  }
  if (!foiaConsent) {
    return res.status(400).json({ error: 'You must consent to the FOIA request submission' });
  }
  // E-signature validation: signatureName is required for legal authorization
  if (!signatureName || typeof signatureName !== 'string' || signatureName.trim().length < 2) {
    return res.status(400).json({ error: 'Electronic signature (typed full name) is required' });
  }
  if (!consentElectronicProcess) {
    return res.status(400).json({ error: 'You must agree to sign electronically' });
  }

  const cleanPlate = licensePlate.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const cleanEmail = email.toLowerCase().trim();
  const cleanName = name.trim();
  const cleanState = (licenseState || 'IL').toUpperCase().trim();

  // Check for duplicate recent requests (same plate + email in last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, status, created_at')
    .eq('license_plate', cleanPlate)
    .eq('email', cleanEmail)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    const recent = existing[0];
    if (recent.status === 'queued' || recent.status === 'sent') {
      return res.status(200).json({
        success: true,
        message: 'We already have a pending FOIA request for this plate. You\'ll be notified when results arrive.',
        requestId: recent.id,
        alreadyExists: true,
      });
    }
  }

  // Try to find an existing user account by email
  // Use user_profiles table (indexed on email) instead of auth.admin.listUsers()
  // which only returns the first page of 50 users
  let userId: string | null = null;
  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('email', cleanEmail)
      .limit(1)
      .maybeSingle();
    if (profile?.user_id) {
      userId = profile.user_id;
    }
  } catch (err) {
    // Non-critical — proceed without user linking
    console.error('Error looking up user:', err);
  }

  // Get IP and user agent for consent audit trail
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
  const userAgent = (req.headers['user-agent'] as string) || 'unknown';

  // Create the FOIA history request with e-signature audit trail
  const { data: request, error: insertError } = await supabaseAdmin
    .from('foia_history_requests')
    .insert({
      user_id: userId,
      email: cleanEmail,
      name: cleanName,
      license_plate: cleanPlate,
      license_state: cleanState,
      consent_given: true,
      consent_given_at: new Date().toISOString(),
      consent_ip: ip,
      // E-signature fields (ESIGN Act / Illinois UETA compliance)
      signature_name: signatureName?.trim() || null,
      signature_agreed_text: signatureAgreedText || null,
      signature_user_agent: userAgent,
      consent_electronic_process: consentElectronicProcess === true,
      status: 'queued',
      source: source === 'signup_auto' ? 'signup_auto' : source === 'dashboard' ? 'dashboard' : 'public_lookup',
    })
    .select('id')
    .single(); // Safe: .single() after insert

  if (insertError) {
    console.error('Failed to create FOIA history request:', insertError);
    return res.status(500).json({ error: 'Failed to submit request. Please try again.' });
  }

  // If user exists, update their foia_history_consent
  if (userId) {
    await supabaseAdmin
      .from('user_profiles')
      .update({
        foia_history_consent: true,
        foia_history_consent_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  console.log(`FOIA history request created: ${request.id} for plate ${cleanState} ${cleanPlate} (${cleanEmail})`);

  // Send confirmation email immediately (fire-and-forget — don't block the response)
  sendFoiaHistoryConfirmationEmail({
    email: cleanEmail,
    name: cleanName,
    licensePlate: cleanPlate,
    licenseState: cleanState,
  }).catch((err: any) => {
    console.error(`Failed to send immediate confirmation email to ${cleanEmail}: ${err.message}`);
  });

  return res.status(200).json({
    success: true,
    message: 'Your FOIA request has been submitted! We\'ll email you when the city responds (typically 5 business days).',
    requestId: request.id,
  });
}

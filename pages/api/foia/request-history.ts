/**
 * POST /api/foia/request-history
 *
 * Public endpoint: accepts a FOIA ticket history request from anyone.
 * Creates a foia_history_requests row and optionally links to a user account.
 *
 * Body: { name, email, licensePlate, licenseState?, foiaConsent, source? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    name,
    email,
    licensePlate,
    licenseState = 'IL',
    foiaConsent,
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

  const cleanPlate = licensePlate.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const cleanEmail = email.toLowerCase().trim();
  const cleanName = name.trim();
  const cleanState = (licenseState || 'IL').toUpperCase().trim();

  // Check for duplicate recent requests (same plate + email in last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, status, created_at')
    .eq('license_plate', cleanPlate)
    .eq('email', cleanEmail)
    .gte('created_at', thirtyDaysAgo)
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
  let userId: string | null = null;
  try {
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users?.users.find(u => u.email === cleanEmail);
    if (user) {
      userId = user.id;
    }
  } catch (err) {
    // Non-critical — proceed without user linking
    console.error('Error looking up user:', err);
  }

  // Get IP for consent tracking
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';

  // Create the FOIA history request
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
      status: 'queued',
      source: source === 'signup_auto' ? 'signup_auto' : source === 'dashboard' ? 'dashboard' : 'public_lookup',
    })
    .select('id')
    .single();

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

  return res.status(200).json({
    success: true,
    message: 'Your FOIA request has been submitted! We\'ll email you when the city responds (typically 5 business days).',
    requestId: request.id,
  });
}

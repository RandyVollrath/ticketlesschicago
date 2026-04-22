import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const resend = new Resend(process.env.RESEND_API_KEY);

// Escape HTML special chars before embedding in the admin email template.
function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Authenticate via Bearer token and use the verified user id.
  // Prior version trusted a client-supplied `userId` in the body, so anyone
  // could submit a guarantee claim as any user who had has_contesting=true.
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.substring(7),
  );
  if (authError || !authUser) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = authUser.id;

  try {
    const {
      ticketNumber,
      ticketDate,
      ticketAmount,
      ticketType,
      ticketDescription,
      ticketAddress,
      frontPhotoUrl,
      backPhotoUrl,
      paymentMethod,
      paymentDetails
    } = req.body;

    if (!ticketDate || !ticketAmount || !ticketType || !frontPhotoUrl || !backPhotoUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // SECURITY: Only accept URLs that live on domains we trust (our own
    // Supabase/Blob storage). Attacker-supplied URLs could be used for
    // tracking pixels in the admin email, or to phish with a plausible-looking
    // "ticket photo" pointing at a credential-harvesting page.
    const allowedHosts = [
      'supabase.co',
      'vercel-storage.com',
      'vercel.app',
      'blob.vercel-storage.com',
    ];
    const urlHostAllowed = (u: unknown) => {
      if (typeof u !== 'string') return false;
      try {
        const h = new URL(u).hostname;
        return allowedHosts.some(a => h === a || h.endsWith('.' + a));
      } catch {
        return false;
      }
    };
    if (!urlHostAllowed(frontPhotoUrl) || !urlHostAllowed(backPhotoUrl)) {
      return res.status(400).json({ error: 'Photo URLs must be hosted on our storage' });
    }

    // Get user info (service role — we trust the JWT above).
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Get user profile to check protection status
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('has_contesting, email, first_name, last_name, license_plate')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      return res.status(400).json({ error: 'User profile not found' });
    }

    if (!profile.has_contesting) {
      return res.status(403).json({ error: 'Active membership required to submit guarantee reviews' });
    }

    const details = {
      source: 'ticket_submit',
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      licensePlate: profile.license_plate,
      ticketNumber: ticketNumber || null,
      ticketDate,
      ticketAmount: parseFloat(ticketAmount),
      ticketType,
      ticketDescription: ticketDescription || null,
      ticketAddress: ticketAddress || null,
      frontPhotoUrl,
      backPhotoUrl,
      paymentMethod: paymentMethod || null,
      paymentDetails: paymentDetails || null,
    };

    // Backwards-compatible endpoint: now writes guarantee_claims.
    const { data: request, error: insertError } = await supabaseAdmin
      .from('guarantee_claims' as any)
      .insert({
        user_id: userId,
        account_email: profile.email,
        account_phone: null,
        had_eligible_ticket_contested: true,
        ticket_ids: ticketNumber || null,
        membership_remained_active: true,
        docs_provided_on_time: true,
        tickets_after_membership_start: true,
        status: 'submitted',
        notes: JSON.stringify(details),
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating guarantee claim:', insertError);
      return res.status(500).json({ error: 'Failed to create guarantee claim' });
    }

    // Send email notification to admin
    try {
      await resend.emails.send({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
        subject: `🎫 New Guarantee Review Submission - ${esc(profile.first_name)} ${esc(profile.last_name)}`,
        html: `
          <h2>New Guarantee Review Submission</h2>

          <h3>User Information:</h3>
          <ul>
            <li><strong>Name:</strong> ${esc(profile.first_name)} ${esc(profile.last_name)}</li>
            <li><strong>Email:</strong> ${esc(profile.email)}</li>
            <li><strong>License Plate:</strong> ${esc(profile.license_plate)}</li>
          </ul>

          <h3>Ticket Details:</h3>
          <ul>
            <li><strong>Type:</strong> ${esc(String(ticketType).replace('_', ' '))}</li>
            <li><strong>Date:</strong> ${esc(new Date(ticketDate).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }))}</li>
            <li><strong>Amount:</strong> $${parseFloat(ticketAmount).toFixed(2)}</li>
            <li><strong>Address:</strong> ${esc(ticketAddress || 'Not provided')}</li>
            ${ticketNumber ? `<li><strong>Ticket #:</strong> ${esc(ticketNumber)}</li>` : ''}
            ${ticketDescription ? `<li><strong>Description:</strong> ${esc(ticketDescription)}</li>` : ''}
          </ul>

          <h3>Photos:</h3>
          <p><a href="${esc(frontPhotoUrl)}">View Front Photo</a> | <a href="${esc(backPhotoUrl)}">View Back Photo</a></p>

          <p><a href="${esc(process.env.NEXT_PUBLIC_SITE_URL || '')}/admin/profile-updates" style="display: inline-block; padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Review in Admin Panel</a></p>
        `
      });
      console.log('✅ Guarantee review notification email sent');
    } catch (emailError) {
      console.error('❌ Failed to send guarantee review notification:', emailError);
    }

    return res.status(200).json({
      success: true,
      requestId: (request as any)?.id,
      remainingCoverage: null
    });

  } catch (error: any) {
    console.error('Guarantee submission error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

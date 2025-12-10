import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      userId,
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

    if (!userId || !ticketDate || !ticketAmount || !ticketType || !frontPhotoUrl || !backPhotoUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get user info
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Get user profile to check protection status
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('has_protection, email, first_name, last_name, license_plate')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(400).json({ error: 'User profile not found' });
    }

    if (!profile.has_protection) {
      return res.status(403).json({ error: 'Ticket Protection plan required to submit reimbursement requests' });
    }

    // Calculate total reimbursed this year
    const yearStart = new Date();
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);

    const { data: existingReimbursements } = await supabaseAdmin
      .from('reimbursement_requests')
      .select('reimbursement_amount')
      .eq('user_id', userId)
      .eq('status', 'paid')
      .gte('created_at', yearStart.toISOString());

    const totalReimbursedThisYear = (existingReimbursements || [])
      .reduce((sum, r) => sum + (parseFloat(r.reimbursement_amount) || 0), 0);

    const remainingCoverage = 200 - totalReimbursedThisYear;

    // Create reimbursement request
    const { data: request, error: insertError } = await supabaseAdmin
      .from('reimbursement_requests')
      .insert({
        user_id: userId,
        email: profile.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        license_plate: profile.license_plate,
        ticket_number: ticketNumber,
        ticket_date: ticketDate,
        ticket_amount: parseFloat(ticketAmount),
        ticket_type: ticketType,
        ticket_description: ticketDescription,
        ticket_address: ticketAddress,
        front_photo_url: frontPhotoUrl,
        back_photo_url: backPhotoUrl,
        payment_method: paymentMethod,
        payment_details: paymentDetails,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating reimbursement request:', insertError);
      return res.status(500).json({ error: 'Failed to create reimbursement request' });
    }

    // Send email notification to admin
    try {
      const expectedReimbursement = Math.min(
        parseFloat(ticketAmount) * 0.8,
        remainingCoverage
      );

      await resend.emails.send({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
        subject: `🎫 New Reimbursement Request - ${profile.first_name} ${profile.last_name}`,
        html: `
          <h2>New Ticket Reimbursement Request</h2>

          <h3>User Information:</h3>
          <ul>
            <li><strong>Name:</strong> ${profile.first_name} ${profile.last_name}</li>
            <li><strong>Email:</strong> ${profile.email}</li>
            <li><strong>License Plate:</strong> ${profile.license_plate}</li>
          </ul>

          <h3>Ticket Details:</h3>
          <ul>
            <li><strong>Type:</strong> ${ticketType.replace('_', ' ')}</li>
            <li><strong>Date:</strong> ${new Date(ticketDate).toLocaleDateString()}</li>
            <li><strong>Amount:</strong> $${parseFloat(ticketAmount).toFixed(2)}</li>
            <li><strong>Address:</strong> ${ticketAddress || 'Not provided'}</li>
            ${ticketNumber ? `<li><strong>Ticket #:</strong> ${ticketNumber}</li>` : ''}
            ${ticketDescription ? `<li><strong>Description:</strong> ${ticketDescription}</li>` : ''}
          </ul>

          <h3>Reimbursement Info:</h3>
          <ul>
            <li><strong>Expected (80%):</strong> $${expectedReimbursement.toFixed(2)}</li>
            <li><strong>Total Paid This Year:</strong> $${totalReimbursedThisYear.toFixed(2)}</li>
            <li><strong>Remaining Coverage:</strong> $${remainingCoverage.toFixed(2)} / $200</li>
          </ul>

          <h3>Payment Info:</h3>
          <ul>
            <li><strong>Method:</strong> ${paymentMethod}</li>
            <li><strong>Details:</strong> ${paymentDetails}</li>
          </ul>

          <h3>Photos:</h3>
          <p><a href="${frontPhotoUrl}">View Front Photo</a> | <a href="${backPhotoUrl}">View Back Photo</a></p>

          <p><a href="${process.env.NEXT_PUBLIC_SITE_URL}/admin/profile-updates" style="display: inline-block; padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Review in Admin Panel</a></p>
        `
      });
      console.log('✅ Reimbursement request notification email sent');
    } catch (emailError) {
      console.error('❌ Failed to send reimbursement notification:', emailError);
    }

    return res.status(200).json({
      success: true,
      requestId: request.id,
      remainingCoverage
    });

  } catch (error: any) {
    console.error('Reimbursement submission error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

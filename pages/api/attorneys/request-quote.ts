import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      attorneyId,
      contestId,
      violationCode,
      ticketAmount,
      description,
      urgency = 'medium',
      preferredContact = 'email'
    } = req.body;

    if (!attorneyId) {
      return res.status(400).json({ error: 'Attorney ID is required' });
    }

    // Get attorney details
    const { data: attorney, error: attorneyError } = await supabase
      .from('attorneys')
      .select('*')
      .eq('id', attorneyId)
      .single();

    if (attorneyError || !attorney) {
      return res.status(404).json({ error: 'Attorney not found' });
    }

    if (!attorney.accepting_cases) {
      return res.status(400).json({ error: 'Attorney is not currently accepting cases' });
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name, email, phone')
      .eq('user_id', user.id)
      .single();

    // Create quote request
    const { data: quoteRequest, error: insertError } = await supabase
      .from('attorney_quote_requests')
      .insert({
        user_id: user.id,
        attorney_id: attorneyId,
        contest_id: contestId,
        violation_code: violationCode,
        ticket_amount: ticketAmount,
        description,
        urgency,
        preferred_contact: preferredContact
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create quote request: ' + insertError.message });
    }

    // Send email notification to attorney
    if (resend && attorney.email) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'noreply@ticketlessamerica.com',
          to: attorney.email,
          subject: `New Quote Request - ${violationCode || 'Parking Ticket'}`,
          html: `
            <h2>New Quote Request from Autopilot America</h2>
            <p>You have a new quote request from a client:</p>

            <h3>Client Details</h3>
            <ul>
              <li><strong>Name:</strong> ${profile?.full_name || 'Not provided'}</li>
              <li><strong>Email:</strong> ${profile?.email || user.email}</li>
              <li><strong>Phone:</strong> ${profile?.phone || 'Not provided'}</li>
              <li><strong>Preferred Contact:</strong> ${preferredContact}</li>
            </ul>

            <h3>Case Details</h3>
            <ul>
              <li><strong>Violation:</strong> ${violationCode || 'Not specified'}</li>
              <li><strong>Ticket Amount:</strong> $${ticketAmount || 'Not specified'}</li>
              <li><strong>Urgency:</strong> ${urgency}</li>
            </ul>

            <h3>Description</h3>
            <p>${description || 'No additional details provided'}</p>

            <p><a href="${process.env.NEXT_PUBLIC_SITE_URL}/attorney-dashboard?request=${quoteRequest.id}">View Request & Provide Quote</a></p>

            <p style="color: #666; font-size: 12px;">
              Please respond within 24 hours to maintain your response time rating.
            </p>
          `
        });
      } catch (emailError) {
        console.error('Email send error:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Send confirmation email to user
    if (resend && (profile?.email || user.email)) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'noreply@ticketlessamerica.com',
          to: profile?.email || user.email,
          subject: `Quote Request Sent - ${attorney.full_name}`,
          html: `
            <h2>Quote Request Sent Successfully</h2>
            <p>Your quote request has been sent to ${attorney.full_name}${attorney.law_firm ? ` at ${attorney.law_firm}` : ''}.</p>

            <h3>Attorney Details</h3>
            <ul>
              <li><strong>Name:</strong> ${attorney.full_name}</li>
              ${attorney.law_firm ? `<li><strong>Firm:</strong> ${attorney.law_firm}</li>` : ''}
              <li><strong>Experience:</strong> ${attorney.years_experience || 'Not specified'} years</li>
              <li><strong>Win Rate:</strong> ${attorney.win_rate || 'Not available'}%</li>
              <li><strong>Average Response Time:</strong> ${attorney.response_time_hours || 24} hours</li>
            </ul>

            <p>You should receive a quote within ${attorney.response_time_hours || 24} hours.</p>

            <p><a href="${process.env.NEXT_PUBLIC_SITE_URL}/my-quotes">View Your Quote Requests</a></p>
          `
        });
      } catch (emailError) {
        console.error('User email send error:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      quoteRequest,
      attorney: {
        id: attorney.id,
        name: attorney.full_name,
        firm: attorney.law_firm,
        responseTime: attorney.response_time_hours
      }
    });

  } catch (error: any) {
    console.error('Quote request error:', error);
    res.status(500).json({ error: error.message });
  }
}

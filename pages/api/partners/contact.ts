import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, company, fleetSize, message } = req.body;

    // Validate required fields
    if (!name || !email || !company || !fleetSize) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store in database
    const { error: dbError } = await supabaseAdmin
      .from('partner_inquiries')
      .insert({
        name,
        email,
        company,
        fleet_size: fleetSize,
        message: message || '',
        created_at: new Date().toISOString()
      });

    if (dbError) {
      console.error('Database error:', dbError);
      // Don't fail if DB insert fails - we'll still send email
    }

    // Send notification email
    const emailSubject = `New Fleet Partner Inquiry: ${company}`;
    const emailBody = `
New fleet partnership inquiry:

Name: ${name}
Email: ${email}
Company: ${company}
Fleet Size: ${fleetSize}

Message:
${message || '(No message provided)'}

---
Received: ${new Date().toLocaleString()}
    `.trim();

    // Use Resend to send notification
    if (process.env.RESEND_API_KEY) {
      try {
        await fetchWithTimeout('https://api.resend.com/emails', {
          method: 'POST',
          timeout: DEFAULT_TIMEOUTS.email,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'partnerships@autopilotamerica.com',
            to: 'support@autopilotamerica.com',
            subject: emailSubject,
            text: emailBody
          })
        });
      } catch (emailError) {
        console.error('Email error:', emailError);
        // Don't fail the request if email fails
      }
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Error processing partner inquiry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

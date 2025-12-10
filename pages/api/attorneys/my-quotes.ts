import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Send email notification to user about attorney response
async function sendQuoteResponseEmail(
  userEmail: string,
  attorneyName: string,
  quoteAmount: number | null,
  responseMessage: string | null,
  ticketDetails: string
): Promise<void> {
  try {
    const hasQuote = quoteAmount !== null && quoteAmount > 0;

    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUTS.email,
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <attorneys@autopilotamerica.com>',
        to: userEmail,
        subject: `Attorney Response: ${attorneyName} ${hasQuote ? `quoted $${quoteAmount}` : 'responded to your request'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #3b82f6; padding: 24px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 22px;">Attorney Response Received</h1>
            </div>

            <div style="padding: 24px; background-color: #f9fafb;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Good news! An attorney has responded to your quote request.
              </p>

              <div style="background-color: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #1a1a1a; font-size: 18px;">Quote Details</h2>
                <table style="width: 100%; font-size: 14px;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Attorney:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 600;">${attorneyName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Ticket:</td>
                    <td style="padding: 8px 0; text-align: right;">${ticketDetails}</td>
                  </tr>
                  ${hasQuote ? `
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0 8px 0; color: #1a1a1a; font-weight: 600;">Quoted Amount:</td>
                    <td style="padding: 12px 0 8px 0; text-align: right; font-weight: 600; font-size: 20px; color: #10b981;">$${quoteAmount}</td>
                  </tr>
                  ` : ''}
                </table>
              </div>

              ${responseMessage ? `
              <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <h3 style="margin: 0 0 8px 0; color: #374151; font-size: 14px;">Attorney's Message:</h3>
                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${responseMessage}</p>
              </div>
              ` : ''}

              <div style="text-align: center; margin: 24px 0;">
                <a href="${process.env.NEXT_PUBLIC_SITE_URL}/my-contests"
                   style="background-color: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">
                  View Quote & Respond
                </a>
              </div>

              <p style="color: #6b7280; font-size: 13px;">
                Log in to review the full quote and decide if you want to proceed with this attorney.
              </p>
            </div>

            <div style="padding: 16px 24px; background-color: #f3f4f6; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                Autopilot America • <a href="https://autopilotamerica.com" style="color: #3b82f6;">autopilotamerica.com</a>
              </p>
            </div>
          </div>
        `
      })
    });

    if (response.ok) {
      console.log(`✅ Quote response email sent to ${userEmail}`);
    } else {
      console.error(`❌ Failed to send quote response email: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Error sending quote response email:', error);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get user from auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user is an attorney
    const { data: attorney, error: attorneyError } = await supabase
      .from('attorneys')
      .select('id')
      .eq('email', user.email)
      .single();

    if (attorneyError || !attorney) {
      return res.status(403).json({ error: 'Not registered as an attorney' });
    }

    if (req.method === 'GET') {
      // Get all quote requests for this attorney
      const { status } = req.query;

      let query = supabase
        .from('attorney_quote_requests')
        .select('*')
        .eq('attorney_id', attorney.id)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: quotes, error: quotesError } = await query;

      if (quotesError) {
        console.error('Error fetching quotes:', quotesError);
        return res.status(500).json({ error: 'Failed to fetch quotes' });
      }

      res.status(200).json({
        success: true,
        quotes: quotes || []
      });

    } else if (req.method === 'PATCH') {
      // Update quote request (respond to quote)
      const { quoteId, status, responseMessage, quoteAmount, estimatedDuration } = req.body;

      if (!quoteId) {
        return res.status(400).json({ error: 'Quote ID required' });
      }

      // Verify this quote belongs to this attorney
      const { data: quote, error: verifyError } = await supabase
        .from('attorney_quote_requests')
        .select('*')
        .eq('id', quoteId)
        .eq('attorney_id', attorney.id)
        .single();

      if (verifyError || !quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }

      const updateData: any = {};
      if (status) updateData.status = status;
      if (responseMessage !== undefined) updateData.attorney_response = responseMessage;
      if (quoteAmount !== undefined) updateData.quote_amount = quoteAmount;
      if (estimatedDuration !== undefined) updateData.estimated_duration = estimatedDuration;
      if (status === 'responded' || status === 'accepted') {
        updateData.responded_at = new Date().toISOString();
      }

      const { data: updatedQuote, error: updateError } = await supabase
        .from('attorney_quote_requests')
        .update(updateData)
        .eq('id', quoteId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating quote:', updateError);
        return res.status(500).json({ error: 'Failed to update quote' });
      }

      // Send email notification to user about attorney response
      if (status === 'responded' || status === 'accepted') {
        // Get attorney name for the email
        const { data: attorneyData } = await supabase
          .from('attorneys')
          .select('name, firm_name')
          .eq('id', attorney.id)
          .single();

        const attorneyName = attorneyData?.name || attorneyData?.firm_name || 'An attorney';

        // Get user email from the quote request
        const userEmail = quote.user_email || quote.contact_email;
        const ticketDetails = quote.ticket_number || quote.violation_type || 'Parking ticket';

        if (userEmail) {
          // Send notification (non-blocking)
          sendQuoteResponseEmail(
            userEmail,
            attorneyName,
            quoteAmount || updatedQuote.quote_amount,
            responseMessage || updatedQuote.attorney_response,
            ticketDetails
          ).catch(err => console.error('Failed to send quote response email:', err));
        }
      }

      res.status(200).json({
        success: true,
        quote: updatedQuote
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Attorney quotes error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

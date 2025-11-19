import { NextApiRequest, NextApiResponse } from 'next';
import { sendRemitterDailyEmail } from '../../../lib/remitter-emails';

/**
 * Send Remitter Daily Email
 *
 * Sends email to remitter with all pending renewals
 * Can be called manually or via cron
 *
 * POST /api/admin/send-remitter-email
 *
 * Query params:
 * - email: Override remitter email (optional)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.query;
    const remitterEmail = (email as string) || process.env.REMITTER_EMAIL;

    console.log(`📧 Sending remitter email to: ${remitterEmail}`);

    const result = await sendRemitterDailyEmail(remitterEmail);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        renewalCount: result.renewalCount
      });
    }

    return res.status(200).json({
      success: true,
      message: `Sent email with ${result.renewalCount} pending renewal${result.renewalCount !== 1 ? 's' : ''}`,
      renewalCount: result.renewalCount,
      sentTo: remitterEmail,
      instructions: {
        remitter_next_steps: [
          '1. Check email for pending renewals',
          '2. Submit each renewal to city website',
          '3. Get confirmation number from city',
          '4. Click "Mark as Submitted" button in email'
        ],
        api_alternative: 'Remitter can also use: POST /api/remitter/confirm-payment',
        view_pending: 'GET /api/remitter/pending-renewals'
      }
    });
  } catch (error: any) {
    console.error('Error sending remitter email:', error);
    return res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
}

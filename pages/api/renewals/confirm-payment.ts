import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { maskEmail } from '../../../lib/mask-pii';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Send confirmation email for renewal payment
 */
async function sendPaymentConfirmationEmail(
  email: string,
  firstName: string | null,
  renewalType: string,
  licensePlate: string,
  amount: number,
  dueDate: string
) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set, skipping confirmation email');
    return false;
  }

  const renewalTypeName = renewalType === 'city_sticker'
    ? 'City Sticker'
    : renewalType === 'license_plate'
      ? 'License Plate'
      : 'Vehicle Registration';

  const formattedAmount = (amount / 100).toFixed(2);
  const formattedDueDate = new Date(dueDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: email,
        subject: `Payment Confirmed - ${renewalTypeName} Renewal`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Payment Confirmed!</h1>
            </div>

            <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
              <p style="color: #374151; font-size: 16px;">Hi ${firstName || 'there'},</p>

              <p style="color: #374151; font-size: 16px;">
                Great news! Your ${renewalTypeName.toLowerCase()} renewal payment has been received.
              </p>

              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <h3 style="margin: 0 0 12px 0; color: #1f2937; font-size: 14px; text-transform: uppercase;">Payment Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Renewal Type</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${renewalTypeName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">License Plate</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${licensePlate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Due Date</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${formattedDueDate}</td>
                  </tr>
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0 0 0; color: #6b7280; font-weight: 600;">Amount Paid</td>
                    <td style="padding: 12px 0 0 0; color: #10b981; text-align: right; font-weight: 700; font-size: 18px;">$${formattedAmount}</td>
                  </tr>
                </table>
              </div>

              <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 12px 16px; margin: 24px 0;">
                <p style="margin: 0; color: #065f46; font-size: 14px;">
                  <strong>What happens next?</strong><br>
                  We'll process your renewal and submit it to the ${renewalType === 'city_sticker' ? 'City of Chicago' : 'IL Secretary of State'}.
                  Your new ${renewalTypeName.toLowerCase()} will be mailed to your address on file.
                </p>
              </div>

              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Questions? Reply to this email or contact us at
                <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
              </p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Autopilot America • Never miss a renewal again
              </p>
            </div>
          </div>
        `
      })
    });

    if (response.ok) {
      console.log(`✅ Sent payment confirmation email to ${maskEmail(email)}`);
      return true;
    } else {
      const error = await response.text();
      console.error('Failed to send confirmation email:', error);
      return false;
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Payment intent ID required' });
  }

  try {
    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    // Update payment record in database
    const { data: paymentRecord, error: updateError } = await supabase
      .from('renewal_payments')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        metadata: {
          ...paymentRecord?.metadata,
          stripe_payment_method: paymentIntent.payment_method,
          stripe_receipt_url: paymentIntent.charges?.data[0]?.receipt_url
        }
      })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      return res.status(500).json({ error: 'Failed to update payment record' });
    }

    // Get user details for notification
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('email, first_name, last_name, phone_number')
      .eq('user_id', paymentRecord.user_id)
      .single();

    if (!userError && user?.email) {
      // Send confirmation email to customer
      await sendPaymentConfirmationEmail(
        user.email,
        user.first_name,
        paymentRecord.renewal_type,
        paymentRecord.license_plate,
        paymentRecord.total_amount,
        paymentRecord.due_date
      );

      console.log('Payment confirmed:', {
        paymentId: paymentRecord.id,
        user: maskEmail(user.email),
        renewalType: paymentRecord.renewal_type,
        licensePlate: paymentRecord.license_plate,
        amount: paymentRecord.total_amount
      });
    }

    res.status(200).json({
      success: true,
      paymentRecord: {
        id: paymentRecord.id,
        renewalType: paymentRecord.renewal_type,
        licensePlate: paymentRecord.license_plate,
        totalAmount: paymentRecord.total_amount,
        dueDate: paymentRecord.due_date
      }
    });

  } catch (error: any) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: error.message });
  }
}
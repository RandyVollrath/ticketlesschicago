import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

/**
 * Update user address and detect permit zone changes
 * Handles:
 * 1. User moves INTO a permit zone → charge $30 fee
 * 2. User moves OUT of permit zone → issue credit/refund
 * 3. Address update for existing zone users
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, newAddress } = req.body;

    if (!userId || !newAddress) {
      return res.status(400).json({ error: 'Missing userId or newAddress' });
    }

    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Get current user profile
    const { data: currentProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !currentProfile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentHasZone = currentProfile.has_permit_zone || false;

    // Check if new address is in a permit zone
    const zoneCheckResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/check-permit-zone?address=${encodeURIComponent(newAddress)}`
    );

    const zoneCheck = await zoneCheckResponse.json();
    const newHasZone = zoneCheck.inPermitZone || false;
    const zones = zoneCheck.zones || [];

    // Detect zone status change
    const movedIntoZone = !currentHasZone && newHasZone;
    const movedOutOfZone = currentHasZone && !newHasZone;

    console.log('Zone change detection:', {
      userId,
      currentHasZone,
      newHasZone,
      movedIntoZone,
      movedOutOfZone
    });

    // Update user profile with new address
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        mailing_address: newAddress,
        street_address: newAddress,
        home_address_full: newAddress,
        has_permit_zone: newHasZone,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      throw updateError;
    }

    // Handle zone changes
    if (movedIntoZone) {
      console.log(`🅿️ User ${currentProfile.email} moved INTO permit zone`);

      // Check if user has Protection (paid subscription)
      if (currentProfile.has_protection) {
        // Create Stripe Payment Link for $30 permit fee
        const paymentLink = await stripe.paymentLinks.create({
          line_items: [
            {
              price: process.env.STRIPE_PERMIT_FEE_PRICE_ID!,
              quantity: 1,
            },
          ],
          metadata: {
            userId: userId,
            purpose: 'permit_zone_fee_addon',
            zones: JSON.stringify(zones)
          },
          after_completion: {
            type: 'redirect',
            redirect: {
              url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings?permit_paid=true`
            }
          }
        });

        // Send email notification with payment link
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
          from: 'Autopilot America <noreply@ticketlessamerica.com>',
          to: currentProfile.email,
          subject: '🅿️ Permit Zone Fee Required - New Address',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Address Update: Permit Zone Detected</h2>

              <p style="font-size: 16px; line-height: 1.6;">
                Good news! We've updated your address to:
              </p>

              <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <strong>${newAddress}</strong>
              </div>

              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 12px; color: #92400e;">Permit Zone Fee Required</h3>
                <p style="color: #78350f; margin: 0;">
                  Your new address is in a <strong>Residential Permit Parking Zone</strong>.
                  To continue your Protection coverage for this address, a one-time $30 permit fee is required.
                </p>
              </div>

              <div style="text-align: center; margin: 32px 0;">
                <a href="${paymentLink.url}"
                   style="background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
                  Pay $30 Permit Fee
                </a>
              </div>

              <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h4 style="margin: 0 0 8px; color: #1e40af;">What's Next?</h4>
                <ol style="margin: 8px 0; padding-left: 20px; color: #1e40af;">
                  <li>Pay the $30 permit fee using the link above</li>
                  <li>We'll request permit documents 60 days before your city sticker renewal</li>
                  <li>We'll purchase your permit automatically when it's time</li>
                </ol>
              </div>

              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Questions? Reply to this email or contact us at support@ticketlessamerica.com
              </p>
            </div>
          `
        });

        return res.status(200).json({
          success: true,
          message: 'Address updated - moved into permit zone',
          zoneChange: 'entered_zone',
          paymentRequired: true,
          paymentLink: paymentLink.url
        });
      } else {
        // No Protection subscription - just notify
        return res.status(200).json({
          success: true,
          message: 'Address updated',
          zoneChange: 'entered_zone',
          paymentRequired: false,
          note: 'User does not have Protection subscription'
        });
      }
    }

    if (movedOutOfZone) {
      console.log(`🅿️ User ${currentProfile.email} moved OUT OF permit zone`);

      // Calculate potential refund (pro-rated based on city sticker renewal date)
      // For now, just flag for manual review
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Notify admin about potential refund
      await resend.emails.send({
        from: 'Autopilot America <noreply@ticketlessamerica.com>',
        to: 'ticketlessamerica@gmail.com',
        subject: `💰 Permit Zone Refund - ${currentProfile.email}`,
        html: `
          <div style="font-family: Arial, sans-serif;">
            <h2>User Moved Out of Permit Zone</h2>
            <p><strong>User:</strong> ${currentProfile.email}</p>
            <p><strong>Old Address:</strong> ${currentProfile.mailing_address}</p>
            <p><strong>New Address:</strong> ${newAddress}</p>
            <p><strong>City Sticker Renewal:</strong> ${currentProfile.city_sticker_expiry || 'Not set'}</p>

            <p style="background: #fef3c7; padding: 12px; border-radius: 6px;">
              ⚠️ <strong>Action needed:</strong> Review if permit fee refund is appropriate (pro-rated based on time remaining until renewal).
            </p>
          </div>
        `
      });

      // Notify user
      await resend.emails.send({
        from: 'Autopilot America <noreply@ticketlessamerica.com>',
        to: currentProfile.email,
        subject: 'Address Updated - Permit Zone No Longer Required',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Address Update Confirmed</h2>

            <p style="font-size: 16px; line-height: 1.6;">
              We've updated your address to:
            </p>

            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <strong>${newAddress}</strong>
            </div>

            <div style="background: #dcfce7; border-left: 4px solid #16a34a; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <h3 style="margin: 0 0 12px; color: #166534;">Good News!</h3>
              <p style="color: #15803d; margin: 0;">
                Your new address is <strong>not</strong> in a residential permit parking zone.
                You won't need a permit for this location.
              </p>
            </div>

            <p style="font-size: 16px; line-height: 1.6;">
              Since you previously paid a $30 permit fee, we're reviewing your account for a potential pro-rated refund.
              We'll be in touch within 1-2 business days.
            </p>

            <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
              Questions? Reply to this email or contact us at support@ticketlessamerica.com
            </p>
          </div>
        `
      });

      return res.status(200).json({
        success: true,
        message: 'Address updated - moved out of permit zone',
        zoneChange: 'exited_zone',
        refundEligible: true
      });
    }

    // No zone change
    return res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      zoneChange: 'none',
      hasPermitZone: newHasZone
    });

  } catch (error: any) {
    console.error('Error updating address:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

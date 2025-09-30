import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getRewardfulAffiliate, createRewardfulAffiliate } from '../../../lib/rewardful-helper';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user already has an affiliate ID
    if (profile.affiliate_id) {
      // Retrieve existing affiliate from Rewardful
      const affiliateData = await getRewardfulAffiliate(profile.affiliate_id);

      if (affiliateData) {
        return res.status(200).json({
          success: true,
          referral_link: affiliateData.links[0]?.url || `https://ticketlessamerica.com?via=${affiliateData.token}`,
          token: affiliateData.token,
          affiliate_id: affiliateData.id,
          earnings: {
            monthly: 2,
            annual: 20,
            currency: 'USD'
          }
        });
      }
    }

    // Create new affiliate in Rewardful
    if (req.method === 'POST') {
      if (!profile.email) {
        return res.status(400).json({ error: 'User email is required' });
      }

      const affiliateData = await createRewardfulAffiliate({
        email: profile.email,
        first_name: profile.first_name || profile.email.split('@')[0],
        last_name: profile.last_name || '',
        campaign_id: process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID,
      });

      if (!affiliateData) {
        return res.status(500).json({
          error: 'Failed to create affiliate account'
        });
      }

      // Save affiliate ID to user profile
      await supabaseAdmin
        .from('user_profiles')
        .update({
          affiliate_id: affiliateData.id,
          affiliate_signup_date: new Date().toISOString()
        })
        .eq('user_id', userId);

      // Send notification emails
      const referralLink = affiliateData.links[0]?.url || `https://ticketlessamerica.com?via=${affiliateData.token}`;

      try {
        // Email to admin
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'noreply@ticketlessamerica.com',
          to: 'ticketlessamerica@gmail.com',
          subject: '🎉 New Affiliate Link Request',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>New Affiliate Link Request</h2>
              <p>A user has requested affiliate access:</p>
              <ul>
                <li><strong>Email:</strong> ${profile.email}</li>
                <li><strong>Name:</strong> ${profile.first_name || ''} ${profile.last_name || ''}</li>
                <li><strong>User ID:</strong> ${userId}</li>
                <li><strong>Affiliate ID:</strong> ${affiliateData.id}</li>
                <li><strong>Referral Link:</strong> <a href="${referralLink}">${referralLink}</a></li>
              </ul>
              <p>They can now share their referral link and earn rewards!</p>
            </div>
          `
        });

        // Email to user
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'noreply@ticketlessamerica.com',
          to: profile.email,
          subject: '🎉 Your Ticketless America Referral Link is Ready!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Your Referral Link is Ready!</h2>
              <p>Thanks for your interest in our referral program! Your unique referral link has been created.</p>

              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0;"><strong>Your Referral Link:</strong></p>
                <p style="margin: 0; font-size: 16px;">
                  <a href="${referralLink}" style="color: #3b82f6; word-break: break-all;">${referralLink}</a>
                </p>
              </div>

              <div style="background: #fff7ed; border: 1px solid #fed7aa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #92400e;">📋 Program Terms:</h3>
                <ul style="margin: 0; padding-left: 20px; color: #78350f; line-height: 1.6;">
                  <li>Earn <strong>$2/month</strong> for each monthly subscriber you refer, as long as they remain subscribed</li>
                  <li>Earn <strong>$20 one-time</strong> for each annual subscriber</li>
                  <li>Rewards are applied as Stripe account credits to reduce your subscription cost</li>
                  <li>If a referred customer cancels, monthly payments will stop</li>
                  <li>Program terms may be modified with notice to participants</li>
                </ul>
              </div>

              <p>You can also find your referral link anytime in your account settings at <a href="https://ticketlessamerica.com/settings">ticketlessamerica.com/settings</a></p>

              <p>Thanks for spreading the word!</p>
              <p>- The Ticketless America Team</p>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send notification emails:', emailError);
        // Don't fail the request if email fails
      }

      return res.status(200).json({
        success: true,
        referral_link: referralLink,
        token: affiliateData.token,
        affiliate_id: affiliateData.id,
        earnings: {
          monthly: 2,
          annual: 20,
          currency: 'USD'
        }
      });
    }

    // GET request but no affiliate exists yet
    return res.status(200).json({
      success: true,
      referral_link: null,
      message: 'No referral link yet. POST to create one.'
    });

  } catch (error: any) {
    console.error('Error handling referral link:', error);
    return res.status(500).json({
      error: 'Failed to process referral link',
      details: error.message
    });
  }
}
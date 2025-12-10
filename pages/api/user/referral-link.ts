import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getRewardfulAffiliate, createRewardfulAffiliate } from '../../../lib/rewardful-helper';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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
      console.error('User profile not found:', {
        userId,
        errorCode: profileError?.code,
        errorMessage: profileError?.message
      });
      return res.status(404).json({
        error: 'User profile not found. Please complete your profile setup first.'
      });
    }

    // Check if user already has an affiliate ID
    if (profile.affiliate_id) {
      // Retrieve existing affiliate from Rewardful
      const affiliateData = await getRewardfulAffiliate(profile.affiliate_id);

      if (affiliateData) {
        const token = affiliateData.links[0]?.token;
        return res.status(200).json({
          success: true,
          referral_link: affiliateData.links[0]?.url || `https://autopilotamerica.com?via=${token}`,
          token: token,
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
        console.error('Missing email for user:', userId);
        return res.status(400).json({ error: 'User email is required' });
      }

      console.log('Creating affiliate for:', {
        email: profile.email,
        first_name: profile.first_name,
        has_campaign_id: !!process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID
      });

      const affiliateParams: any = {
        email: profile.email,
        first_name: profile.first_name || profile.email.split('@')[0],
        last_name: profile.last_name || 'Member', // Rewardful requires non-empty last_name
      };

      // Only add campaign_id if it's configured
      if (process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID) {
        affiliateParams.campaign_id = process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID;
      }

      const affiliateData = await createRewardfulAffiliate(affiliateParams);

      if (!affiliateData) {
        console.error('createRewardfulAffiliate returned null for user:', userId);
        return res.status(500).json({
          error: 'Unable to create referral link at this time. Please try again later or contact support@ticketlessamerica.com for assistance.',
          details: 'Affiliate account creation failed - this may be a temporary issue with our referral system.'
        });
      }

      console.log('Affiliate created successfully:', affiliateData.id);

      // Save affiliate ID to user profile
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          affiliate_id: affiliateData.id,
          affiliate_signup_date: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to save affiliate_id to database:', updateError);
        // Continue anyway - affiliate was created in Rewardful
      } else {
        console.log('Saved affiliate_id to user profile');
      }

      // Send notification emails
      const affiliateToken = affiliateData.links[0]?.token;
      const referralLink = affiliateData.links[0]?.url || `https://autopilotamerica.com?via=${affiliateToken}`;

      try {
        // Email to admin
        await resend.emails.send({
          from: 'Autopilot America <hello@autopilotamerica.com>',
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
          from: 'Autopilot America <hello@autopilotamerica.com>',
          to: profile.email,
          subject: '🎉 Your Autopilot America Referral Link is Ready!',
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
                  <li>Share your link with friends who might benefit from Ticketless</li>
                  <li>Your referral credit lasts <strong>60 days</strong> after someone clicks your link</li>
                  <li>Earn <strong>$2/month</strong> for each monthly subscriber you refer, as long as they remain subscribed</li>
                  <li>Earn <strong>$20 one-time</strong> for each annual subscriber</li>
                  <li>Rewards are paid out monthly via PayPal or bank transfer</li>
                  <li>If a referred customer cancels, monthly payments will stop</li>
                  <li>Program terms may be modified with notice to participants</li>
                </ul>
              </div>

              <p>You can also find your referral link anytime in your account settings at <a href="https://ticketlessamerica.com/settings">ticketlessamerica.com/settings</a></p>

              <p>Thanks for spreading the word!</p>
              <p>- The Autopilot America Team</p>
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
        token: affiliateToken,
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
    console.error('Error stack:', error.stack);
    console.error('Request details:', {
      method: req.method,
      userId: req.query.userId,
      hasRewardfulKey: !!process.env.REWARDFUL_API_SECRET
    });
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
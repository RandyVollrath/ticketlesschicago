import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getRewardfulAffiliate, createRewardfulAffiliate } from '../../../lib/rewardful-helper';

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
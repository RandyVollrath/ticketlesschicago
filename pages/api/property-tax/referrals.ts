/**
 * Property Tax Referral Program API
 *
 * Endpoints:
 * GET /api/property-tax/referrals - Get user's referral code and stats
 * POST /api/property-tax/referrals/generate - Generate a referral code for eligible users
 * POST /api/property-tax/referrals/track - Track a referral click/signup
 * GET /api/property-tax/referrals/earnings - Get earnings history
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import crypto from 'crypto';

// Generate a unique, readable referral code
function generateReferralCode(): string {
  // Format: SAVE-XXXX-XXXX (easy to share)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars
  const segment = () => {
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };
  return `SAVE-${segment()}-${segment()}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get authenticated user
  let userId: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    userId = user?.id || null;
  }

  // GET - Get user's referral code and stats
  if (req.method === 'GET') {
    if (req.query.action === 'earnings') {
      // Get earnings history
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { data: earnings, error } = await supabaseAdmin
        .from('property_tax_referral_earnings')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching earnings:', error);
        return res.status(500).json({ error: 'Failed to fetch earnings' });
      }

      // Calculate totals
      const totalEarned = earnings
        ?.filter(e => e.type === 'earned')
        .reduce((sum, e) => sum + e.amount_cents, 0) || 0;
      const totalPaidOut = earnings
        ?.filter(e => e.type === 'paid_out')
        .reduce((sum, e) => sum + Math.abs(e.amount_cents), 0) || 0;

      return res.status(200).json({
        earnings,
        summary: {
          totalEarned: totalEarned / 100,
          totalPaidOut: totalPaidOut / 100,
          balance: (totalEarned - totalPaidOut) / 100
        }
      });
    }

    // Get referral code and stats
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: referralCode, error } = await supabaseAdmin
      .from('property_tax_referral_codes')
      .select(`
        *,
        referrals:property_tax_referrals(
          id,
          status,
          created_at,
          converted_at,
          reward_amount_cents
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching referral code:', error);
      return res.status(500).json({ error: 'Failed to fetch referral data' });
    }

    if (!referralCode) {
      // Check if user is eligible (has a successful appeal)
      const { data: successfulAppeal } = await supabaseAdmin
        .from('property_tax_appeals')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'letter_generated')
        .limit(1)
        .single();

      return res.status(200).json({
        hasReferralCode: false,
        isEligible: !!successfulAppeal,
        eligibilityReason: successfulAppeal
          ? 'You have a completed appeal and can generate a referral code!'
          : 'Complete a property tax appeal to unlock your referral code.'
      });
    }

    // Calculate stats
    const referrals = referralCode.referrals || [];
    const stats = {
      totalClicks: referrals.length,
      signups: referrals.filter((r: any) => r.status !== 'clicked').length,
      conversions: referrals.filter((r: any) => r.status === 'converted' || r.status === 'paid_out').length,
      pendingEarnings: referrals
        .filter((r: any) => r.status === 'converted')
        .reduce((sum: number, r: any) => sum + (r.reward_amount_cents || 0), 0) / 100,
      paidEarnings: referralCode.total_earnings_cents / 100
    };

    return res.status(200).json({
      hasReferralCode: true,
      code: referralCode.code,
      shareUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com'}/property-tax?ref=${referralCode.code}`,
      rewardAmount: referralCode.reward_amount_cents / 100,
      rewardType: referralCode.reward_type,
      stats,
      createdAt: referralCode.created_at
    });
  }

  // POST - Generate code or track referral
  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'generate') {
      // Generate a new referral code
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check if user already has a code
      const { data: existingCode } = await supabaseAdmin
        .from('property_tax_referral_codes')
        .select('code')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (existingCode) {
        return res.status(400).json({
          error: 'You already have a referral code',
          code: existingCode.code
        });
      }

      // Check eligibility - must have completed an appeal
      const { data: successfulAppeal } = await supabaseAdmin
        .from('property_tax_appeals')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'letter_generated')
        .limit(1)
        .single();

      if (!successfulAppeal) {
        return res.status(403).json({
          error: 'Not eligible',
          message: 'You must complete a property tax appeal before you can refer others.'
        });
      }

      // Generate unique code
      let code = generateReferralCode();
      let attempts = 0;
      while (attempts < 10) {
        const { data: existsCheck } = await supabaseAdmin
          .from('property_tax_referral_codes')
          .select('id')
          .eq('code', code)
          .single();

        if (!existsCheck) break;
        code = generateReferralCode();
        attempts++;
      }

      // Create the referral code
      const { data: newCode, error } = await supabaseAdmin
        .from('property_tax_referral_codes')
        .insert({
          user_id: userId,
          code,
          qualifying_appeal_id: successfulAppeal.id,
          reward_type: 'credit',
          reward_amount_cents: 2500 // $25 per successful referral
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating referral code:', error);
        return res.status(500).json({ error: 'Failed to create referral code' });
      }

      return res.status(200).json({
        success: true,
        code: newCode.code,
        shareUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com'}/property-tax?ref=${newCode.code}`,
        rewardAmount: 25,
        message: 'Share your code and earn $25 for each friend who completes an appeal!'
      });
    }

    if (action === 'track') {
      // Track a referral click or signup
      const { code, email, event } = req.body;

      if (!code) {
        return res.status(400).json({ error: 'Referral code required' });
      }

      // Find the referral code
      const { data: referralCode } = await supabaseAdmin
        .from('property_tax_referral_codes')
        .select('id, user_id, reward_amount_cents')
        .eq('code', code.toUpperCase())
        .eq('is_active', true)
        .single();

      if (!referralCode) {
        return res.status(404).json({ error: 'Invalid referral code' });
      }

      // Don't let users refer themselves
      if (userId && userId === referralCode.user_id) {
        return res.status(400).json({ error: 'Cannot use your own referral code' });
      }

      if (event === 'click') {
        // Record the click
        await supabaseAdmin
          .from('property_tax_referrals')
          .insert({
            referral_code_id: referralCode.id,
            referred_user_id: userId,
            referred_email: email,
            status: 'clicked'
          });

        // Update total referrals count
        await supabaseAdmin
          .from('property_tax_referral_codes')
          .update({
            total_referrals: supabaseAdmin.rpc('increment', { row_id: referralCode.id, increment_amount: 1 }),
            updated_at: new Date().toISOString()
          })
          .eq('id', referralCode.id);

        return res.status(200).json({ success: true, tracked: 'click' });
      }

      if (event === 'signup' && email) {
        // Update existing click record or create new
        const { data: existingReferral } = await supabaseAdmin
          .from('property_tax_referrals')
          .select('id')
          .eq('referral_code_id', referralCode.id)
          .eq('referred_email', email)
          .single();

        if (existingReferral) {
          await supabaseAdmin
            .from('property_tax_referrals')
            .update({
              status: 'signed_up',
              referred_user_id: userId
            })
            .eq('id', existingReferral.id);
        } else {
          await supabaseAdmin
            .from('property_tax_referrals')
            .insert({
              referral_code_id: referralCode.id,
              referred_user_id: userId,
              referred_email: email,
              status: 'signed_up'
            });
        }

        return res.status(200).json({ success: true, tracked: 'signup' });
      }

      if (event === 'converted' && userId) {
        // Mark as converted when they complete an appeal
        const { data: appealData } = req.body;

        const { data: existingReferral } = await supabaseAdmin
          .from('property_tax_referrals')
          .select('id')
          .eq('referral_code_id', referralCode.id)
          .eq('referred_user_id', userId)
          .single();

        if (existingReferral) {
          await supabaseAdmin
            .from('property_tax_referrals')
            .update({
              status: 'converted',
              appeal_id: appealData?.appealId,
              converted_at: new Date().toISOString(),
              reward_amount_cents: referralCode.reward_amount_cents
            })
            .eq('id', existingReferral.id);

          // Credit the referrer
          await supabaseAdmin
            .from('property_tax_referral_earnings')
            .insert({
              user_id: referralCode.user_id,
              referral_id: existingReferral.id,
              amount_cents: referralCode.reward_amount_cents,
              type: 'earned',
              description: `Referral conversion - new user completed appeal`
            });

          // Update conversion count
          await supabaseAdmin
            .from('property_tax_referral_codes')
            .update({
              total_conversions: supabaseAdmin.rpc('increment', { row_id: referralCode.id, increment_amount: 1 }),
              total_earnings_cents: supabaseAdmin.rpc('increment', { row_id: referralCode.id, increment_amount: referralCode.reward_amount_cents }),
              updated_at: new Date().toISOString()
            })
            .eq('id', referralCode.id);
        }

        return res.status(200).json({ success: true, tracked: 'converted' });
      }

      return res.status(400).json({ error: 'Invalid event type' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

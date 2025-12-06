/**
 * Admin API for Renewal Management
 *
 * GET /api/admin/renewals - Fetch all renewal data for admin dashboard
 * POST /api/admin/renewals - Confirm city payment / update status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

interface RenewalCharge {
  id: string;
  user_id: string;
  charge_type: string;
  amount: number;
  status: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  failure_reason: string | null;
  failure_code: string | null;
  remitter_partner_id: string | null;
  remitter_received_amount: number | null;
  platform_fee_amount: number | null;
  renewal_type: string;
  renewal_due_date: string;
  succeeded_at: string | null;
  failed_at: string | null;
  created_at: string;
  // Joined fields
  user_email?: string;
  user_name?: string;
  license_plate?: string;
  phone?: string;
  street_address?: string;
  city_payment_status?: string;
  city_confirmation_number?: string;
}

interface RenewalOrder {
  id: string;
  order_number: string;
  partner_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  license_plate: string;
  street_address: string;
  sticker_type: string;
  sticker_price: number;
  service_fee: number;
  total_amount: number;
  payment_status: string;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
  // Joined
  partner_name?: string;
}

interface DashboardStats {
  totalCharges: number;
  succeededCharges: number;
  failedCharges: number;
  blockedCharges: number;
  pendingCityPayment: number;
  confirmedCityPayment: number;
  totalRevenue: number;
  remitterPayout: number;
  platformFees: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check admin authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_API_TOKEN || 'ticketless2025admin';
  if (token !== adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get filter parameters
    const { status, type, days } = req.query;
    const daysBack = parseInt(days as string) || 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // 1. Fetch renewal_charges with user info
    let chargesQuery = supabaseAdmin!
      .from('renewal_charges')
      .select('*')
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      chargesQuery = chargesQuery.eq('status', status);
    }
    if (type && type !== 'all') {
      chargesQuery = chargesQuery.eq('renewal_type', type);
    }

    const { data: charges, error: chargesError } = await chargesQuery;

    if (chargesError) {
      console.error('Error fetching charges:', chargesError);
      throw chargesError;
    }

    // Get user IDs to fetch profile data
    const userIds = [...new Set((charges || []).map(c => c.user_id))];

    // Fetch user profiles
    const { data: profiles } = await supabaseAdmin!
      .from('user_profiles')
      .select('user_id, first_name, last_name, license_plate, phone, street_address')
      .in('user_id', userIds);

    // Fetch user emails from users table
    const { data: users } = await supabaseAdmin!
      .from('users')
      .select('id, email')
      .in('id', userIds);

    // Create maps
    const profileMap = new Map();
    profiles?.forEach(p => profileMap.set(p.user_id, p));

    const userMap = new Map();
    users?.forEach(u => userMap.set(u.id, u));

    // 2. Fetch renewal_payments for city payment status
    const { data: payments } = await supabaseAdmin!
      .from('renewal_payments')
      .select('*')
      .in('user_id', userIds);

    const paymentMap = new Map();
    payments?.forEach(p => paymentMap.set(`${p.user_id}-${p.renewal_type}-${p.due_date}`, p));

    // Enrich charges with user data and city payment status
    const enrichedCharges: RenewalCharge[] = (charges || []).map(charge => {
      const profile = profileMap.get(charge.user_id);
      const user = userMap.get(charge.user_id);
      const paymentKey = `${charge.user_id}-${charge.renewal_type}-${charge.renewal_due_date}`;
      const payment = paymentMap.get(paymentKey);

      return {
        ...charge,
        user_email: user?.email || 'Unknown',
        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown' : 'Unknown',
        license_plate: profile?.license_plate || 'Unknown',
        phone: profile?.phone || '',
        street_address: profile?.street_address || '',
        city_payment_status: payment?.city_payment_status || 'pending',
        city_confirmation_number: payment?.city_confirmation_number || null,
      };
    });

    // 3. Fetch renewal_orders
    const { data: orders, error: ordersError } = await supabaseAdmin!
      .from('renewal_orders')
      .select('*')
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('Error fetching orders:', ordersError);
    }

    // Fetch partner names
    const partnerIds = [...new Set((orders || []).map(o => o.partner_id))];
    const { data: partners } = await supabaseAdmin!
      .from('renewal_partners')
      .select('id, name')
      .in('id', partnerIds);

    const partnerMap = new Map();
    partners?.forEach(p => partnerMap.set(p.id, p.name));

    const enrichedOrders: RenewalOrder[] = (orders || []).map(order => ({
      ...order,
      partner_name: partnerMap.get(order.partner_id) || 'Unknown',
    }));

    // 4. Calculate stats
    const stats: DashboardStats = {
      totalCharges: enrichedCharges.length,
      succeededCharges: enrichedCharges.filter(c => c.status === 'succeeded').length,
      failedCharges: enrichedCharges.filter(c => c.status === 'failed').length,
      blockedCharges: enrichedCharges.filter(c => c.status === 'blocked').length,
      pendingCityPayment: enrichedCharges.filter(c => c.status === 'succeeded' && c.city_payment_status === 'pending').length,
      confirmedCityPayment: enrichedCharges.filter(c => c.city_payment_status === 'paid').length,
      totalRevenue: enrichedCharges.filter(c => c.status === 'succeeded').reduce((sum, c) => sum + (c.amount || 0), 0),
      remitterPayout: enrichedCharges.filter(c => c.status === 'succeeded').reduce((sum, c) => sum + (c.remitter_received_amount || 0), 0),
      platformFees: enrichedCharges.filter(c => c.status === 'succeeded').reduce((sum, c) => sum + (c.platform_fee_amount || 0), 0),
    };

    // 5. Fetch active remitters
    const { data: remitters } = await supabaseAdmin!
      .from('renewal_partners')
      .select('id, name, email, stripe_connected_account_id, stripe_account_status, payout_enabled, status')
      .eq('status', 'active');

    return res.status(200).json({
      success: true,
      charges: enrichedCharges,
      orders: enrichedOrders,
      remitters: remitters || [],
      stats,
    });

  } catch (error: any) {
    console.error('Error in admin renewals GET:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { action, userId, renewalType, dueDate, confirmationNumber, notes } = req.body;

    if (action === 'confirm_city_payment') {
      // Confirm that city payment was made
      if (!userId || !renewalType || !dueDate) {
        return res.status(400).json({
          success: false,
          error: 'userId, renewalType, and dueDate are required',
        });
      }

      // Check if renewal_payments record exists
      const { data: existingPayment } = await supabaseAdmin!
        .from('renewal_payments')
        .select('*')
        .eq('user_id', userId)
        .eq('renewal_type', renewalType)
        .eq('due_date', dueDate)
        .maybeSingle();

      if (existingPayment) {
        // Update existing record
        const { error: updateError } = await supabaseAdmin!
          .from('renewal_payments')
          .update({
            city_payment_status: 'paid',
            city_confirmation_number: confirmationNumber || null,
            metadata: {
              ...existingPayment.metadata,
              admin_confirmed_at: new Date().toISOString(),
              admin_notes: notes || null,
            },
          })
          .eq('id', existingPayment.id);

        if (updateError) throw updateError;
      } else {
        // Create new record
        const { error: insertError } = await supabaseAdmin!
          .from('renewal_payments')
          .insert({
            user_id: userId,
            renewal_type: renewalType,
            due_date: dueDate,
            payment_status: 'paid',
            city_payment_status: 'paid',
            city_confirmation_number: confirmationNumber || null,
            metadata: {
              admin_confirmed_at: new Date().toISOString(),
              admin_notes: notes || null,
            },
          });

        if (insertError) throw insertError;
      }

      // Update user profile expiry to next year
      const currentDueDate = new Date(dueDate);
      const nextYearDate = new Date(currentDueDate);
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
      const nextYearStr = nextYearDate.toISOString().split('T')[0];

      const expiryField = renewalType === 'city_sticker' ? 'city_sticker_expiry' : 'license_plate_expiry';

      await supabaseAdmin!
        .from('user_profiles')
        .update({ [expiryField]: nextYearStr })
        .eq('user_id', userId);

      // Send confirmation email to user
      const { data: userData } = await supabaseAdmin!
        .from('user_profiles')
        .select('email, first_name')
        .eq('user_id', userId)
        .single();

      if (userData?.email && process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Autopilot America <alerts@autopilotamerica.com>',
              to: [userData.email],
              subject: `Your ${renewalType === 'city_sticker' ? 'City Sticker' : 'License Plate'} Renewal is Complete!`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">Renewal Complete!</h1>
                  </div>
                  <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                    <p>Hi ${userData.first_name || 'there'},</p>
                    <p>Great news! Your ${renewalType === 'city_sticker' ? 'Chicago city sticker' : 'license plate'} renewal has been submitted to the city.</p>
                    ${confirmationNumber ? `<p><strong>Confirmation Number:</strong> ${confirmationNumber}</p>` : ''}
                    <p><strong>New Expiration:</strong> ${nextYearStr}</p>
                    <p>Your new sticker will be mailed to your address on file. If you need to update your mailing address, please contact us.</p>
                    <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                      Questions? Reply to this email or contact support@autopilotamerica.com
                    </p>
                  </div>
                </div>
              `,
            }),
          });
          console.log(`Sent renewal confirmation email to ${userData.email}`);
        } catch (emailError) {
          console.error('Failed to send confirmation email:', emailError);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'City payment confirmed',
        newExpiry: nextYearStr,
      });

    } else if (action === 'retry_charge') {
      // Retry a failed charge
      // TODO: Implement retry logic
      return res.status(501).json({
        success: false,
        error: 'Retry not yet implemented',
      });

    } else if (action === 'send_reminder') {
      // Send reminder to user about failed payment
      const { userId: remindUserId } = req.body;

      const { data: userData } = await supabaseAdmin!
        .from('user_profiles')
        .select('email, first_name')
        .eq('user_id', remindUserId)
        .single();

      if (!userData?.email) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (process.env.RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: [userData.email],
            subject: 'Action Required: Update Your Payment Method',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 24px;">Payment Update Needed</h1>
                </div>
                <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                  <p>Hi ${userData.first_name || 'there'},</p>
                  <p>We tried to process your automatic renewal, but there was an issue with your payment method.</p>
                  <p>To ensure your renewal is completed on time, please:</p>
                  <ol>
                    <li>Log in to your account at <a href="https://ticketlesschicago.com/settings">ticketlesschicago.com/settings</a></li>
                    <li>Update your payment method</li>
                    <li>We'll automatically retry the renewal</li>
                  </ol>
                  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                    Need help? Reply to this email or contact support@autopilotamerica.com
                  </p>
                </div>
              </div>
            `,
          }),
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Reminder sent',
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid action',
    });

  } catch (error: any) {
    console.error('Error in admin renewals POST:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

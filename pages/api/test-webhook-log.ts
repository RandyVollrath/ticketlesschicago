import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check recent webhook logs (if you have a logs table)
    // For now, let's check recent users and vehicles to see if webhooks are working
    
    const { data: recentUsers } = await supabaseAdmin
      .from('users')
      .select('id, email, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    const { data: recentVehicles } = await supabaseAdmin
      .from('vehicles')
      .select('id, user_id, license_plate, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    const { data: recentReminders } = await supabaseAdmin
      .from('vehicle_reminders')
      .select('id, email, license_plate, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    res.status(200).json({
      message: 'Webhook activity check',
      recentUsers: recentUsers || [],
      recentVehicles: recentVehicles || [],
      recentReminders: recentReminders || [],
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
      environment: process.env.NODE_ENV
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
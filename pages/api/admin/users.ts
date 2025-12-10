import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin client not available' });
    }

    // Get vehicle reminders
    const { data: vehicleReminders, error: vehicleError } = await supabaseAdmin
      .from('vehicle_reminders')
      .select('*')
      .order('created_at', { ascending: false });

    console.log('Vehicle reminders query:', { vehicleReminders, vehicleError });

    if (vehicleError) {
      console.error('Vehicle reminders error:', vehicleError);
    }

    // Also get auth users for comparison
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    console.log('Auth users query:', { 
      userCount: authData?.users?.length || 0, 
      authError 
    });

    // Map auth users with their details
    const authUsers = authData?.users?.map(user => ({
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at
    })) || [];

    return res.status(200).json({
      success: true,
      vehicleReminders: vehicleReminders || [],
      authUsers: authUsers,
      authUsersCount: authData?.users?.length || 0,
      errors: {
        vehicleError: vehicleError?.message || null,
        authError: authError?.message || null
      }
    });

  } catch (error: any) {
    console.error('Admin users API error:', error);
    return res.status(500).json({ error: error.message });
  }
});
import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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
      .order('created_at', { ascending: false })
      .limit(1000);

    console.log('Vehicle reminders query:', { vehicleReminders, vehicleError });

    if (vehicleError) {
      console.error('Vehicle reminders error:', vehicleError);
    }

    // Fetch auth users in pages (Supabase defaults to 50 per page)
    let allUsers: any[] = [];
    let page = 1;
    let authError: any = null;
    const perPage = 100;

    while (true) {
      const { data: pageData, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });

      if (pageError) {
        authError = pageError;
        break;
      }

      if (!pageData?.users?.length) break;

      allUsers = allUsers.concat(pageData.users);

      // If we got fewer than perPage, we've reached the last page
      if (pageData.users.length < perPage) break;
      page++;
    }

    console.log('Auth users query:', {
      userCount: allUsers.length,
      pages: page,
      authError,
    });

    // Map auth users with their details
    const authUsers = allUsers.map(user => ({
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at
    }));

    return res.status(200).json({
      success: true,
      vehicleReminders: vehicleReminders || [],
      authUsers: authUsers,
      authUsersCount: allUsers.length,
      errors: {
        vehicleError: vehicleError?.message || null,
        authError: authError?.message || null
      }
    });

  } catch (error: any) {
    console.error('Admin users API error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
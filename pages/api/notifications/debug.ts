import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';

// Admin emails that can access this debug endpoint
const ADMIN_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export default withAdminAuth(async (
  req: NextApiRequest,
  res: NextApiResponse,
  adminUser: any
) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Email to diagnose - use the admin's email if not specified
  const { email } = req.body;
  const targetEmail = email || adminUser?.email;

  try {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      checks: {}
    };

    // 1. Check environment variables (without exposing values)
    diagnostics.checks.environment = {
      hasClickSendUsername: !!process.env.CLICKSEND_USERNAME,
      hasClickSendApiKey: !!process.env.CLICKSEND_API_KEY,
      hasResendApiKey: !!process.env.RESEND_API_KEY,
      hasResendFrom: !!process.env.RESEND_FROM,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hasSupabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      resendFrom: process.env.RESEND_FROM || 'not set'
    };

    // 2. Check if we can connect to Supabase
    diagnostics.checks.database = {
      canConnect: false,
      error: null
    };

    try {
      const { count, error } = await supabaseAdmin
        .from('user_profiles')
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        diagnostics.checks.database.error = error.message;
      } else {
        diagnostics.checks.database.canConnect = true;
        diagnostics.checks.database.userProfilesCount = count;
      }
    } catch (dbError: any) {
      diagnostics.checks.database.error = dbError.message;
    }

    // 3. Check target user's data in user_profiles
    diagnostics.checks.userData = {
      targetEmail: targetEmail,
      found: false,
      hasPhoneNumber: false,
      hasCityStickerExpiry: false,
      hasLicensePlateExpiry: false,
      hasEmissionsDate: false,
      hasNotificationPrefs: false,
      hasStreetCleaningData: false,
      daysUntilRenewals: {}
    };

    try {
      const { data: userData, error: userError } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('email', targetEmail)
        .maybeSingle();

      if (!userError && userData) {
        diagnostics.checks.userData.found = true;
        diagnostics.checks.userData.hasPhoneNumber = !!userData.phone_number;
        diagnostics.checks.userData.hasCityStickerExpiry = !!userData.city_sticker_expiry;
        diagnostics.checks.userData.hasLicensePlateExpiry = !!userData.license_plate_expiry;
        diagnostics.checks.userData.hasEmissionsDate = !!userData.emissions_date;
        diagnostics.checks.userData.hasNotificationPrefs = !!userData.notification_preferences;
        diagnostics.checks.userData.hasStreetCleaningData = !!(userData.home_address_ward && userData.home_address_section);
        
        // Calculate days until renewals
        const today = new Date();
        if (userData.city_sticker_expiry) {
          const dueDate = new Date(userData.city_sticker_expiry);
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          diagnostics.checks.userData.daysUntilRenewals.citySticker = daysUntil;
        }
        if (userData.license_plate_expiry) {
          const dueDate = new Date(userData.license_plate_expiry);
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          diagnostics.checks.userData.daysUntilRenewals.licensePlate = daysUntil;
        }
        if (userData.emissions_date) {
          const dueDate = new Date(userData.emissions_date);
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          diagnostics.checks.userData.daysUntilRenewals.emissions = daysUntil;
        }
        
        // Check notification preferences
        if (userData.notification_preferences) {
          diagnostics.checks.userData.notificationPrefs = userData.notification_preferences;
        }
      } else if (userError) {
        diagnostics.checks.userData.error = userError.message;
      }
    } catch (userError: any) {
      diagnostics.checks.userData.error = userError.message;
    }

    // 4. Check if users table exists and has data (old table)
    diagnostics.checks.oldUsersTable = {
      found: false,
      error: null
    };

    try {
      const { data: oldUserData, error: oldUserError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('email', targetEmail)
        .maybeSingle();

      if (!oldUserError && oldUserData) {
        diagnostics.checks.oldUsersTable.found = true;
        diagnostics.checks.oldUsersTable.hasData = {
          phone: !!oldUserData.phone,
          cityStickerExpiry: !!oldUserData.city_sticker_expiry,
          licensePlateExpiry: !!oldUserData.license_plate_expiry,
          emissionsDate: !!oldUserData.emissions_date
        };
      } else if (oldUserError) {
        diagnostics.checks.oldUsersTable.error = oldUserError.message;
      }
    } catch (oldError: any) {
      diagnostics.checks.oldUsersTable.error = oldError.message;
    }

    // 5. Test notification service connectivity
    diagnostics.checks.notificationServices = {
      clickSend: {
        configured: !!(process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY),
        canMakeSMS: false,
        canMakeVoice: false
      },
      resend: {
        configured: !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
        canSendEmail: false
      }
    };

    // Provide diagnosis
    diagnostics.diagnosis = [];
    
    if (!diagnostics.checks.database.canConnect) {
      diagnostics.diagnosis.push('❌ Cannot connect to database - check SUPABASE_SERVICE_ROLE_KEY in Vercel');
    }
    
    if (!diagnostics.checks.userData.found) {
      if (diagnostics.checks.oldUsersTable.found) {
        diagnostics.diagnosis.push('⚠️ User found in OLD users table but not in user_profiles - data migration needed');
      } else {
        diagnostics.diagnosis.push('❌ User not found in either table');
      }
    } else {
      if (!diagnostics.checks.userData.hasPhoneNumber) {
        diagnostics.diagnosis.push('⚠️ No phone number set - SMS/Voice won\'t work');
      }
      if (!diagnostics.checks.userData.hasCityStickerExpiry && 
          !diagnostics.checks.userData.hasLicensePlateExpiry && 
          !diagnostics.checks.userData.hasEmissionsDate) {
        diagnostics.diagnosis.push('⚠️ No renewal dates set - no notifications will trigger');
      }
    }
    
    if (!diagnostics.checks.environment.hasClickSendUsername || !diagnostics.checks.environment.hasClickSendApiKey) {
      diagnostics.diagnosis.push('⚠️ ClickSend not configured - SMS/Voice won\'t send');
    }
    
    if (!diagnostics.checks.environment.hasResendApiKey || !diagnostics.checks.environment.hasResendFrom) {
      diagnostics.diagnosis.push('⚠️ Resend not configured - Emails won\'t send');
    }

    res.status(200).json(diagnostics);
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      error: 'Failed to run diagnostics',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
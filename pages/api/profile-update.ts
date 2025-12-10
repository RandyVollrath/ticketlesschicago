import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { maskEmail, maskUserId } from '../../lib/mask-pii';

// Input validation schema for profile updates
const profileUpdateSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  email: z.string().email('Invalid email format').max(255),
  updates: z.object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    phone: z.string().max(20).optional().nullable(),
    phone_number: z.string().max(20).optional().nullable(),
    street_address: z.string().max(500).optional().nullable(),
    home_address_full: z.string().max(500).optional().nullable(),
    home_address_ward: z.string().max(10).optional().nullable(),
    home_address_section: z.string().max(10).optional().nullable(),
    license_plate: z.string().max(10).regex(/^[A-Z0-9\-\s]*$/i, 'Invalid license plate').optional().nullable(),
    city_sticker_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
    license_plate_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
    emissions_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
    notify_email: z.boolean().optional(),
    notify_sms: z.boolean().optional(),
    notify_push: z.boolean().optional(),
    notification_preferences: z.record(z.boolean()).optional(),
    vin: z.string().max(17).optional().nullable(),
    vehicle_make: z.string().max(50).optional().nullable(),
    vehicle_model: z.string().max(50).optional().nullable(),
    vehicle_year: z.number().int().min(1900).max(2100).optional().nullable(),
    vehicle_color: z.string().max(30).optional().nullable(),
  }).strict(), // Reject unknown fields
});

// Normalize phone number to E.164 format (+1XXXXXXXXXX)
function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+1${digits.slice(-10)}` : null;
}

// Connect to MyStreetCleaning database
function getMSCClient() {
  const url = process.env.MSC_SUPABASE_URL;
  const key = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    console.error('❌ Missing MSC credentials');
    return null;
  }
  
  return createClient(url, key);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate request body
  const parseResult = profileUpdateSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    console.warn('Profile update validation failed:', errors);
    return res.status(400).json({
      error: 'Validation failed',
      details: errors,
    });
  }

  try {
    const { userId, email, updates } = parseResult.data;

    console.log(`Profile update for user ${maskUserId(userId)} (${maskEmail(email)})`);

    // Normalize phone number if present
    if (updates.phone_number) {
      updates.phone_number = normalizePhoneNumber(updates.phone_number);
    }
    if (updates.phone) {
      updates.phone = normalizePhoneNumber(updates.phone);
    }

    // Update TicketlessAmerica profile
    const { data: profile, error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();
      
    if (updateError) {
      throw updateError;
    }
    
    // CRITICAL: Sync to MyStreetCleaning whenever address/ward/section changes
    const addressFields = ['home_address_full', 'home_address_ward', 'home_address_section'];
    const hasAddressChange = addressFields.some(field => field in updates);
    
    if (hasAddressChange || updates.notification_preferences) {
      console.log('🔄 Syncing to MyStreetCleaning...');
      
      const mscClient = getMSCClient();
      if (mscClient) {
        // Map TicketlessAmerica fields to MyStreetCleaning fields
        const mscUpdates: any = {
          email: email,
          updated_at: new Date().toISOString()
        };
        
        // Address fields
        if (updates.home_address_full) mscUpdates.home_address_full = updates.home_address_full;
        if (updates.home_address_ward) mscUpdates.home_address_ward = updates.home_address_ward;
        if (updates.home_address_section) mscUpdates.home_address_section = updates.home_address_section;
        
        // Phone number
        if (updates.phone_number) {
          mscUpdates.phone_number = updates.phone_number;
          mscUpdates.phone = updates.phone_number; // Some fields use 'phone'
        }
        
        // Notification preferences
        if (updates.notification_preferences) {
          const prefs = updates.notification_preferences;
          if (prefs.sms !== undefined) mscUpdates.notify_sms = prefs.sms;
          if (prefs.email !== undefined) mscUpdates.notify_email = prefs.email;
          if (prefs.voice !== undefined) {
            mscUpdates.voice_calls_enabled = prefs.voice;
            mscUpdates.phone_call_enabled = prefs.voice;
          }
          if (prefs.reminder_days) {
            mscUpdates.notify_days_array = prefs.reminder_days;
            // Also set the primary day
            mscUpdates.notify_days_before = prefs.reminder_days[0] || 1;
          }
        }
        
        // Street cleaning specific settings
        if (updates.notify_evening_before !== undefined) {
          mscUpdates.notify_evening_before = updates.notify_evening_before;
        }
        if (updates.follow_up_sms !== undefined) {
          mscUpdates.follow_up_sms = updates.follow_up_sms;
        }
        
        // Check if user exists in MSC
        const { data: existingMSC } = await mscClient
          .from('user_profiles')
          .select('user_id')
          .eq('email', email)
          .single();
          
        if (existingMSC) {
          // Update existing MSC profile
          const { error: mscError } = await mscClient
            .from('user_profiles')
            .update(mscUpdates)
            .eq('email', email);
            
          if (mscError) {
            console.error('❌ MSC sync error:', mscError);
          } else {
            console.log('✅ MSC profile updated');
          }
        } else {
          // Create new MSC profile
          mscUpdates.user_id = crypto.randomUUID();
          mscUpdates.created_at = new Date().toISOString();
          mscUpdates.role = 'ticketless_user';
          
          const { error: mscError } = await mscClient
            .from('user_profiles')
            .insert(mscUpdates);
            
          if (mscError) {
            console.error('❌ MSC create error:', mscError);
          } else {
            console.log('✅ MSC profile created');
          }
        }
      }
    }
    
    res.status(200).json({ 
      success: true, 
      profile,
      synced: hasAddressChange 
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      error: 'Failed to update profile',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
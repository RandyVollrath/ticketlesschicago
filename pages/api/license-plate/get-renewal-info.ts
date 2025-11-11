/**
 * Get License Plate Renewal Information (REMITTER USE ONLY)
 *
 * Retrieves license plate renewal details for remitter to submit to Illinois Secretary of State.
 * Returns renewal cost, plate type, expiration date, and vehicle details.
 *
 * IMPORTANT: Updates license_plate_last_accessed_at timestamp.
 * Similar to driver's license endpoint - tracks access for deletion purposes.
 *
 * REMITTER MUST: Only call this when actively submitting renewal to state.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user profile with license plate renewal details
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select(`
        license_plate,
        license_state,
        license_plate_expiry,
        license_plate_type,
        license_plate_is_personalized,
        license_plate_is_vanity,
        license_plate_renewal_cost,
        vehicle_type,
        vehicle_year,
        vin,
        trailer_weight,
        rv_weight,
        has_protection,
        first_name,
        last_name,
        mailing_address,
        mailing_city,
        mailing_state,
        mailing_zip
      `)
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has protection
    if (!profile.has_protection) {
      return res.status(400).json({
        error: 'User does not have protection service',
      });
    }

    // Check if license plate exists
    if (!profile.license_plate) {
      return res.status(404).json({
        error: 'No license plate on file',
        message: 'User has not provided their license plate number',
      });
    }

    // Check if license plate expiry exists
    if (!profile.license_plate_expiry) {
      return res.status(404).json({
        error: 'No license plate expiry date on file',
        message: 'User has not provided their license plate expiration date',
      });
    }

    // Check if plate has expired already
    const expiryDate = new Date(profile.license_plate_expiry);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < -30) {
      return res.status(400).json({
        error: 'License plate expired over 30 days ago',
        message: 'Plate expired on ' + profile.license_plate_expiry,
        expiryDate: profile.license_plate_expiry,
      });
    }

    // ⚠️ IMPORTANT: Update last accessed timestamp
    // This can trigger 48h deletion countdown for sensitive data
    await supabase
      .from('user_profiles')
      .update({
        license_plate_last_accessed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    console.log(`⚠️ REMITTER ACCESS: License plate renewal info accessed for user ${userId}`);
    console.log(`  - Plate: ${profile.license_plate} (${profile.license_state || 'IL'})`);
    console.log(`  - Type: ${profile.license_plate_type || 'PASSENGER'}`);
    console.log(`  - Cost: $${profile.license_plate_renewal_cost || '151.00'}`);
    console.log(`  - Expires: ${profile.license_plate_expiry}`);
    console.log(`  - Days until expiry: ${daysUntilExpiry}`);

    return res.status(200).json({
      success: true,
      renewalInfo: {
        licensePlate: profile.license_plate,
        licenseState: profile.license_state || 'IL',
        expiryDate: profile.license_plate_expiry,
        daysUntilExpiry,
        plateType: profile.license_plate_type || 'PASSENGER',
        isPersonalized: profile.license_plate_is_personalized || false,
        isVanity: profile.license_plate_is_vanity || false,
        renewalCost: profile.license_plate_renewal_cost || 151.00,
        trailerWeight: profile.trailer_weight,
        rvWeight: profile.rv_weight,
      },
      vehicleInfo: {
        type: profile.vehicle_type,
        year: profile.vehicle_year,
        vin: profile.vin,
      },
      mailingAddress: {
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
        street: profile.mailing_address,
        city: profile.mailing_city,
        state: profile.mailing_state,
        zip: profile.mailing_zip,
      },
      message: 'Renewal info retrieved. Submit to Illinois Secretary of State immediately.',
    });
  } catch (error: any) {
    console.error('Get license plate renewal info error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve renewal info',
      details: error.message,
    });
  }
}

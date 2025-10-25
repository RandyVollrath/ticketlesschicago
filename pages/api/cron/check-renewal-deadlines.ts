import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Cron Job: Check Renewal Deadlines
 *
 * Runs daily to check for approaching renewal deadlines (30 days out)
 * and trigger charges for users with Protection subscription.
 *
 * Schedule: Run daily at 8am CT
 * Vercel Cron: 0 13 * * * (8am CT = 1pm UTC)
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is being called by Vercel Cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Starting renewal deadline check...');

  try {
    const results = {
      cityStickerCharges: 0,
      licensePlateCharges: 0,
      permitCharges: 0,
      errors: [] as string[]
    };

    // Get current date + 30 days (when we charge for renewals)
    const chargeDate = new Date();
    chargeDate.setDate(chargeDate.getDate() + 30);
    const chargeDateStr = chargeDate.toISOString().split('T')[0];

    console.log(`📅 Looking for renewals due on ${chargeDateStr} (30 days from now)`);

    // 1. Check for city sticker renewals approaching deadline
    const { data: cityStickerUsers, error: cityStickerError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, license_plate, city_sticker_expiry, vehicle_type, stripe_customer_id, has_protection')
      .eq('has_protection', true)
      .eq('city_sticker_expiry', chargeDateStr)
      .not('stripe_customer_id', 'is', null);

    if (cityStickerError) {
      console.error('Error fetching city sticker users:', cityStickerError);
      results.errors.push(`City sticker query error: ${cityStickerError.message}`);
    } else if (cityStickerUsers && cityStickerUsers.length > 0) {
      console.log(`📋 Found ${cityStickerUsers.length} city sticker renewals due in 30 days`);

      for (const user of cityStickerUsers) {
        // Check if we've already created a charge for this renewal
        const { data: existingCharge } = await supabase
          .from('renewal_charges')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('charge_type', 'city_sticker')
          .eq('renewal_deadline', user.city_sticker_expiry)
          .single();

        if (existingCharge) {
          console.log(`⏭️  Skipping user ${user.user_id} - charge already exists`);
          continue;
        }

        // Call charge API
        try {
          const chargeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/renewals/charge`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId: user.user_id,
              chargeType: 'city_sticker',
              vehicleType: user.vehicle_type || 'PA', // Default to passenger auto
              licensePlate: user.license_plate,
              renewalDeadline: user.city_sticker_expiry
            })
          });

          if (chargeResponse.ok) {
            results.cityStickerCharges++;
            console.log(`✅ Charged city sticker for user ${user.user_id}`);
          } else {
            const errorData = await chargeResponse.json();
            results.errors.push(`City sticker charge failed for ${user.user_id}: ${errorData.error}`);
            console.error(`❌ City sticker charge failed:`, errorData);
          }
        } catch (error: any) {
          results.errors.push(`City sticker charge error for ${user.user_id}: ${error.message}`);
          console.error(`❌ Error charging city sticker:`, error);
        }
      }
    }

    // 2. Check for license plate renewals approaching deadline
    const { data: licensePlateUsers, error: licensePlateError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, license_plate, license_plate_expiry, has_vanity_plate, stripe_customer_id, has_protection')
      .eq('has_protection', true)
      .eq('license_plate_expiry', chargeDateStr)
      .not('stripe_customer_id', 'is', null);

    if (licensePlateError) {
      console.error('Error fetching license plate users:', licensePlateError);
      results.errors.push(`License plate query error: ${licensePlateError.message}`);
    } else if (licensePlateUsers && licensePlateUsers.length > 0) {
      console.log(`📋 Found ${licensePlateUsers.length} license plate renewals due in 30 days`);

      for (const user of licensePlateUsers) {
        // Check if we've already created a charge for this renewal
        const { data: existingCharge } = await supabase
          .from('renewal_charges')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('charge_type', 'license_plate')
          .eq('renewal_deadline', user.license_plate_expiry)
          .single();

        if (existingCharge) {
          console.log(`⏭️  Skipping user ${user.user_id} - charge already exists`);
          continue;
        }

        // Call charge API
        try {
          const chargeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/renewals/charge`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId: user.user_id,
              chargeType: 'license_plate',
              isVanity: user.has_vanity_plate || false,
              licensePlate: user.license_plate,
              renewalDeadline: user.license_plate_expiry
            })
          });

          if (chargeResponse.ok) {
            results.licensePlateCharges++;
            console.log(`✅ Charged license plate for user ${user.user_id}`);
          } else {
            const errorData = await chargeResponse.json();
            results.errors.push(`License plate charge failed for ${user.user_id}: ${errorData.error}`);
            console.error(`❌ License plate charge failed:`, errorData);
          }
        } catch (error: any) {
          results.errors.push(`License plate charge error for ${user.user_id}: ${error.message}`);
          console.error(`❌ Error charging license plate:`, error);
        }
      }
    }

    // 3. Check for permit renewals approaching deadline
    // Note: Permit renewal dates are typically annual, check if user has permit_zone_number
    const { data: permitUsers, error: permitError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, license_plate, permit_expiry_date, permit_zone_number, stripe_customer_id, has_protection')
      .eq('has_protection', true)
      .eq('permit_expiry_date', chargeDateStr)
      .not('stripe_customer_id', 'is', null)
      .not('permit_zone_number', 'is', null);

    if (permitError) {
      console.error('Error fetching permit users:', permitError);
      results.errors.push(`Permit query error: ${permitError.message}`);
    } else if (permitUsers && permitUsers.length > 0) {
      console.log(`📋 Found ${permitUsers.length} permit renewals due in 30 days`);

      for (const user of permitUsers) {
        // Check if we've already created a charge for this renewal
        const { data: existingCharge } = await supabase
          .from('renewal_charges')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('charge_type', 'permit')
          .eq('renewal_deadline', user.permit_expiry_date)
          .single();

        if (existingCharge) {
          console.log(`⏭️  Skipping user ${user.user_id} - charge already exists`);
          continue;
        }

        // Call charge API
        try {
          const chargeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/renewals/charge`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId: user.user_id,
              chargeType: 'permit',
              licensePlate: user.license_plate,
              renewalDeadline: user.permit_expiry_date
            })
          });

          if (chargeResponse.ok) {
            results.permitCharges++;
            console.log(`✅ Charged permit for user ${user.user_id}`);
          } else {
            const errorData = await chargeResponse.json();
            results.errors.push(`Permit charge failed for ${user.user_id}: ${errorData.error}`);
            console.error(`❌ Permit charge failed:`, errorData);
          }
        } catch (error: any) {
          results.errors.push(`Permit charge error for ${user.user_id}: ${error.message}`);
          console.error(`❌ Error charging permit:`, error);
        }
      }
    }

    console.log('✅ Renewal deadline check complete');
    console.log(`📊 Results: ${results.cityStickerCharges} city stickers, ${results.licensePlateCharges} license plates, ${results.permitCharges} permits`);

    if (results.errors.length > 0) {
      console.error(`⚠️  ${results.errors.length} errors occurred:`, results.errors);
    }

    return res.status(200).json({
      success: true,
      cityStickerCharges: results.cityStickerCharges,
      licensePlateCharges: results.licensePlateCharges,
      permitCharges: results.permitCharges,
      errors: results.errors,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Cron job error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
}

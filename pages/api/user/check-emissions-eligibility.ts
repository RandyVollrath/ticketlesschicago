/**
 * Check Emissions Eligibility API
 *
 * POST /api/user/check-emissions-eligibility
 *
 * Uses VIN and plate expiry to determine if/when emissions testing is required.
 * Can also update user profile with calculated emissions date.
 *
 * Body:
 * - vin: string (17-character VIN)
 * - plateExpiry: string (YYYY-MM-DD format)
 * - vehicleType?: 'gas' | 'diesel' | 'electric' | 'hybrid' | 'motorcycle'
 * - userId?: string (if provided, will update user profile)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  calculateEmissionsEligibility,
  getEmissionsDeadline,
  isValidVIN,
  getModelYearFromVIN,
} from '../../../lib/emissions-utils';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { vin, plateExpiry, vehicleType, userId } = req.body;

    if (!vin) {
      return res.status(400).json({ error: 'VIN is required' });
    }

    if (!isValidVIN(vin)) {
      return res.status(400).json({
        error: 'Invalid VIN. Must be 17 characters (letters A-Z except I, O, Q, and numbers 0-9)',
      });
    }

    if (!plateExpiry) {
      return res.status(400).json({ error: 'License plate expiry date is required' });
    }

    // Calculate eligibility
    const eligibility = calculateEmissionsEligibility(vin, plateExpiry, vehicleType);

    // Get exact deadline if testing is required
    const modelYear = getModelYearFromVIN(vin);
    let emissionsDeadline: Date | null = null;
    if (eligibility.requiresTesting && modelYear) {
      emissionsDeadline = getEmissionsDeadline(plateExpiry, modelYear);
    }

    // If userId provided, update user profile with emissions info
    if (userId) {
      const updateData: any = {
        vin: vin.toUpperCase(),
        vehicle_model_year: modelYear,
        emissions_required: eligibility.requiresTesting,
        emissions_exempt: eligibility.isExempt,
        emissions_exempt_reason: eligibility.exemptionReason,
      };

      // Set emissions date if testing is required
      if (emissionsDeadline) {
        updateData.emissions_date = emissionsDeadline.toISOString().split('T')[0];
        updateData.emissions_completed = false;
      } else if (eligibility.isExempt) {
        // Clear emissions date if exempt
        updateData.emissions_date = null;
        updateData.emissions_completed = null;
      }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error updating user profile:', updateError);
        // Don't fail the request - still return eligibility info
      } else {
        console.log(`Updated emissions info for user ${userId}`);
      }
    }

    return res.status(200).json({
      success: true,
      eligibility: {
        requiresTesting: eligibility.requiresTesting,
        isExempt: eligibility.isExempt,
        exemptionReason: eligibility.exemptionReason,
        reason: eligibility.reason,
        modelYear: eligibility.modelYear,
        nextTestYear: eligibility.nextTestYear,
        nextTestMonth: eligibility.nextTestMonth,
        deadline: emissionsDeadline?.toISOString().split('T')[0] || null,
      },
    });
  } catch (error: any) {
    console.error('Error checking emissions eligibility:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

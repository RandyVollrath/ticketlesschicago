import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  findNearbySignage,
  findDefenseSupportingSignage,
  submitSignageReport,
  getSignageReport,
  verifySignageReport,
  getWardSignageReports,
  getProblematicSignage,
  searchSignageByAddress,
  getSignageStatsByWard,
} from '../../../lib/contest-intelligence';
import { SignCondition } from '../../../lib/contest-intelligence/types';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Signage Database API
 *
 * GET /api/intelligence/signage?lat=41.8781&lng=-87.6298 - Find nearby signage
 * GET /api/intelligence/signage?lat=41.8781&lng=-87.6298&defense=true - Find defense-supporting signage
 * GET /api/intelligence/signage?id=xxx - Get specific report
 * GET /api/intelligence/signage?ward=1 - Get ward signage reports
 * GET /api/intelligence/signage?address=123%20Main - Search by address
 * GET /api/intelligence/signage?stats=true - Get ward statistics
 * GET /api/intelligence/signage?problematic=true - Get problematic signage
 *
 * POST /api/intelligence/signage - Submit new report
 * PATCH /api/intelligence/signage - Verify/update report
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === 'GET') {
      const { lat, lng, defense, id, ward, address, stats, problematic, radius } = req.query;

      // Get ward statistics
      if (stats === 'true') {
        const wardStats = await getSignageStatsByWard(supabase);
        return res.status(200).json({
          success: true,
          stats: wardStats,
        });
      }

      // Get problematic signage
      if (problematic === 'true') {
        const problematicSigns = await getProblematicSignage(supabase, {
          ward: ward ? parseInt(ward as string, 10) : undefined,
          limit: 50,
        });
        return res.status(200).json({
          success: true,
          reports: problematicSigns,
        });
      }

      // Get specific report by ID
      if (id) {
        const report = await getSignageReport(supabase, id as string);
        if (!report) {
          return res.status(404).json({ error: 'Report not found' });
        }
        return res.status(200).json({
          success: true,
          report,
        });
      }

      // Get ward reports
      if (ward) {
        const wardReports = await getWardSignageReports(supabase, parseInt(ward as string, 10), {
          limit: 100,
        });
        return res.status(200).json({
          success: true,
          reports: wardReports,
        });
      }

      // Search by address
      if (address) {
        const searchResults = await searchSignageByAddress(supabase, address as string);
        return res.status(200).json({
          success: true,
          reports: searchResults,
        });
      }

      // Find nearby signage by coordinates
      if (lat && lng) {
        const latitude = parseFloat(lat as string);
        const longitude = parseFloat(lng as string);

        if (isNaN(latitude) || isNaN(longitude)) {
          return res.status(400).json({ error: 'Invalid coordinates' });
        }

        const radiusFeet = radius ? parseInt(radius as string, 10) : undefined;

        if (defense === 'true') {
          const defenseSigns = await findDefenseSupportingSignage(
            supabase,
            latitude,
            longitude
          );
          return res.status(200).json({
            success: true,
            nearby_signage: defenseSigns,
          });
        } else {
          const nearbySigns = await findNearbySignage(supabase, latitude, longitude, radiusFeet);
          return res.status(200).json({
            success: true,
            nearby_signage: nearbySigns,
          });
        }
      }

      return res.status(400).json({
        error: 'Missing required parameters. Provide lat/lng, id, ward, address, stats=true, or problematic=true',
      });
    }

    if (req.method === 'POST') {
      const {
        latitude,
        longitude,
        address,
        ward,
        sign_type,
        sign_text,
        restriction_hours,
        condition,
        obstruction_type,
        photo_urls,
        reported_by,
        street_view_url,
        street_view_date,
      } = req.body;

      if (!latitude || !longitude || !sign_type || !condition) {
        return res.status(400).json({
          error: 'latitude, longitude, sign_type, and condition are required',
        });
      }

      const report = await submitSignageReport(supabase, {
        latitude,
        longitude,
        address,
        ward,
        sign_type,
        sign_text,
        restriction_hours,
        condition: condition as SignCondition,
        obstruction_type,
        photo_urls: photo_urls || [],
        reported_by,
        street_view_url,
        street_view_date,
        last_verified: new Date().toISOString(),
      });

      if (!report) {
        return res.status(500).json({ error: 'Failed to submit report' });
      }

      return res.status(201).json({
        success: true,
        report,
      });
    }

    if (req.method === 'PATCH') {
      const { id, verified, condition } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const success = await verifySignageReport(
        supabase,
        id,
        condition as SignCondition | undefined
      );

      if (!success) {
        return res.status(500).json({ error: 'Failed to update report' });
      }

      return res.status(200).json({
        success: true,
        message: 'Report updated',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Signage API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

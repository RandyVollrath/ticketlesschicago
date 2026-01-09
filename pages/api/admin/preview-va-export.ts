/**
 * Admin Preview VA Export
 *
 * Returns a preview of what the VA export will contain without sending an email.
 * Useful for admins to verify data before the scheduled export runs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PlateExportPreview {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  plate: string;
  state: string;
  has_contesting: boolean;
  missing_fields: string[];
}

interface PreviewResponse {
  success: boolean;
  preview: PlateExportPreview[];
  summary: {
    total_paid_users: number;
    total_plates: number;
    users_missing_last_name: number;
    users_missing_plates: number;
    ready_for_export: number;
  };
  csv_preview?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PreviewResponse>
) {
  // Admin-only endpoint - check authorization
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      preview: [],
      summary: {
        total_paid_users: 0,
        total_plates: 0,
        users_missing_last_name: 0,
        users_missing_plates: 0,
        ready_for_export: 0,
      },
      error: 'Unauthorized',
    });
  }

  try {
    // Get all users with has_contesting = true
    const { data: paidUsers, error: usersError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, has_contesting')
      .eq('has_contesting', true);

    if (usersError) {
      throw usersError;
    }

    if (!paidUsers || paidUsers.length === 0) {
      return res.status(200).json({
        success: true,
        preview: [],
        summary: {
          total_paid_users: 0,
          total_plates: 0,
          users_missing_last_name: 0,
          users_missing_plates: 0,
          ready_for_export: 0,
        },
      });
    }

    const paidUserIds = paidUsers.map(u => u.user_id);

    // Get all active monitored plates for these users
    const { data: plates, error: platesError } = await supabase
      .from('monitored_plates')
      .select('plate, state, user_id')
      .eq('status', 'active')
      .in('user_id', paidUserIds);

    if (platesError) {
      throw platesError;
    }

    // Create a map of user_id to plates
    const platesByUser = new Map<string, { plate: string; state: string }[]>();
    plates?.forEach(p => {
      const existing = platesByUser.get(p.user_id) || [];
      existing.push({ plate: p.plate, state: p.state });
      platesByUser.set(p.user_id, existing);
    });

    // Build preview data
    const preview: PlateExportPreview[] = [];
    let usersMissingLastName = 0;
    let usersMissingPlates = 0;

    for (const user of paidUsers) {
      const userPlates = platesByUser.get(user.user_id) || [];
      const missingFields: string[] = [];

      if (!user.last_name?.trim()) {
        missingFields.push('last_name');
        usersMissingLastName++;
      }

      if (userPlates.length === 0) {
        missingFields.push('plate');
        usersMissingPlates++;

        // Add user even without plates to show they're missing
        preview.push({
          user_id: user.user_id,
          email: user.email || '',
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          plate: '',
          state: '',
          has_contesting: user.has_contesting,
          missing_fields: missingFields,
        });
      } else {
        // Add each plate as a row
        for (const plate of userPlates) {
          preview.push({
            user_id: user.user_id,
            email: user.email || '',
            first_name: user.first_name || '',
            last_name: user.last_name || '',
            plate: plate.plate,
            state: plate.state,
            has_contesting: user.has_contesting,
            missing_fields: missingFields,
          });
        }
      }
    }

    // Count plates ready for export (have both last_name and plate)
    const readyForExport = preview.filter(p =>
      p.last_name.trim() && p.plate.trim()
    ).length;

    // Generate CSV preview (just the header and first few rows)
    const csvHeader = 'last_name,first_name,plate,state,user_id';
    const csvRows = preview
      .filter(p => p.last_name.trim() && p.plate.trim())
      .slice(0, 10)
      .map(p => `"${p.last_name}","${p.first_name}","${p.plate}","${p.state}","${p.user_id}"`);

    const csvPreview = [csvHeader, ...csvRows].join('\n') +
      (readyForExport > 10 ? `\n... and ${readyForExport - 10} more rows` : '');

    return res.status(200).json({
      success: true,
      preview,
      summary: {
        total_paid_users: paidUsers.length,
        total_plates: plates?.length || 0,
        users_missing_last_name: usersMissingLastName,
        users_missing_plates: usersMissingPlates,
        ready_for_export: readyForExport,
      },
      csv_preview: csvPreview,
    });

  } catch (error: any) {
    console.error('Preview error:', error);
    return res.status(500).json({
      success: false,
      preview: [],
      summary: {
        total_paid_users: 0,
        total_plates: 0,
        users_missing_last_name: 0,
        users_missing_plates: 0,
        ready_for_export: 0,
      },
      error: error.message || 'Internal error',
    });
  }
}

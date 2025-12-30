import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Export monitored plates as CSV for VA to fill in ticket data
 * GET /api/autopilot/export-plates-csv
 *
 * Returns CSV with columns:
 * plate, state, user_email, ticket_number, violation_code, violation_type, violation_description, violation_date, amount, location
 *
 * The first 3 columns are pre-filled, VA fills in the rest when they find tickets
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin token
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_API_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active monitored plates with user emails
    const { data: plates, error } = await supabaseAdmin
      .from('monitored_plates')
      .select(`
        plate,
        state,
        users:user_id (
          email
        )
      `)
      .eq('status', 'active')
      .order('plate', { ascending: true });

    if (error) {
      throw error;
    }

    if (!plates || plates.length === 0) {
      return res.status(200).json({ message: 'No active plates to export' });
    }

    // CSV header with columns VA needs to fill
    const csvHeader = [
      'plate',
      'state',
      'user_email',
      'ticket_number',
      'violation_code',
      'violation_type',
      'violation_description',
      'violation_date',
      'amount',
      'location'
    ].join(',');

    // Valid violation types for reference
    const violationTypesComment = '# Valid violation_type values: expired_plates, no_city_sticker, expired_meter, disabled_zone, street_cleaning, rush_hour, fire_hydrant, other_unknown';

    // Generate CSV rows - pre-fill plate info, leave ticket columns empty
    const csvRows = plates.map((p: any) => {
      const userEmail = p.users?.email || '';
      return [
        `"${p.plate}"`,
        `"${p.state}"`,
        `"${userEmail}"`,
        '', // ticket_number - VA fills this
        '', // violation_code
        '', // violation_type
        '', // violation_description
        '', // violation_date (YYYY-MM-DD format)
        '', // amount (numeric, no $ sign)
        '', // location
      ].join(',');
    });

    // Instructions for VA
    const instructions = `# AUTOPILOT AMERICA - PLATE CHECK TEMPLATE
# Generated: ${new Date().toISOString()}
# Total Plates: ${plates.length}
#
# INSTRUCTIONS:
# 1. For each plate, check the Chicago parking ticket portal
# 2. If tickets are found, fill in the ticket columns
# 3. If multiple tickets for one plate, duplicate the row
# 4. Leave ticket columns empty if no tickets found
# 5. Upload completed file to /api/autopilot/upload-csv
#
# ${violationTypesComment}
# violation_date format: YYYY-MM-DD
# amount format: numeric only (e.g., 75.00 not $75.00)
#
`;

    const csvContent = instructions + csvHeader + '\n' + csvRows.join('\n');

    // Set response headers for CSV download
    const filename = `autopilot-plates-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.status(200).send(csvContent);

  } catch (error) {
    console.error('Error exporting plates:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to export plates',
    });
  }
}

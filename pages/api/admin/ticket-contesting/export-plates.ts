/**
 * Admin API: Export License Plates for VA Ticket Checking
 *
 * Exports all paid Protection users' license plates in CSV format.
 * The VA can add ticket info to this same CSV and re-upload it.
 *
 * Export columns:
 * - license_plate
 * - license_state
 * - user_name (for reference)
 * - ticket_number (empty - VA fills in)
 * - issue_date (empty - VA fills in)
 * - violation_code (empty - VA fills in)
 * - violation_description (empty - VA fills in)
 * - violation_location (empty - VA fills in)
 * - amount (empty - VA fills in)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../../lib/auth-middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const format = req.query.format || 'json';

    // Get all paid users with license plates
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, license_plate, license_state')
      .eq('has_protection', true)
      .not('license_plate', 'is', null)
      .order('last_name');

    if (error) {
      throw error;
    }

    const plates = (users || []).filter(u => u.license_plate);

    if (format === 'csv') {
      // Generate CSV with columns ready for VA to fill in
      const headers = [
        'license_plate',
        'license_state',
        'user_name',
        'ticket_number',
        'issue_date',
        'violation_code',
        'violation_description',
        'violation_location',
        'amount'
      ];

      const rows = plates.map(u => {
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
        return [
          u.license_plate || '',
          u.license_state || 'IL',
          fullName.replace(/,/g, ' '), // Remove commas from names
          '', // ticket_number - VA fills in
          '', // issue_date - VA fills in
          '', // violation_code - VA fills in
          '', // violation_description - VA fills in
          '', // violation_location - VA fills in
          '', // amount - VA fills in
        ];
      });

      const csv = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="plates-for-ticket-check-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }

    // JSON response
    return res.status(200).json({
      success: true,
      totalPlates: plates.length,
      plates: plates.map(u => ({
        license_plate: u.license_plate,
        license_state: u.license_state || 'IL',
        user_name: [u.first_name, u.last_name].filter(Boolean).join(' '),
      })),
    });

  } catch (error: any) {
    console.error('Export plates error:', error);
    return res.status(500).json({ error: error.message || 'Failed to export plates' });
  }
});

/**
 * Admin API: Ticket Contesting Settings
 *
 * GET: Fetch current settings
 * PUT: Update settings
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { data: settings, error } = await supabase
        .from('admin_settings')
        .select('*')
        .in('key', ['ticket_contesting_email']);

      if (error) {
        throw error;
      }

      const settingsMap: Record<string, any> = {};
      for (const s of settings || []) {
        settingsMap[s.key] = s;
      }

      return res.status(200).json({
        success: true,
        settings: settingsMap,
      });
    } catch (error: any) {
      console.error('Error fetching settings:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { ticket_contesting_email } = req.body;

      if (ticket_contesting_email !== undefined) {
        const { error } = await supabase
          .from('admin_settings')
          .upsert({
            key: 'ticket_contesting_email',
            value: ticket_contesting_email,
            description: 'Email address to receive the list of paid users license plates for ticket checking',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'key',
          });

        if (error) {
          throw error;
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Settings updated',
      });
    } catch (error: any) {
      console.error('Error updating settings:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

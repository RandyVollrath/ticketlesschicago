import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone = '+12243217290' } = req.body;

  try {
    // Update all test records to have the real phone number
    const { data, error } = await supabaseAdmin
      .from('vehicle_reminders')
      .update({ 
        phone: phone,
        // Reset sent reminders to allow notifications to be sent again
        sent_reminders: [],
        // Enable SMS notifications
        notification_preferences: {
          email: true,
          sms: true,
          voice: false,
          reminder_days: [30, 7, 1]
        }
      })
      .eq('license_plate', 'TEST123')
      .select();

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: `Updated ${data?.length || 0} test records with phone: ${phone}`,
      data
    });

  } catch (error) {
    console.error('Error updating phone:', error);
    res.status(500).json({ 
      error: 'Failed to update phone numbers',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
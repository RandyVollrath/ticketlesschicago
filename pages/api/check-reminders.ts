import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: reminders, error } = await supabaseAdmin
      .from('vehicle_reminders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Process reminders to show days until due
    const processedReminders = reminders?.map(reminder => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const citySticker = reminder.city_sticker_expiry ? new Date(reminder.city_sticker_expiry) : null;
      const licensePlate = reminder.license_plate_expiry ? new Date(reminder.license_plate_expiry) : null;
      const emissions = reminder.emissions_due_date ? new Date(reminder.emissions_due_date) : null;
      
      return {
        id: reminder.id,
        license_plate: reminder.license_plate,
        email: reminder.email,
        city_sticker_expiry: reminder.city_sticker_expiry,
        city_sticker_days: citySticker ? Math.ceil((citySticker.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null,
        license_plate_expiry: reminder.license_plate_expiry,
        license_plate_days: licensePlate ? Math.ceil((licensePlate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null,
        emissions_due_date: reminder.emissions_due_date,
        emissions_days: emissions ? Math.ceil((emissions.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null,
        sent_reminders: reminder.sent_reminders || [],
        notification_preferences: reminder.notification_preferences,
        created_at: reminder.created_at
      };
    });

    res.status(200).json({
      success: true,
      total: processedReminders?.length || 0,
      reminders: processedReminders,
      currentDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ 
      error: 'Failed to fetch reminders',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
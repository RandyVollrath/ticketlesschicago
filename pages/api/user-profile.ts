import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
      // Get user profile (now the primary source of truth)
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (userError) {
        console.error('Error fetching user profile:', userError);
        return res.status(404).json({ error: 'User profile not found' });
      }
      
      // Get user's vehicle info as fallback
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
        
      const vehicle = vehicles?.[0];
      
      // Combine profile with vehicle data as fallback
      const profile = {
        ...user,
        // Use profile data first, then vehicle data as fallback
        license_plate: user?.license_plate || vehicle?.license_plate || null,
        vin: user?.vin || vehicle?.vin || null,
        zip_code: user?.zip_code || vehicle?.zip_code || null,
        vehicle_type: user?.vehicle_type || 'passenger',
        vehicle_year: user?.vehicle_year || vehicle?.year || new Date().getFullYear(),
        // Address fields
        street_address: user?.street_address || null,
        mailing_address: user?.mailing_address || null,
        mailing_city: user?.mailing_city || null,
        mailing_state: user?.mailing_state || 'IL',
        mailing_zip: user?.mailing_zip || null,
        // Renewal dates
        city_sticker_expiry: user?.city_sticker_expiry || null,
        license_plate_expiry: user?.license_plate_expiry || null,
        emissions_date: user?.emissions_date || null,
        // Concierge options
        concierge_service: user?.concierge_service ?? false,
        city_stickers_only: user?.city_stickers_only ?? true,
        spending_limit: user?.spending_limit || 500,
        // Names
        first_name: user?.first_name || null,
        last_name: user?.last_name || null
      };
      
      return res.status(200).json(profile);
    } catch (error) {
      console.error('Error fetching profile:', error);
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}
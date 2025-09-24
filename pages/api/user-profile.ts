import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
      // Get user basic info
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (userError) {
        console.error('Error fetching user:', userError);
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Get extended profile data
      const { data: extendedProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      // Get user's vehicle info as fallback
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
        
      const vehicle = vehicles?.[0];
      
      // Combine all data sources to create full profile
      const profile = {
        ...user,
        // Use extended profile if available, fallback to vehicle data
        license_plate: extendedProfile?.license_plate || vehicle?.license_plate || null,
        vin: extendedProfile?.vin || vehicle?.vin || null,
        zip_code: extendedProfile?.zip_code || vehicle?.zip_code || null,
        vehicle_type: extendedProfile?.vehicle_type || 'passenger',
        vehicle_year: extendedProfile?.vehicle_year || vehicle?.year || new Date().getFullYear(),
        // Address fields
        street_address: extendedProfile?.street_address || null,
        mailing_address: extendedProfile?.mailing_address || vehicle?.mailing_address || null,
        mailing_city: extendedProfile?.mailing_city || vehicle?.mailing_city || null,
        mailing_state: extendedProfile?.mailing_state || vehicle?.mailing_state || 'IL',
        mailing_zip: extendedProfile?.mailing_zip || vehicle?.mailing_zip || null,
        // Renewal dates
        city_sticker_expiry: extendedProfile?.city_sticker_expiry || null,
        license_plate_expiry: extendedProfile?.license_plate_expiry || null,
        emissions_date: extendedProfile?.emissions_date || null,
        // Concierge options
        concierge_service: extendedProfile?.concierge_service || false,
        city_stickers_only: extendedProfile?.city_stickers_only !== false,
        spending_limit: extendedProfile?.spending_limit || 500,
        // Names
        first_name: extendedProfile?.first_name || null,
        last_name: extendedProfile?.last_name || null
      };
      
      return res.status(200).json(profile);
    } catch (error) {
      console.error('Error fetching profile:', error);
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}
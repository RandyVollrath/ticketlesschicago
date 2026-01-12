/**
 * Mail Property Tax Appeal via Lob
 *
 * Sends the user's property tax appeal packet to the Cook County
 * Board of Review via physical mail using Lob.com.
 *
 * POST /api/property-tax/mail-appeal
 * Body: {
 *   appealId: string,
 *   useCertifiedMail?: boolean (extra $6.99 for certified mail)
 * }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendPropertyTaxAppealLetter, COOK_COUNTY_BOR_ADDRESS } from '../../../lib/lob-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in' });
    }

    const { appealId, useCertifiedMail = false } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Please provide an appeal ID' });
    }

    // Get the appeal
    const { data: appeal, error: appealError } = await supabase
      .from('property_tax_appeals')
      .select(`
        id,
        pin,
        address,
        township,
        stage,
        appeal_pdf_url,
        lob_letter_id,
        mailed_at,
        user_id
      `)
      .eq('id', appealId)
      .eq('user_id', user.id)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Must have PDF generated
    if (!appeal.appeal_pdf_url) {
      return res.status(400).json({
        error: 'PDF not generated',
        message: 'Please generate your appeal PDF before requesting mailing.'
      });
    }

    // Check if already mailed
    if (appeal.lob_letter_id && appeal.mailed_at) {
      return res.status(400).json({
        error: 'Already mailed',
        message: 'This appeal has already been sent via mail.',
        mailedAt: appeal.mailed_at,
        lobLetterId: appeal.lob_letter_id
      });
    }

    // Get user's address for return address
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('first_name, last_name, street_address, city, state, zip_code')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile?.street_address) {
      return res.status(400).json({
        error: 'Address required',
        message: 'Please update your profile with a complete mailing address.'
      });
    }

    // Validate address
    if (!profile.city || !profile.state || !profile.zip_code) {
      return res.status(400).json({
        error: 'Incomplete address',
        message: 'Please provide city, state, and zip code in your profile.'
      });
    }

    // Send via Lob
    try {
      const lobResult = await sendPropertyTaxAppealLetter({
        from: {
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Property Owner',
          address: profile.street_address,
          city: profile.city,
          state: profile.state,
          zip: profile.zip_code
        },
        pdfUrl: appeal.appeal_pdf_url,
        appealId: appeal.id,
        pin: appeal.pin,
        township: appeal.township,
        useCertifiedMail
      });

      // Update appeal record
      const { error: updateError } = await supabase
        .from('property_tax_appeals')
        .update({
          lob_letter_id: lobResult.id,
          mailed_at: new Date().toISOString(),
          mailing_method: useCertifiedMail ? 'certified' : 'first_class',
          expected_delivery_date: lobResult.expected_delivery_date,
          updated_at: new Date().toISOString()
        })
        .eq('id', appealId);

      if (updateError) {
        console.error('Failed to update appeal after mailing:', updateError);
        // Don't fail the request - the letter was sent
      }

      return res.status(200).json({
        success: true,
        message: 'Your appeal packet has been sent to the Cook County Board of Review!',
        mailing: {
          letterId: lobResult.id,
          expectedDelivery: lobResult.expected_delivery_date,
          trackingNumber: lobResult.tracking_number,
          destination: {
            name: COOK_COUNTY_BOR_ADDRESS.name,
            address: COOK_COUNTY_BOR_ADDRESS.address,
            city: COOK_COUNTY_BOR_ADDRESS.city,
            state: COOK_COUNTY_BOR_ADDRESS.state,
            zip: COOK_COUNTY_BOR_ADDRESS.zip
          },
          certified: useCertifiedMail
        },
        nextSteps: [
          'Your appeal will be delivered to the Board of Review',
          useCertifiedMail
            ? 'You will receive delivery confirmation via certified mail tracking'
            : 'Standard first-class mail typically arrives within 3-5 business days',
          'Monitor your email for hearing date notification from the BOR',
          'We will send you updates when we detect any changes'
        ]
      });

    } catch (lobError: any) {
      console.error('Lob mailing failed:', lobError);
      return res.status(500).json({
        error: 'Mailing failed',
        message: 'Failed to send your appeal via mail. Please try again or mail it manually.',
        details: lobError.message
      });
    }

  } catch (error) {
    console.error('Mail appeal error:', error);
    return res.status(500).json({
      error: 'An error occurred. Please try again.'
    });
  }
}

/**
 * UtilityAPI Webhook Handler
 *
 * Receives webhook events from UtilityAPI when:
 * - User completes authorization
 * - Bills are collected
 * - Meters are updated
 *
 * POST /api/utilityapi/webhook
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UTILITYAPI_TOKEN = process.env.UTILITYAPI_TOKEN;
const UTILITYAPI_BASE_URL = 'https://utilityapi.com/api/v2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;

    console.log('📬 UtilityAPI webhook received:', {
      type: event.type,
      authorization_uid: event.authorization_uid,
      meter_uid: event.meter_uid,
    });

    // Handle authorization completion
    if (event.type === 'authorization.created' || event.type === 'authorization.updated') {
      await handleAuthorizationEvent(event);
    }

    // Handle meter updates (bills collected)
    if (event.type === 'meter.updated') {
      await handleMeterUpdate(event);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('❌ Webhook processing error:', error);
    return res.status(500).json({
      error: 'Webhook processing failed',
      details: error.message,
    });
  }
}

async function handleAuthorizationEvent(event: any) {
  const authorizationUid = event.authorization_uid;

  console.log(`🔐 Processing authorization: ${authorizationUid}`);

  // Fetch authorization details from UtilityAPI
  const response = await fetch(
    `${UTILITYAPI_BASE_URL}/authorizations/${authorizationUid}?include=meters`,
    {
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    console.error('❌ Failed to fetch authorization:', response.status);
    return;
  }

  const authorization = await response.json();

  // Get user ID from referral code (we stored userId when creating the form)
  const userId = authorization.referral;

  if (!userId) {
    console.error('⚠️  No referral (userId) found in authorization');
    return;
  }

  console.log(`✓ Found user: ${userId}`);

  // Update user profile with authorization details
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      utilityapi_authorization_uid: authorizationUid,
      utilityapi_connected: true,
      utilityapi_connected_at: new Date().toISOString(),
      utilityapi_utility: authorization.utility,
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Failed to update user profile:', updateError);
    return;
  }

  console.log(`✅ User ${userId} connected to ${authorization.utility}`);

  // If meters are included, start historical collection
  if (authorization.meters && authorization.meters.length > 0) {
    await startHistoricalCollection(authorization.meters);
  }
}

async function startHistoricalCollection(meters: any[]) {
  const meterUids = meters.map((m: any) => m.uid);

  console.log(`📊 Starting historical collection for ${meterUids.length} meters`);

  const response = await fetch(`${UTILITYAPI_BASE_URL}/meters/historical-collection`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meters: meterUids,
    }),
  });

  if (!response.ok) {
    console.error('❌ Failed to start historical collection:', response.status);
    return;
  }

  console.log('✅ Historical collection started');
}

async function handleMeterUpdate(event: any) {
  const meterUid = event.meter_uid;

  console.log(`📊 Meter updated: ${meterUid}`);

  // Fetch meter details to get authorization
  const meterResponse = await fetch(`${UTILITYAPI_BASE_URL}/meters/${meterUid}`, {
    headers: {
      'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
    },
  });

  if (!meterResponse.ok) {
    console.error('❌ Failed to fetch meter:', meterResponse.status);
    return;
  }

  const meter = await meterResponse.json();
  const authorizationUid = meter.authorization_uid;

  // Fetch authorization to get userId from referral
  const authResponse = await fetch(
    `${UTILITYAPI_BASE_URL}/authorizations/${authorizationUid}`,
    {
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      },
    }
  );

  if (!authResponse.ok) {
    console.error('❌ Failed to fetch authorization:', authResponse.status);
    return;
  }

  const authorization = await authResponse.json();
  const userId = authorization.referral;

  if (!userId) {
    console.error('⚠️  No referral (userId) found');
    return;
  }

  // Fetch bills for this meter
  const billsResponse = await fetch(
    `${UTILITYAPI_BASE_URL}/bills?meters=${meterUid}`,
    {
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      },
    }
  );

  if (!billsResponse.ok) {
    console.error('❌ Failed to fetch bills:', billsResponse.status);
    return;
  }

  const billsData = await billsResponse.json();
  const bills = billsData.bills || [];

  console.log(`📄 Found ${bills.length} bills for user ${userId}`);

  // Get the most recent bill
  if (bills.length > 0) {
    const latestBill = bills[0]; // Bills are usually sorted by date, newest first

    // Fetch bill PDF if available
    const billDetailResponse = await fetch(
      `${UTILITYAPI_BASE_URL}/bills/${latestBill.uid}`,
      {
        headers: {
          'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
        },
      }
    );

    if (billDetailResponse.ok) {
      const billDetail = await billDetailResponse.json();

      // Check for PDF URL in sources
      const sources = billDetail.sources || [];
      const pdfSource = sources.find((s: any) => s.type === 'pdf');

      if (pdfSource && pdfSource.raw_url) {
        console.log(`📎 Found bill PDF: ${pdfSource.raw_url}`);

        // Update user profile with bill details
        await supabase
          .from('user_profiles')
          .update({
            utilityapi_latest_bill_uid: latestBill.uid,
            utilityapi_latest_bill_pdf_url: pdfSource.raw_url,
            utilityapi_latest_bill_date: billDetail.created,
          })
          .eq('user_id', userId);

        console.log(`✅ Updated bill info for user ${userId}`);
      }
    }
  }
}

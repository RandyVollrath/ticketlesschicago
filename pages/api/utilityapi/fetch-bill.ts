/**
 * Fetch Bill PDF from UtilityAPI
 *
 * Downloads the latest bill PDF for a user and stores it in Supabase Storage.
 * This can be called:
 * - Manually for testing
 * - Via webhook when bill is ready
 * - Via cron job 30 days before permit renewal
 *
 * POST /api/utilityapi/fetch-bill
 * Body: { userId: string }
 *
 * Returns: { success: boolean, billPath: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UTILITYAPI_TOKEN = process.env.UTILITYAPI_TOKEN;
const UTILITYAPI_BASE_URL = 'https://utilityapi.com/api/v2';
const BUCKET_NAME = 'residency-proofs-temps';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`📥 Fetching bill for user ${userId}`);

    // Get user's UtilityAPI authorization
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!profile.utilityapi_authorization_uid) {
      return res.status(400).json({
        error: 'User has not connected their utility account',
      });
    }

    console.log(`✓ Found authorization: ${profile.utilityapi_authorization_uid}`);

    // Fetch meters for this authorization
    const metersResponse = await fetch(
      `${UTILITYAPI_BASE_URL}/meters?authorizations=${profile.utilityapi_authorization_uid}`,
      {
        headers: {
          'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
        },
      }
    );

    if (!metersResponse.ok) {
      const errorData = await metersResponse.text();
      console.error('❌ Failed to fetch meters:', metersResponse.status, errorData);
      return res.status(500).json({ error: 'Failed to fetch meters' });
    }

    const metersData = await metersResponse.json();
    const meters = metersData.meters || [];

    if (meters.length === 0) {
      return res.status(404).json({ error: 'No meters found for this authorization' });
    }

    const meterUid = meters[0].uid; // Use first meter
    console.log(`📊 Using meter: ${meterUid}`);

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
      const errorData = await billsResponse.text();
      console.error('❌ Failed to fetch bills:', billsResponse.status, errorData);
      return res.status(500).json({ error: 'Failed to fetch bills' });
    }

    const billsData = await billsResponse.json();
    const bills = billsData.bills || [];

    console.log(`📄 Found ${bills.length} bills`);

    if (bills.length === 0) {
      return res.status(404).json({ error: 'No bills found for this meter' });
    }

    // Get the most recent bill
    const latestBill = bills[0];
    console.log(`📋 Latest bill: ${latestBill.uid}`);

    // Fetch full bill details to get PDF URL
    const billDetailResponse = await fetch(
      `${UTILITYAPI_BASE_URL}/bills/${latestBill.uid}`,
      {
        headers: {
          'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
        },
      }
    );

    if (!billDetailResponse.ok) {
      const errorData = await billDetailResponse.text();
      console.error('❌ Failed to fetch bill details:', billDetailResponse.status, errorData);
      return res.status(500).json({ error: 'Failed to fetch bill details' });
    }

    const billDetail = await billDetailResponse.json();

    // Find PDF URL in sources
    const sources = billDetail.sources || [];
    const pdfSource = sources.find((s: any) => s.type === 'pdf');

    if (!pdfSource || !pdfSource.raw_url) {
      console.warn('⚠️  No PDF available for this bill');
      return res.status(404).json({
        error: 'No PDF available for this bill',
        billUid: latestBill.uid,
      });
    }

    console.log(`📎 Downloading PDF from: ${pdfSource.raw_url}`);

    // Download the PDF
    const pdfResponse = await fetch(pdfSource.raw_url, {
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      },
    });

    if (!pdfResponse.ok) {
      console.error('❌ Failed to download PDF:', pdfResponse.status);
      return res.status(500).json({ error: 'Failed to download PDF' });
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    console.log(`✓ Downloaded PDF: ${pdfBuffer.length} bytes`);

    // Delete old bills for this user (keep only most recent)
    const userFolder = `proof/${userId}`;
    const { data: existingFolders } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userFolder);

    if (existingFolders && existingFolders.length > 0) {
      const filesToDelete = existingFolders
        .filter(item => item.name.match(/^\d{4}-\d{2}-\d{2}$/))
        .map(folder => `${userFolder}/${folder.name}/bill.pdf`);

      if (filesToDelete.length > 0) {
        console.log(`🗑️  Deleting ${filesToDelete.length} old bills`);
        await supabase.storage.from(BUCKET_NAME).remove(filesToDelete);
      }
    }

    // Upload new bill to Supabase Storage
    const today = new Date();
    const dateFolder = today.toISOString().split('T')[0]; // yyyy-mm-dd
    const filePath = `${userFolder}/${dateFolder}/bill.pdf`;

    console.log(`📤 Uploading to: ${filePath}`);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      return res.status(500).json({
        error: 'Failed to upload bill',
        details: uploadError.message,
      });
    }

    console.log('✓ Bill uploaded successfully');

    // Update user profile
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath,
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_verified: true,
        residency_proof_verified_at: new Date().toISOString(),
        utilityapi_latest_bill_uid: latestBill.uid,
        utilityapi_latest_bill_pdf_url: pdfSource.raw_url,
        utilityapi_latest_bill_date: billDetail.created || new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('⚠️  Profile update error:', updateError);
      // Don't fail - bill was uploaded successfully
    }

    console.log(`✅ Successfully fetched and stored bill for user ${userId}`);

    return res.status(200).json({
      success: true,
      billPath: filePath,
      billUid: latestBill.uid,
      utility: profile.utilityapi_utility,
    });
  } catch (error: any) {
    console.error('❌ Error fetching bill:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

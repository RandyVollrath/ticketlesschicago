/**
 * Process Forwarded Utility Bills for Proof of Residency (Resend Inbound)
 *
 * Receives forwarded emails from Resend Inbound webhook.
 * Extracts utility bill PDF attachment and stores in Supabase.
 *
 * Webhook URL: https://ticketlesschicago.com/api/email/process-residency-proof-resend
 * Email format: {user_uuid}@bills.autopilotamerica.com
 *
 * Privacy: Only keeps most recent bill, deletes previous bills immediately.
 *
 * Configure in Resend Dashboard:
 * - Event: email.received
 * - Endpoint: https://ticketlesschicago.com/api/email/process-residency-proof-resend
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'residency-proofs-temps';

interface ResendInboundPayload {
  type: 'email.received';
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    reply_to?: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      content_disposition?: string;
      content_id?: string;
    }>;
  };
}

// Disable body parsing to handle raw webhook payload
export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Log the request for debugging
  console.log('🔔 Webhook received:', {
    method: req.method,
    url: req.url,
    body: req.body,
  });

  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload: ResendInboundPayload = req.body;

    console.log('📦 Received payload:', JSON.stringify(payload, null, 2));

    // Verify it's an email.received event
    if (payload.type !== 'email.received') {
      console.log('❌ Invalid event type:', payload.type);
      return res.status(400).json({ error: 'Invalid event type' });
    }

    const email = payload.data;
    console.log('✉️ Processing email:', {
      from: email.from,
      to: email.to,
      subject: email.subject,
      attachments: email.attachments?.length || 0,
    });

    console.log('📎 Attachment details:', JSON.stringify(email.attachments, null, 2));

    // Extract user UUID from "to" address
    // Format: {uuid}@bills.autopilotamerica.com OR {uuid}@linguistic-louse.resend.app
    const toAddress = email.to[0]; // Primary recipient
    console.log(`🔍 Parsing email address: ${toAddress}`);

    const match = toAddress.match(/([a-f0-9\-]+)@(?:bills\.autopilotamerica\.com|linguistic-louse\.resend\.app)/i);

    if (!match) {
      console.error('❌ Invalid email format:', toAddress);
      console.error('Expected format: {uuid}@bills.autopilotamerica.com or {uuid}@linguistic-louse.resend.app');
      return res.status(400).json({ error: 'Invalid email format', toAddress });
    }

    const userId = match[1];

    console.log(`📨 Received utility bill email for user ${userId}`);
    console.log(`  - From: ${email.from}`);
    console.log(`  - Subject: ${email.subject}`);
    console.log(`  - Attachments: ${email.attachments?.length || 0}`);

    // Find user profile
    console.log(`🔍 Looking up user profile for: ${userId}`);
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('user_id, email_forwarding_address, has_protection, has_permit_zone')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('❌ User not found:', userId, 'Error:', profileError);
      return res.status(404).json({ error: 'User not found', userId, details: profileError?.message });
    }

    console.log(`✅ Found user profile:`, {
      has_protection: profile.has_protection,
      has_permit_zone: profile.has_permit_zone,
      email_forwarding_address: profile.email_forwarding_address
    });

    // Verify user has protection and permit zone
    if (!profile.has_protection) {
      console.error('❌ User does not have protection:', userId);
      return res.status(400).json({ error: 'User does not have protection service', userId });
    }

    if (!profile.has_permit_zone) {
      console.error('❌ User does not have permit zone:', userId);
      return res.status(400).json({ error: 'User does not require proof of residency', userId });
    }

    // Find PDF attachment
    console.log(`🔍 Searching for PDF attachment...`);
    const pdfAttachment = email.attachments?.find(att =>
      att.content_type === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
    );

    if (!pdfAttachment) {
      console.error('❌ No PDF attachment found');
      console.error('Available attachments:', email.attachments);
      return res.status(400).json({
        error: 'No PDF attachment found in email',
        attachments: email.attachments?.map(a => ({ filename: a.filename, content_type: a.content_type }))
      });
    }

    console.log(`✅ Found PDF attachment: ${pdfAttachment.filename} (${pdfAttachment.content_type})`);

    // Download attachment from Resend API
    // https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment
    const attachmentUrl = `https://api.resend.com/emails/receiving/${payload.data.email_id}/attachments/${pdfAttachment.id}`;

    console.log(`📥 Fetching attachment from: ${attachmentUrl}`);

    const attachmentResponse = await fetch(attachmentUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
    });

    if (!attachmentResponse.ok) {
      console.error('Failed to fetch attachment metadata:', await attachmentResponse.text());
      throw new Error('Failed to fetch attachment from Resend');
    }

    const attachmentData = await attachmentResponse.json();
    console.log(`📎 Got attachment metadata, downloading from: ${attachmentData.download_url}`);

    // Download the actual file from the presigned URL
    const downloadResponse = await fetch(attachmentData.download_url);
    if (!downloadResponse.ok) {
      console.error('Failed to download attachment file:', await downloadResponse.text());
      throw new Error('Failed to download attachment file');
    }

    const pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    console.log(`✅ Downloaded PDF: ${pdfBuffer.length} bytes`);

    // Delete ALL previous bills for this user (only keep most recent)
    const userFolder = `proof/${userId}`;

    // List all date folders for this user
    const { data: existingFolders } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userFolder);

    // Delete all existing date folders and their contents
    const filesToDelete = existingFolders
      ?.filter(item => item.name.match(/^\d{4}-\d{2}-\d{2}$/)) // Match yyyy-mm-dd folders
      .map(folder => `${userFolder}/${folder.name}/bill.pdf`) || [];

    if (filesToDelete.length > 0) {
      console.log(`🗑️  Deleting ${filesToDelete.length} old bills...`);
      await supabase.storage.from(BUCKET_NAME).remove(filesToDelete);
    }

    // Upload new bill with today's date
    const today = new Date();
    const dateFolder = today.toISOString().split('T')[0]; // yyyy-mm-dd
    const filePath = `${userFolder}/${dateFolder}/bill.pdf`;

    console.log(`📤 Uploading to: ${BUCKET_NAME}/${filePath}`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      throw uploadError;
    }

    console.log(`✅ Uploaded new bill to: ${filePath}`, uploadData);

    // Update user profile with new bill info
    console.log(`💾 Updating database for user ${userId}...`);
    const { data: updateData, error: updateError } = await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath,
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_verified: false, // Will be verified later by cron/manual process
        residency_proof_verified_at: null,
      })
      .eq('user_id', userId)
      .select();

    if (updateError) {
      console.error('❌ Database update error:', updateError);
      throw updateError;
    }

    console.log(`✅ Database updated:`, updateData);
    console.log(`📊 Stats: Deleted ${filesToDelete.length} old bills, stored 1 new bill`);
    console.log(`🎉 Utility bill processed successfully for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Utility bill processed successfully',
      userId,
      filePath,
      deletedCount: filesToDelete.length,
    });

  } catch (error: any) {
    console.error('Error processing utility bill:', error);
    return res.status(500).json({
      error: 'Failed to process utility bill',
      details: error.message,
    });
  }
}
// Force redeploy Thu Nov 13 12:02:34 AM CST 2025

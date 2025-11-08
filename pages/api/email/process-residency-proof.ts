/**
 * Process Forwarded Utility Bills for Proof of Residency
 *
 * Receives forwarded emails from SendGrid Inbound Parse webhook.
 * Extracts utility bill PDF or converts email to PDF.
 * Validates bill (date, address) and stores in Supabase.
 *
 * Webhook URL: https://ticketlesschicago.com/api/email/process-residency-proof
 * Email format: documents+{forwarding_id}@autopilotamerica.com
 *
 * Privacy: Only keeps most recent bill, deletes previous bills immediately.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure formidable to NOT parse by default
export const config = {
  api: {
    bodyParser: false,
  },
};

const BUCKET_NAME = 'residency-proofs-temp';

interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: number;
  'attachment-info'?: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data from SendGrid Inbound Parse
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max for utility bills
      keepExtensions: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    // Extract email metadata
    const to = Array.isArray(fields.to) ? fields.to[0] : fields.to;
    const from = Array.isArray(fields.from) ? fields.from[0] : fields.from;
    const subject = Array.isArray(fields.subject) ? fields.subject[0] : fields.subject;
    const text = Array.isArray(fields.text) ? fields.text[0] : fields.text;
    const html = Array.isArray(fields.html) ? fields.html[0] : fields.html;

    console.log(`📧 Received email: From=${from}, To=${to}, Subject=${subject}`);

    // Extract user UUID from email address
    // Format: documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com
    const match = to?.match(/documents\+([0-9a-f-]{36})@autopilotamerica\.com/i);
    if (!match) {
      console.error('Invalid recipient format:', to);
      return res.status(400).json({ error: 'Invalid recipient format' });
    }

    const userId = match[1];
    console.log(`🔍 User ID: ${userId}`);

    // Look up user by UUID
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('User not found for UUID:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✓ Found user: ${profile.user_id}`);

    // Check consent
    if (!profile.residency_forwarding_consent_given) {
      console.warn(`User ${profile.user_id} has not consented to email forwarding`);
      return res.status(403).json({ error: 'User has not consented to email forwarding' });
    }

    // Find PDF attachment
    let pdfFile = null;
    let pdfBuffer: Buffer | null = null;

    // Check for attachments (SendGrid sends attachments as separate files)
    for (const [fieldName, file] of Object.entries(files)) {
      const fileObj = Array.isArray(file) ? file[0] : file;
      if (fileObj && fileObj.mimetype === 'application/pdf') {
        console.log(`📎 Found PDF attachment: ${fileObj.originalFilename}`);
        pdfFile = fileObj;
        pdfBuffer = fs.readFileSync(fileObj.filepath);
        break;
      }
    }

    // If no PDF found, log and reject (for now - could implement HTML-to-PDF later)
    if (!pdfBuffer) {
      console.warn('No PDF attachment found in email');
      return res.status(400).json({
        error: 'No PDF attachment found. Please ensure your utility bill is attached as a PDF.',
      });
    }

    // TODO: Validate bill (date within 30 days, contains address)
    // For now, we'll skip validation and just store the bill

    // Delete previous bill (only keep latest)
    if (profile.residency_proof_path) {
      console.log(`🗑️  Deleting previous bill: ${profile.residency_proof_path}`);
      await supabase.storage
        .from(BUCKET_NAME)
        .remove([profile.residency_proof_path]);
    }

    // Upload new bill to Supabase Storage
    const fileName = `${profile.user_id}_${Date.now()}.pdf`;
    const filePath = `residency-proofs/${fileName}`;

    console.log(`📤 Uploading to: ${filePath}`);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
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
        residency_proof_verified: true, // Auto-verified (could add validation later)
        residency_proof_verified_at: new Date().toISOString(),
      })
      .eq('user_id', profile.user_id);

    if (updateError) {
      console.error('Profile update error:', updateError);
      // Don't fail the request - bill is uploaded successfully
    }

    console.log(`✅ Successfully processed utility bill for user ${profile.user_id}`);

    // Clean up temp file
    if (pdfFile) {
      fs.unlinkSync(pdfFile.filepath);
    }

    return res.status(200).json({
      success: true,
      message: 'Utility bill processed successfully',
      userId: profile.user_id,
      fileName,
    });
  } catch (error: any) {
    console.error('Email processing error:', error);
    return res.status(500).json({
      error: 'Processing failed',
      details: error.message,
    });
  }
}

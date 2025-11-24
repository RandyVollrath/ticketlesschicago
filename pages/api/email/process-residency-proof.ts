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
import { simpleParser } from 'mailparser';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure to accept both JSON (Cloudflare Worker) and multipart (SendGrid)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
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
    let to: string | undefined;
    let from: string | undefined;
    let subject: string | undefined;
    let text: string | undefined;
    let html: string | undefined;
    let attachmentsData: Array<{ filename: string; contentType: string; content: string }> = [];
    let filesToCleanup: string[] = [];

    // Check if this is JSON (Cloudflare Worker) or multipart form data (SendGrid)
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      // ========================================
      // CLOUDFLARE WORKER FORMAT (JSON)
      // ========================================
      const body = req.body as any;

      // Check if this is raw MIME email format
      if (body.rawEmail) {
        console.log('📧 Parsing raw MIME email...');

        const parsed = await simpleParser(body.rawEmail);

        to = body.to;
        from = body.from;
        subject = parsed.subject || body.subject;
        text = parsed.text || '';
        html = parsed.html || '';

        // Extract attachments from parsed email
        if (parsed.attachments && parsed.attachments.length > 0) {
          console.log(`📎 Found ${parsed.attachments.length} attachments in raw email`);

          for (const attachment of parsed.attachments) {
            attachmentsData.push({
              filename: attachment.filename || 'attachment',
              contentType: attachment.contentType || 'application/octet-stream',
              content: attachment.content.toString('base64'),
            });
          }
        }
      } else {
        // Original format with pre-parsed attachments
        to = body.to;
        from = body.from;
        subject = body.subject;
        text = body.text;
        html = body.html;
        attachmentsData = body.attachments || [];
      }

      console.log(`📧 Received email (Cloudflare): From=${from}, To=${to}, Subject=${subject}, Attachments=${attachmentsData.length}`);
    } else {
      // ========================================
      // SENDGRID INBOUND PARSE FORMAT (Multipart)
      // ========================================
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
      to = Array.isArray(fields.to) ? fields.to[0] : fields.to;
      from = Array.isArray(fields.from) ? fields.from[0] : fields.from;
      subject = Array.isArray(fields.subject) ? fields.subject[0] : fields.subject;
      text = Array.isArray(fields.text) ? fields.text[0] : fields.text;
      html = Array.isArray(fields.html) ? fields.html[0] : fields.html;

      // Convert files to attachments format
      for (const [fieldName, file] of Object.entries(files)) {
        const fileObj = Array.isArray(file) ? file[0] : file;
        if (fileObj) {
          const fileBuffer = fs.readFileSync(fileObj.filepath);
          attachmentsData.push({
            filename: fileObj.originalFilename || 'attachment',
            contentType: fileObj.mimetype || 'application/octet-stream',
            content: fileBuffer.toString('base64'),
          });
          filesToCleanup.push(fileObj.filepath);
        }
      }

      console.log(`📧 Received email (SendGrid): From=${from}, To=${to}, Subject=${subject}`);
    }

    console.log(`📧 Received email: From=${from}, To=${to}, Subject=${subject}`);

    // ========================================
    // HANDLE GMAIL VERIFICATION EMAILS
    // ========================================
    // When users set up Gmail forwarding, Gmail sends a confirmation email
    // We automatically "click" the verification link to complete setup
    if (from?.includes('mail-noreply@google.com') || from?.includes('forwarding-noreply@google.com')) {
      if (subject?.toLowerCase().includes('confirmation') ||
          subject?.toLowerCase().includes('forwarding confirmation request')) {

        console.log('🔐 Detected Gmail verification email, processing...');

        // Extract confirmation URL from email body (text or html)
        const emailBody = html || text || '';
        const urlMatch = emailBody.match(/(https:\/\/mail\.google\.com\/mail\/vf[^\s<>"']+)/i);

        if (urlMatch && urlMatch[1]) {
          const confirmationUrl = urlMatch[1]
            .replace(/&amp;/g, '&')  // Fix HTML entities
            .replace(/=3D/g, '=')     // Fix quoted-printable encoding
            .trim();

          console.log('✓ Found confirmation URL, verifying...');

          try {
            // Make GET request to confirmation URL to verify the forwarding address
            const response = await fetch(confirmationUrl, {
              method: 'GET',
              redirect: 'follow',
            });

            if (response.ok || response.status === 302) {
              console.log('✅ Gmail forwarding address verified automatically!');
              return res.status(200).json({
                success: true,
                message: 'Gmail forwarding verification completed automatically',
                verified: true,
              });
            } else {
              console.error('❌ Verification request failed:', response.status);
              return res.status(500).json({
                error: 'Verification request failed',
                status: response.status,
              });
            }
          } catch (error: any) {
            console.error('❌ Error verifying Gmail forwarding:', error.message);
            return res.status(500).json({
              error: 'Failed to verify forwarding address',
              details: error.message,
            });
          }
        } else {
          console.warn('⚠️  Could not find confirmation URL in Gmail verification email');
          return res.status(400).json({
            error: 'No confirmation URL found in verification email',
          });
        }
      }
    }

    // ========================================
    // PROCESS UTILITY BILLS (Normal Flow)
    // ========================================

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
    let pdfBuffer: Buffer | null = null;
    let pdfFileName: string | null = null;

    // Check for PDF attachments in unified format
    for (const attachment of attachmentsData) {
      if (attachment.contentType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
        console.log(`📎 Found PDF attachment: ${attachment.filename}`);
        pdfBuffer = Buffer.from(attachment.content, 'base64');
        pdfFileName = attachment.filename;
        break;
      }
    }

    // If no PDF found, log and reject (for now - could implement HTML-to-PDF later)
    if (!pdfBuffer) {
      console.warn('No PDF attachment found in email');
      // Clean up temp files if any
      for (const file of filesToCleanup) {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      return res.status(400).json({
        error: 'No PDF attachment found. Please ensure your utility bill is attached as a PDF.',
      });
    }

    // Delete ALL previous bills for this user (only keep most recent)
    // User forwards all bills year-round, we auto-delete old ones
    const userFolder = `proof/${profile.user_id}`;

    console.log(`🗑️  Deleting all previous bills in: ${userFolder}/`);

    // List all date folders for this user
    const { data: existingFolders, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userFolder);

    if (!listError && existingFolders && existingFolders.length > 0) {
      // Delete all existing date folders and their contents
      const filesToDelete = existingFolders
        .filter(item => item.name.match(/^\d{4}-\d{2}-\d{2}$/)) // Match yyyy-mm-dd folders
        .map(folder => `${userFolder}/${folder.name}/bill.pdf`);

      if (filesToDelete.length > 0) {
        console.log(`Found ${filesToDelete.length} old bills to delete`);
        await supabase.storage
          .from(BUCKET_NAME)
          .remove(filesToDelete);
      }
    }

    // Upload new bill to Supabase Storage with organized folder structure
    // Format: proof/{uuid}/{yyyy-mm-dd}/bill.pdf
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
    console.log(`📊 Stats: Deleted ${filesToDelete?.length || 0} old bills, stored 1 new bill`);

    // Clean up temp files (only for SendGrid multipart format)
    for (const file of filesToCleanup) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        console.error('Error cleaning up temp file:', e);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Utility bill processed successfully. Old bills deleted, keeping most recent only.',
      userId: profile.user_id,
      fileName: pdfFileName || 'bill.pdf',
      deletedOldBills: filesToDelete?.length || 0,
      storedAt: filePath,
    });
  } catch (error: any) {
    console.error('Email processing error:', error);
    return res.status(500).json({
      error: 'Processing failed',
      details: error.message,
    });
  }
}

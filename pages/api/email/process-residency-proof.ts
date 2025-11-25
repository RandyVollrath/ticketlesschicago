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
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { validateResidencyProof } from '../protection/validate-residency-proof';

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

const BUCKET_NAME = 'residency-proofs-temps';

/**
 * Extract key information from utility bill HTML for verification
 */
function extractBillInfo(html: string, subject: string): { serviceAddress?: string; amountDue?: string; dueDate?: string; statementDate?: string } {
  const info: { serviceAddress?: string; amountDue?: string; dueDate?: string; statementDate?: string } = {};

  // Common patterns for service address
  const addressPatterns = [
    /service\s+address[:\s]*([^<\n]+)/i,
    /property\s+address[:\s]*([^<\n]+)/i,
    /(\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)[^<,\n]*(?:,?\s*(?:Chicago|IL|Illinois)[^<\n]*)?)/i,
  ];

  for (const pattern of addressPatterns) {
    const match = html.match(pattern);
    if (match) {
      info.serviceAddress = match[1]?.trim().replace(/\s+/g, ' ');
      break;
    }
  }

  // Common patterns for amount due
  const amountPatterns = [
    /(?:amount\s+due|total\s+due|balance\s+due|current\s+balance)[:\s]*\$?([\d,]+\.?\d*)/i,
    /\$\s*([\d,]+\.\d{2})\s*(?:due|total|balance)/i,
  ];

  for (const pattern of amountPatterns) {
    const match = html.match(pattern);
    if (match) {
      info.amountDue = '$' + match[1];
      break;
    }
  }

  // Common patterns for due date
  const dueDatePatterns = [
    /(?:due\s+date|payment\s+due)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /due\s+(?:by|on)\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];

  for (const pattern of dueDatePatterns) {
    const match = html.match(pattern);
    if (match) {
      info.dueDate = match[1];
      break;
    }
  }

  // Common patterns for statement date (when the bill was generated)
  const statementDatePatterns = [
    /(?:statement\s+date|bill\s+date|invoice\s+date)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(?:dated?|issued)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];

  for (const pattern of statementDatePatterns) {
    const match = html.match(pattern);
    if (match) {
      info.statementDate = match[1];
      break;
    }
  }

  return info;
}

/**
 * Convert HTML email body to PDF
 * Uses Puppeteer with Chromium to render HTML exactly as it appears
 * Adds verification header and extracts key billing information
 */
async function convertHTMLToPDF(html: string, metadata: { from?: string; subject?: string; receivedAt?: Date } = {}): Promise<{ buffer: Buffer; extractedInfo: ReturnType<typeof extractBillInfo> }> {
  console.log('🔄 Converting HTML to PDF...');

  // Extract bill info for logging and verification
  const extractedInfo = extractBillInfo(html, metadata.subject || '');
  console.log('📊 Extracted bill info:', extractedInfo);

  let browser;
  try {
    // Launch Chromium (optimized for serverless)
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    const receivedDate = (metadata.receivedAt || new Date()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Create a professional wrapper around the email content
    const wrappedHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }
    .verification-header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
      padding: 20px 24px;
      margin-bottom: 0;
    }
    .verification-header h1 {
      margin: 0 0 8px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .verification-header .subtitle {
      font-size: 13px;
      opacity: 0.9;
    }
    .metadata-bar {
      background: #e8f4fc;
      border-bottom: 1px solid #c9e0f0;
      padding: 12px 24px;
      font-size: 12px;
      color: #1e3a5f;
    }
    .metadata-bar .item {
      display: inline-block;
      margin-right: 24px;
    }
    .metadata-bar .label {
      font-weight: 600;
      margin-right: 4px;
    }
    .extracted-info {
      background: #f0f9f0;
      border: 1px solid #c3e6c3;
      border-radius: 8px;
      margin: 16px 24px;
      padding: 16px;
    }
    .extracted-info h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #2d5a2d;
    }
    .extracted-info .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    .extracted-info .field {
      font-size: 12px;
    }
    .extracted-info .field-label {
      color: #666;
      font-weight: 500;
    }
    .extracted-info .field-value {
      color: #1a1a1a;
      font-weight: 600;
    }
    .email-content {
      background: white;
      margin: 16px 24px;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .email-content img { max-width: 100%; height: auto; }
    .footer {
      text-align: center;
      padding: 16px 24px;
      font-size: 11px;
      color: #888;
      border-top: 1px solid #e0e0e0;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="verification-header">
    <h1>📧 Utility Bill - Proof of Residency</h1>
    <div class="subtitle">Document captured via email forwarding for address verification</div>
  </div>

  <div class="metadata-bar">
    <span class="item"><span class="label">From:</span> ${metadata.from || 'Unknown'}</span>
    <span class="item"><span class="label">Subject:</span> ${metadata.subject || 'Utility Bill'}</span>
    <span class="item"><span class="label">Received:</span> ${receivedDate}</span>
  </div>

  ${extractedInfo.serviceAddress || extractedInfo.amountDue || extractedInfo.dueDate ? `
  <div class="extracted-info">
    <h3>✅ Extracted Verification Details</h3>
    <div class="grid">
      ${extractedInfo.serviceAddress ? `<div class="field"><span class="field-label">Service Address:</span><br><span class="field-value">${extractedInfo.serviceAddress}</span></div>` : ''}
      ${extractedInfo.statementDate ? `<div class="field"><span class="field-label">Statement Date:</span><br><span class="field-value">${extractedInfo.statementDate}</span></div>` : ''}
      ${extractedInfo.amountDue ? `<div class="field"><span class="field-label">Amount Due:</span><br><span class="field-value">${extractedInfo.amountDue}</span></div>` : ''}
      ${extractedInfo.dueDate ? `<div class="field"><span class="field-label">Due Date:</span><br><span class="field-value">${extractedInfo.dueDate}</span></div>` : ''}
    </div>
  </div>
  ` : ''}

  <div class="email-content">
    ${html}
  </div>

  <div class="footer">
    This document was automatically generated from a forwarded email on ${receivedDate}.<br>
    Autopilot America - Proof of Residency Verification System
  </div>
</body>
</html>`;

    await page.setContent(wrappedHTML, { waitUntil: 'networkidle0', timeout: 30000 });

    // Generate PDF with Letter size (standard for utility bills)
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.25in',
        right: '0.25in',
        bottom: '0.25in',
        left: '0.25in',
      },
    });

    console.log('✅ HTML converted to PDF successfully');
    return { buffer: Buffer.from(pdfBuffer), extractedInfo };
  } catch (error: any) {
    console.error('❌ HTML to PDF conversion failed:', error);
    throw new Error(`HTML to PDF conversion failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

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
    let documentSource: 'email_attachment' | 'email_html' = 'email_attachment';

    // Priority 1: Check for PDF attachments in unified format
    for (const attachment of attachmentsData) {
      if (attachment.contentType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
        console.log(`📎 Found PDF attachment: ${attachment.filename}`);
        pdfBuffer = Buffer.from(attachment.content, 'base64');
        pdfFileName = attachment.filename;
        documentSource = 'email_attachment';
        break;
      }
    }

    // Priority 2: Convert HTML email body to PDF if no PDF attachment
    // Works for both full bills AND notification emails (ComEd/Peoples Gas notifications contain address, amount, due date)
    let extractedBillInfo: { serviceAddress?: string; accountNumber?: string; amountDue?: string; dueDate?: string } | null = null;

    if (!pdfBuffer && html && html.trim().length > 50) {
      console.log('📧 No PDF attachment found, attempting HTML to PDF conversion...');
      console.log(`HTML length: ${html.length} characters`);
      console.log('HTML preview:', html.substring(0, 300));

      try {
        const result = await convertHTMLToPDF(html, {
          from: from || undefined,
          subject: subject || undefined,
          receivedAt: new Date()
        });
        pdfBuffer = result.buffer;
        extractedBillInfo = result.extractedInfo;
        pdfFileName = 'utility-bill-from-email.pdf';
        documentSource = 'email_html';
        console.log('✅ Successfully converted HTML email to PDF');
        if (extractedBillInfo.serviceAddress) {
          console.log(`📍 Extracted service address: ${extractedBillInfo.serviceAddress}`);
        }
      } catch (error: any) {
        console.error('❌ HTML to PDF conversion failed:', error.message);
        // Fall through to error below
      }
    }

    // Priority 3: No usable content found
    if (!pdfBuffer) {
      console.warn('No PDF attachment or HTML content found in email');
      // Clean up temp files if any
      for (const file of filesToCleanup) {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      return res.status(400).json({
        error: 'No utility bill found. Please forward an email with a PDF attachment or full bill details.',
        hint: 'Emails with just "Your bill is ready" notifications won\'t work. You need to attach the actual bill PDF or forward an email containing the full bill details.',
      });
    }

    // Delete ALL previous bills for this user (only keep most recent)
    // User forwards all bills year-round, we auto-delete old ones
    const userFolder = `proof/${profile.user_id}`;
    let filesToDelete: string[] = [];

    console.log(`🗑️  Deleting all previous bills in: ${userFolder}/`);

    // List all date folders for this user
    const { data: existingFolders, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userFolder);

    if (!listError && existingFolders && existingFolders.length > 0) {
      // Delete all existing date folders and their contents
      filesToDelete = existingFolders
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

    // Run OCR validation on the uploaded document
    console.log('🔍 Running OCR validation on residency proof...');
    let validationResult = null;
    let autoApproved = false;

    try {
      validationResult = await validateResidencyProof(
        pdfBuffer,
        profile.home_address_full || '',
        profile.city_sticker_expiry
      );

      autoApproved = validationResult.isValid;
      console.log(`📊 Validation result: ${autoApproved ? 'AUTO-APPROVED' : 'NEEDS REVIEW'}`);
      console.log(`   Document type: ${validationResult.documentType || 'unknown'}`);
      console.log(`   Address match: ${validationResult.addressMatch?.matches ? 'YES' : 'NO'}`);
      console.log(`   Valid until: ${validationResult.dates.documentValidUntil || 'unknown'}`);
      if (validationResult.issues.length > 0) {
        console.log(`   Issues: ${validationResult.issues.join(', ')}`);
      }
    } catch (validationError: any) {
      console.error('❌ Validation failed:', validationError.message);
      // Continue without validation - will need manual review
    }

    // Update user profile with document metadata and validation results
    const updateData: any = {
      residency_proof_path: filePath,
      residency_proof_uploaded_at: new Date().toISOString(),
      residency_proof_source: documentSource,
      residency_proof_type: validationResult?.documentType || 'utility_bill',
      residency_proof_verified: autoApproved,
      residency_proof_verified_at: autoApproved ? new Date().toISOString() : null,
      residency_proof_validation: validationResult ? {
        ...validationResult,
        rawText: undefined, // Don't store raw OCR text (too large, PII)
      } : null,
      residency_proof_validated_at: validationResult ? new Date().toISOString() : null,
    };

    // Store extracted info for admin review
    if (extractedBillInfo) {
      updateData.residency_proof_extracted_info = extractedBillInfo;
    }

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', profile.user_id);

    if (updateError) {
      console.error('Profile update error:', updateError);
      // Don't fail the request - bill is uploaded successfully
    }

    console.log(`✅ Successfully processed utility bill for user ${profile.user_id}`);
    console.log(`📊 Stats: Deleted ${filesToDelete?.length || 0} old bills, stored 1 new bill`);
    console.log(`📄 Source: ${documentSource}, Auto-approved: ${autoApproved}`);

    // Clean up temp files (only for SendGrid multipart format)
    for (const file of filesToCleanup) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        console.error('Error cleaning up temp file:', e);
      }
    }

    const message = autoApproved
      ? 'Utility bill verified automatically! Address matches and document is valid.'
      : 'Utility bill received. Pending verification - address or dates could not be confirmed automatically.';

    return res.status(200).json({
      success: true,
      message,
      userId: profile.user_id,
      fileName: pdfFileName || 'bill.pdf',
      source: documentSource,
      autoApproved,
      needsReview: !autoApproved,
      validation: validationResult ? {
        documentType: validationResult.documentType,
        addressMatch: validationResult.addressMatch?.matches,
        validUntil: validationResult.dates.documentValidUntil,
        issues: validationResult.issues,
      } : null,
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

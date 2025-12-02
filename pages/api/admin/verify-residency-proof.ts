/**
 * Admin API to verify or reject residency proof documents
 * Handles lease, mortgage, property tax, and utility bill documents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

const REJECTION_REASONS = {
  DOCUMENT_UNREADABLE: 'Document is not clear or readable',
  DOCUMENT_EXPIRED: 'Document has expired or is too old',
  WRONG_DOCUMENT_TYPE: 'This document type is not acceptable for proof of residency',
  ADDRESS_MISMATCH: 'Address on document does not match the address in your profile',
  NAME_MISMATCH: 'Name on document does not match your account name',
  MISSING_INFO: 'Document is missing required information (name, address, or date)',
  NOTIFICATION_ONLY: 'This appears to be a notification email, not an actual bill. Please forward an email with full bill details or attach a PDF.',
  CELL_PHONE_BILL: 'Cell phone bills are not accepted. Please provide a landline phone, utility bill, lease, mortgage, or property tax document.',
  SCREENSHOT: 'Screenshots are not acceptable. Please provide the original document or PDF.',
  OTHER: 'Other issue (see details below)',
};

interface VerifyRequest {
  userId: string;
  action: 'approve' | 'reject';
  rejectionReasons?: string[];
  customReason?: string;
  notes?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check admin authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_API_TOKEN || 'ticketless2025admin';
  if (token !== adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { userId, action, rejectionReasons, customReason, notes } = req.body as VerifyRequest;

    if (!userId || !action) {
      return res.status(400).json({ success: false, error: 'userId and action are required' });
    }

    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Get current user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const userEmail = profile.email;
    const userName = profile.first_name || 'User';

    if (action === 'approve') {
      // Mark as verified
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          residency_proof_verified: true,
          residency_proof_verified_at: new Date().toISOString(),
          residency_proof_rejection_reason: null,
        })
        .eq('user_id', userId);

      if (updateError) {
        throw updateError;
      }

      // Send approval email to user (using Resend)
      if (userEmail && process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Autopilot America <noreply@autopilotamerica.com>',
              to: [userEmail],
              subject: '✅ Your Proof of Residency Has Been Verified',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">✅ Document Verified!</h1>
                  </div>
                  <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                    <p>Hi ${userName},</p>
                    <p>Great news! Your proof of residency document has been verified. Your residential parking permit application can now proceed.</p>
                    <p><strong>What's Next:</strong></p>
                    <ul>
                      <li>Your parking permit will be processed</li>
                      <li>You'll receive a confirmation when it's ready</li>
                      <li>Keep your document on file - you may need to renew it annually</li>
                    </ul>
                    <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                      Questions? Reply to this email or contact support@autopilotamerica.com
                    </p>
                  </div>
                </div>
              `,
            }),
          });
          console.log(`✅ Sent verification approval email to ${userEmail}`);
        } catch (emailError) {
          console.error('Failed to send approval email:', emailError);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Document approved successfully',
        emailSent: !!userEmail,
      });

    } else if (action === 'reject') {
      // Build rejection message
      const reasons = (rejectionReasons || [])
        .map(key => REJECTION_REASONS[key as keyof typeof REJECTION_REASONS] || key)
        .join('\n• ');

      const fullReason = [
        reasons ? `• ${reasons}` : '',
        customReason ? `\nAdditional notes: ${customReason}` : '',
      ].filter(Boolean).join('');

      // Update profile with rejection
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          residency_proof_verified: false,
          residency_proof_rejection_reason: fullReason,
          residency_proof_path: null, // Clear the document so they can upload a new one
          residency_proof_type: null,
          residency_proof_source: null,
        })
        .eq('user_id', userId);

      if (updateError) {
        throw updateError;
      }

      // Send rejection email to user
      if (userEmail && process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Autopilot America <noreply@autopilotamerica.com>',
              to: [userEmail],
              subject: '📋 Action Required: Please Re-submit Proof of Residency',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">📋 Document Review Update</h1>
                  </div>
                  <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                    <p>Hi ${userName},</p>
                    <p>We've reviewed your proof of residency document, but we need you to submit a new document.</p>

                    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
                      <strong style="color: #92400e;">Reason:</strong>
                      <div style="color: #78350f; margin-top: 8px; white-space: pre-wrap;">${fullReason}</div>
                    </div>

                    <p><strong>Acceptable Documents:</strong></p>
                    <ul>
                      <li>Lease agreement (signed, showing your name and address)</li>
                      <li>Mortgage statement (recent, showing your name and property address)</li>
                      <li>Property tax bill (current year)</li>
                      <li>Utility bill (ComEd, Peoples Gas, water) - must be within 30 days</li>
                    </ul>

                    <p><strong>How to Submit:</strong></p>
                    <ol>
                      <li>Log in to your account at <a href="https://ticketlesschicago.com/settings">ticketlesschicago.com/settings</a></li>
                      <li>Go to the "Proof of Residency" section</li>
                      <li>Upload a new document</li>
                    </ol>

                    <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                      Need help? Reply to this email or contact support@autopilotamerica.com
                    </p>
                  </div>
                </div>
              `,
            }),
          });
          console.log(`✅ Sent rejection email to ${userEmail}`);
        } catch (emailError) {
          console.error('Failed to send rejection email:', emailError);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Document rejected, user notified',
        emailSent: !!userEmail,
      });
    }

    return res.status(400).json({ success: false, error: 'Invalid action' });

  } catch (error: any) {
    console.error('Error verifying document:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

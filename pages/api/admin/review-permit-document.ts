import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const resend = new Resend(process.env.RESEND_API_KEY);

interface ReviewResponse {
  success: boolean;
  error?: string;
}

// Common rejection reasons
export const REJECTION_REASONS = {
  ID_NOT_CLEAR: 'ID document is not clear or readable',
  ID_EXPIRED: 'ID document has expired',
  ID_WRONG_TYPE: 'ID document type is not acceptable (must be driver\'s license, state ID, passport, or military ID)',
  PROOF_NOT_CLEAR: 'Proof of residency is not clear or readable',
  PROOF_OLD: 'Utility bill is older than 30 days',
  PROOF_WRONG_TYPE: 'Proof of residency type is not acceptable',
  ADDRESS_MISMATCH: 'Address on proof of residency does not match the address you provided',
  NAME_MISMATCH: 'Name on documents does not match between ID and proof of residency',
  MISSING_INFO: 'Document is missing required information',
  CELL_PHONE_BILL: 'Cell phone bills are not accepted - please provide a landline phone, utility, or other acceptable document',
  OTHER: 'Other issue (see details below)',
};

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { documentId, action, rejectionReasons, customReason, customerCode } = req.body;

  if (!documentId) {
    return res.status(400).json({ success: false, error: 'Document ID is required' });
  }

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action' });
  }

  if (action === 'reject' && (!rejectionReasons || rejectionReasons.length === 0)) {
    return res.status(400).json({ success: false, error: 'Rejection reasons are required' });
  }

  if (action === 'approve' && !customerCode) {
    return res.status(400).json({ success: false, error: 'Customer code is required for approval' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // documentId can be:
    // - A numeric ID from permit_zone_documents table (legacy)
    // - "profile-{user_id}" from residencyProofDocuments
    // - A raw user_id (UUID)
    let userId = documentId;

    // Handle profile-{user_id} format from residencyProofDocuments
    if (typeof documentId === 'string' && documentId.startsWith('profile-')) {
      userId = documentId.replace('profile-', '');
    }

    // Get the user profile with document info
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, street_address, residency_proof_path, residency_proof_verified')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Document not found');
    }

    if (!profile.residency_proof_path) {
      throw new Error('No residency proof uploaded for this user');
    }

    // Build update data for user_profiles
    const updateData: any = {
      residency_proof_verified: action === 'approve',
      residency_proof_verified_at: new Date().toISOString(),
    };

    if (action === 'approve') {
      updateData.permit_zone_number = customerCode; // Store customer code as permit zone number
      updateData.residency_proof_rejection_reason = null;
    } else {
      // Build rejection reason message
      const selectedReasons = rejectionReasons.map((key: string) => REJECTION_REASONS[key as keyof typeof REJECTION_REASONS]).filter(Boolean);
      let rejectionMessage = selectedReasons.join('\n• ');
      if (customReason) {
        rejectionMessage += '\n\nAdditional details: ' + customReason;
      }
      updateData.residency_proof_rejection_reason = rejectionMessage;
      updateData.permit_zone_number = null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Update error:', updateError);
      throw new Error('Failed to update document');
    }

    // Log audit event
    await logAuditEvent({
      userId: profile.user_id,
      actionType: 'document_reviewed',
      entityType: 'permit_document',
      entityId: userId,
      actionDetails: {
        action: action,
        customerCode: action === 'approve' ? customerCode : null,
        rejectionReasons: action === 'reject' ? rejectionReasons : null,
        customReason: action === 'reject' ? customReason : null,
        address: profile.street_address,
      },
      status: 'success',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    // Send email to user
    const userEmail = profile.email;
    const userName = profile.first_name || 'there';

    if (userEmail) {
      try {
        if (action === 'approve') {
          await resend.emails.send({
            from: 'Autopilot America <hello@autopilotamerica.com>',
            to: userEmail,
            subject: 'Your Permit Zone Documents Have Been Approved! ✅',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Great news, ${userName}!</h2>
                <p>Your permit zone documents have been approved and we're processing your residential parking permit.</p>
                <div style="background-color: #f0f9ff; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Address:</strong> ${profile.street_address}</p>
                  <p style="margin: 8px 0 0 0;"><strong>Customer Code:</strong> ${customerCode}</p>
                </div>
                <p>We'll purchase your permit from the City of Chicago on your behalf. You should receive it at your address within 2-3 weeks.</p>
                <p>If you have any questions, just reply to this email.</p>
                <p>Best,<br>The Autopilot America Team</p>
              </div>
            `,
          });
        } else {
          await resend.emails.send({
            from: 'Autopilot America <hello@autopilotamerica.com>',
            to: userEmail,
            subject: 'Action Needed: Permit Zone Documents',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hi ${userName},</h2>
                <p>We reviewed your permit zone documents for <strong>${profile.street_address}</strong>, but unfortunately we need you to resubmit them.</p>
                <div style="background-color: #fef3c7; padding: 16px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                  <h3 style="margin-top: 0; color: #92400e;">Issues found:</h3>
                  <ul style="margin: 8px 0; padding-left: 20px; line-height: 1.8;">
                    ${rejectionReasons.map((key: string) => {
                      const reason = REJECTION_REASONS[key as keyof typeof REJECTION_REASONS];
                      return reason ? `<li>${reason}</li>` : '';
                    }).join('')}
                  </ul>
                  ${customReason ? `<p style="margin: 12px 0 0 0;"><strong>Additional details:</strong> ${customReason}</p>` : ''}
                </div>
                <p>Please log in to your account and upload new documents that address these issues:</p>
                <p style="text-align: center; margin: 24px 0;">
                  <a href="https://ticketlessamerica.com/dashboard" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                    Upload New Documents
                  </a>
                </p>
                <p>If you have any questions, just reply to this email and we'll be happy to help.</p>
                <p>Best,<br>The Autopilot America Team</p>
              </div>
            `,
          });
        }
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('Error reviewing document:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
});

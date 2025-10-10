import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { del } from '@vercel/blob';

/**
 * Cron job to delete permit zone documents older than 60 days after approval
 * Security best practice: Don't store driver's licenses and utility bills indefinitely
 *
 * Keeps only:
 * - Customer Code
 * - Approval status
 * - Address
 * - Review metadata
 *
 * Runs daily to clean up approved documents > 60 days old
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is actually a cron job (Vercel sends this header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Find approved documents older than 60 days that still have files
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: oldDocuments, error: fetchError } = await supabaseAdmin
      .from('permit_zone_documents')
      .select('*')
      .eq('verification_status', 'approved')
      .lt('reviewed_at', sixtyDaysAgo.toISOString())
      .neq('id_document_url', '')
      .neq('id_document_filename', 'customer_code_provided');

    if (fetchError) {
      console.error('Error fetching old documents:', fetchError);
      throw fetchError;
    }

    if (!oldDocuments || oldDocuments.length === 0) {
      console.log('No documents to clean up');
      return res.status(200).json({
        success: true,
        message: 'No documents to clean up',
        deleted: 0
      });
    }

    console.log(`Found ${oldDocuments.length} documents to clean up`);

    let deletedCount = 0;
    const errors: any[] = [];

    for (const doc of oldDocuments) {
      try {
        // Delete files from Vercel Blob storage
        const filesToDelete: string[] = [];

        if (doc.id_document_url && doc.id_document_url !== '') {
          filesToDelete.push(doc.id_document_url);
        }
        if (doc.proof_of_residency_url && doc.proof_of_residency_url !== '') {
          filesToDelete.push(doc.proof_of_residency_url);
        }

        // Delete each file
        for (const fileUrl of filesToDelete) {
          try {
            await del(fileUrl);
            console.log(`Deleted file: ${fileUrl}`);
          } catch (delError) {
            console.error(`Error deleting file ${fileUrl}:`, delError);
            // Continue even if file deletion fails (file might already be gone)
          }
        }

        // Update database record to remove file URLs but keep Customer Code and metadata
        const { error: updateError } = await supabaseAdmin
          .from('permit_zone_documents')
          .update({
            id_document_url: '',
            id_document_filename: `deleted_after_60_days_${Date.now()}`,
            proof_of_residency_url: '',
            proof_of_residency_filename: `deleted_after_60_days_${Date.now()}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        if (updateError) {
          console.error(`Error updating document ${doc.id}:`, updateError);
          errors.push({ id: doc.id, error: updateError });
        } else {
          deletedCount++;
          console.log(`✅ Cleaned up document ${doc.id} for user ${doc.user_id}`);
        }
      } catch (docError) {
        console.error(`Error processing document ${doc.id}:`, docError);
        errors.push({ id: doc.id, error: docError });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} documents`,
      deleted: deletedCount,
      total: oldDocuments.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error('Cleanup cron error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

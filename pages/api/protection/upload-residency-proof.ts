/**
 * Upload Residency Proof Document
 *
 * Stores residency proof documents (utility bills, leases, etc.) for verification.
 * Uses service role key to bypass RLS restrictions.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
  },
};

const BUCKET_NAME = 'residency-proofs-temps';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);

    const userId = fields.userId?.[0];
    const documentType = fields.documentType?.[0];
    const file = files.document?.[0];

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!documentType) {
      return res.status(400).json({ error: 'documentType is required' });
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    const mimeType = file.mimetype || '';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(400).json({
        error: `Invalid file type: ${mimeType}. Allowed: PDF, JPG, PNG`
      });
    }

    // Read file
    const fileBuffer = fs.readFileSync(file.filepath);

    // Generate unique filename
    const ext = file.originalFilename?.split('.').pop() || 'pdf';
    const fileName = `${userId}_${Date.now()}.${ext}`;
    const filePath = `residency-proofs/${fileName}`;

    console.log(`📄 Uploading residency proof: ${filePath} (${fileBuffer.length} bytes)`);

    // Upload to Supabase Storage
    const { error: uploadError, data: uploadData } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      return res.status(500).json({ error: 'Upload failed. Please try again.' });
    }

    console.log(`✅ Uploaded successfully: ${filePath}`);

    // Update user profile with file path (not public URL - bucket is private)
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath, // Store path, not URL - view API generates signed URLs
        residency_proof_type: documentType,
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_verified: false
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('❌ Profile update error:', updateError);
      return res.status(500).json({ error: 'Failed to save upload. Please try again.' });
    }

    // Cleanup temp file
    try {
      fs.unlinkSync(file.filepath);
    } catch (e) {
      // Ignore cleanup errors
    }

    return res.status(200).json({
      success: true,
      filePath
    });

  } catch (error: any) {
    console.error('❌ Upload handler error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

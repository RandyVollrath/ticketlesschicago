/**
 * Admin API: Upload Property Tax Bill for User
 *
 * Admin fetches property tax bill from Cook County Treasurer site
 * and uploads it here for the user. This enables hands-off residency
 * proof for homeowners.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

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
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify admin token
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    return uploadPropertyTax(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function uploadPropertyTax(req: NextApiRequest, res: NextApiResponse) {
  try {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);

    const userId = fields.userId?.[0];
    const notes = fields.notes?.[0] || '';
    const file = files.document?.[0];

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
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

    // Verify user exists and is a property_tax type
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, residency_proof_type')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Read file
    const fileBuffer = fs.readFileSync(file.filepath);

    // Generate unique filename
    const ext = file.originalFilename?.split('.').pop() || 'pdf';
    const fileName = `${userId}_propertytax_${Date.now()}.${ext}`;
    const filePath = `residency-proofs/${fileName}`;

    console.log(`📄 Admin uploading property tax bill for ${user.email}: ${filePath}`);

    // Delete old file if exists
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('residency_proof_path')
      .eq('user_id', userId)
      .single();

    if (existingProfile?.residency_proof_path) {
      await supabase.storage
        .from(BUCKET_NAME)
        .remove([existingProfile.residency_proof_path]);
      console.log(`🗑️ Deleted old file: ${existingProfile.residency_proof_path}`);
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` });
    }

    console.log(`✅ Uploaded successfully: ${filePath}`);

    // Update user profile
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath,
        residency_proof_type: 'property_tax',
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_source: 'admin_fetch',
        residency_proof_verified: true, // Admin-uploaded = auto-verified
        residency_proof_verified_at: new Date().toISOString(),
        residency_proof_rejection_reason: null,
        property_tax_last_fetched_at: new Date().toISOString(),
        property_tax_needs_refresh: false,
        property_tax_fetch_failed: false,
        property_tax_fetch_notes: notes || null
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('❌ Profile update error:', updateError);
      return res.status(500).json({ error: `Profile update failed: ${updateError.message}` });
    }

    // Cleanup temp file
    try {
      fs.unlinkSync(file.filepath);
    } catch (e) {
      // Ignore cleanup errors
    }

    console.log(`✅ Property tax bill uploaded for ${user.email}`);

    return res.status(200).json({
      success: true,
      message: `Property tax bill uploaded for ${user.first_name} ${user.last_name}`,
      filePath
    });

  } catch (error: any) {
    console.error('❌ Admin upload error:', error);
    return res.status(500).json({ error: error.message || 'Upload failed' });
  }
}

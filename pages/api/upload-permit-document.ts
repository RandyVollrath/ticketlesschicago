import type { NextApiRequest, NextApiResponse } from 'next';
import { put } from '@vercel/blob';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { supabase } from '../../lib/supabase';

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for file uploads
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    // Parse the uploaded file
    const form = new IncomingForm();

    const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!documentType || (documentType !== 'drivers_license' && documentType !== 'proof_of_residency')) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    // Validate file type (only allow images and PDFs)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype || '')) {
      return res.status(400).json({ error: 'Invalid file type. Please upload an image (JPG, PNG, HEIC) or PDF.' });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }

    // Read the file
    const fileBuffer = fs.readFileSync(file.filepath);

    // Generate a unique filename
    const timestamp = Date.now();
    const fileExtension = file.originalFilename?.split('.').pop() || 'jpg';
    const blobPath = `permit-documents/${user.id}/${documentType}_${timestamp}.${fileExtension}`;

    // Upload to Vercel Blob
    const blob = await put(blobPath, fileBuffer, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
    });

    console.log('📄 Document uploaded to Vercel Blob:', blob.url);

    // Update user profile with the document URL
    const updateField = documentType === 'drivers_license' ? 'drivers_license_url' : 'proof_of_residency_url';

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        [updateField]: blob.url,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating user profile:', updateError);
      return res.status(500).json({ error: 'Failed to save document reference' });
    }

    // Check if both documents are now uploaded
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('drivers_license_url, proof_of_residency_url, permit_requested, permit_application_status')
      .eq('user_id', user.id)
      .single();

    let newStatus = profile?.permit_application_status;

    // If user requested a permit and both documents are uploaded, update status
    if (profile?.permit_requested && profile?.drivers_license_url && profile?.proof_of_residency_url) {
      newStatus = 'documents_uploaded';

      await supabase
        .from('user_profiles')
        .update({
          permit_application_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
    }

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    return res.status(200).json({
      success: true,
      url: blob.url,
      documentType,
      permitApplicationStatus: newStatus,
    });

  } catch (error: any) {
    console.error('Document upload error:', error);
    return res.status(500).json({ error: error.message || 'Failed to upload document' });
  }
}

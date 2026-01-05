/**
 * Upload Property Tax Appeal Document
 *
 * Upload supporting documents for a property tax appeal
 * (photos, appraisals, permits, etc.)
 *
 * POST /api/property-tax/upload-document
 * Body: { appealId: string, documentType: string, imageData: string, imageType: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Allowed document types
const DOCUMENT_TYPES = [
  'property_photo',
  'interior_photo',
  'comparable_photo',
  'property_deed',
  'recent_appraisal',
  'purchase_agreement',
  'building_permit',
  'inspection_report',
  'damage_photo',
  'insurance_report',
  'appeal_form',
  'appeal_letter',
  'bor_decision',
  'ccao_decision',
  'other'
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'upload');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many uploads. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'upload');

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to upload documents' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in to upload documents' });
    }

    const { appealId, documentType, imageData, imageType, fileName } = req.body;

    // Validate required fields
    if (!appealId) {
      return res.status(400).json({ error: 'Appeal ID is required' });
    }

    if (!documentType || !DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({
        error: 'Invalid document type',
        validTypes: DOCUMENT_TYPES
      });
    }

    if (!imageData) {
      return res.status(400).json({ error: 'Document data is required' });
    }

    // Verify appeal ownership
    const { data: appeal } = await supabase
      .from('property_tax_appeals')
      .select('id, pin')
      .eq('id', appealId)
      .eq('user_id', user.id)
      .single();

    if (!appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Determine file extension from type
    const typeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };

    const ext = typeToExt[imageType] || 'bin';

    // Upload to storage
    const storagePath = `${user.id}/${appealId}/${documentType}-${Date.now()}.${ext}`;
    const base64Data = imageData.split(',')[1] || imageData;
    const buffer = Buffer.from(base64Data, 'base64');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('property-tax-documents')
      .upload(storagePath, buffer, {
        contentType: imageType,
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload document' });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('property-tax-documents')
      .getPublicUrl(storagePath);

    // Create document record
    const { data: document, error: docError } = await supabase
      .from('property_tax_documents')
      .insert({
        appeal_id: appealId,
        user_id: user.id,
        document_type: documentType,
        document_url: urlData.publicUrl,
        file_name: fileName || `${documentType}.${ext}`,
        file_size: buffer.length,
        mime_type: imageType
      })
      .select()
      .single();

    if (docError) {
      console.error('Document record error:', docError);
      return res.status(500).json({ error: 'Failed to save document record' });
    }

    return res.status(201).json({
      success: true,
      document: {
        id: document.id,
        type: document.document_type,
        url: document.document_url,
        fileName: document.file_name,
        fileSize: document.file_size
      }
    });

  } catch (error) {
    console.error('Upload document error:', error);
    return res.status(500).json({
      error: 'An error occurred while uploading the document'
    });
  }
}

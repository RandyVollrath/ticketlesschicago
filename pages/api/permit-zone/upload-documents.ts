import type { NextApiRequest, NextApiResponse } from 'next';
import { put } from '@vercel/blob';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

// Disable body parser to handle multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

interface UploadResponse {
  success: boolean;
  documentId?: number;
  error?: string;
}

// Parse multipart form data manually
async function parseMultipartForm(req: NextApiRequest): Promise<{
  fields: Record<string, string>;
  files: Record<string, { filename: string; data: Buffer; contentType: string }>;
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);

      if (!boundaryMatch) {
        reject(new Error('No boundary found in content-type'));
        return;
      }

      const boundary = boundaryMatch[1];
      const parts = buffer.toString('binary').split(`--${boundary}`);

      const fields: Record<string, string> = {};
      const files: Record<string, { filename: string; data: Buffer; contentType: string }> = {};

      for (const part of parts) {
        if (part.includes('Content-Disposition')) {
          const nameMatch = part.match(/name="([^"]+)"/);
          const filenameMatch = part.match(/filename="([^"]+)"/);
          const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);

          if (nameMatch) {
            const name = nameMatch[1];
            const headerEnd = part.indexOf('\r\n\r\n');

            if (headerEnd !== -1) {
              const value = part.substring(headerEnd + 4, part.length - 2);

              if (filenameMatch) {
                // It's a file
                const filename = filenameMatch[1];
                const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';
                files[name] = {
                  filename,
                  data: Buffer.from(value, 'binary'),
                  contentType
                };
              } else {
                // It's a regular field
                fields[name] = value.trim();
              }
            }
          }
        }
      }

      resolve({ fields, files });
    });

    req.on('error', reject);
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Rate limiting - 20 uploads per hour per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'upload');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too many upload attempts. Please try again later.',
    });
  }
  await recordRateLimitAction(clientIp, 'upload');

  try {
    // Parse the multipart form data
    const { fields, files } = await parseMultipartForm(req);

    // Validate required fields
    const { userId, address, customerCode } = fields;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    if (!address) {
      return res.status(400).json({ success: false, error: 'Address is required' });
    }

    // Check if user provided a Customer Code instead of documents
    if (customerCode && customerCode.trim()) {
      // User has an existing Customer Code - save it directly
      if (!supabaseAdmin) {
        throw new Error('Database not available');
      }

      const { data: document, error: dbError } = await supabaseAdmin
        .from('permit_zone_documents')
        .insert({
          user_id: userId,
          id_document_url: '',
          id_document_filename: 'customer_code_provided',
          proof_of_residency_url: '',
          proof_of_residency_filename: 'customer_code_provided',
          address: address,
          verification_status: 'approved', // Auto-approve if they have a customer code
          customer_code: customerCode.trim(),
        })
        .select()
        .single();

      if (dbError) {
        console.error('Database error:', dbError);
        throw new Error('Failed to save customer code to database');
      }

      // Update user's current permit document reference
      await supabaseAdmin
        .from('users')
        .update({ current_permit_document_id: document.id })
        .eq('id', userId);

      return res.status(200).json({
        success: true,
        documentId: document.id
      });
    }

    // Otherwise, validate and upload documents
    const idDocument = files['idDocument'];
    const proofOfResidency = files['proofOfResidency'];

    if (!idDocument) {
      return res.status(400).json({ success: false, error: 'ID document is required' });
    }

    if (!proofOfResidency) {
      return res.status(400).json({ success: false, error: 'Proof of residency is required' });
    }

    // Validate file types (accept images and PDFs)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'application/pdf'];

    if (!allowedTypes.includes(idDocument.contentType)) {
      return res.status(400).json({
        success: false,
        error: 'ID document must be an image (JPG, PNG, HEIC) or PDF'
      });
    }

    if (!allowedTypes.includes(proofOfResidency.contentType)) {
      return res.status(400).json({
        success: false,
        error: 'Proof of residency must be an image (JPG, PNG, HEIC) or PDF'
      });
    }

    // Validate file sizes (max 10MB each)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (idDocument.data.length > maxSize) {
      return res.status(400).json({ success: false, error: 'ID document is too large (max 10MB)' });
    }

    if (proofOfResidency.data.length > maxSize) {
      return res.status(400).json({
        success: false,
        error: 'Proof of residency is too large (max 10MB)'
      });
    }

    // Upload files to Vercel Blob
    const timestamp = Date.now();
    const idBlob = await put(
      `permit-docs/${userId}/id-${timestamp}-${idDocument.filename}`,
      idDocument.data,
      {
        access: 'private', // SECURITY: Government IDs must be private
        contentType: idDocument.contentType,
      }
    );

    const residencyBlob = await put(
      `permit-docs/${userId}/residency-${timestamp}-${proofOfResidency.filename}`,
      proofOfResidency.data,
      {
        access: 'private', // SECURITY: Residency documents must be private
        contentType: proofOfResidency.contentType,
      }
    );

    // Save to database
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    const { data: document, error: dbError } = await supabaseAdmin
      .from('permit_zone_documents')
      .insert({
        user_id: userId,
        id_document_url: idBlob.url,
        id_document_filename: idDocument.filename,
        proof_of_residency_url: residencyBlob.url,
        proof_of_residency_filename: proofOfResidency.filename,
        address: address,
        verification_status: 'pending',
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to save documents to database');
    }

    // Update user's current permit document reference
    await supabaseAdmin
      .from('users')
      .update({ current_permit_document_id: document.id })
      .eq('id', userId);

    return res.status(200).json({
      success: true,
      documentId: document.id
    });

  } catch (error: any) {
    console.error('Error uploading documents:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}

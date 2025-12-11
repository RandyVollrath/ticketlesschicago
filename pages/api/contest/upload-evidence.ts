import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

// Valid evidence types
const VALID_EVIDENCE_TYPES = ['sign_photo', 'location_photo', 'ticket_photo', 'permit', 'receipt', 'other_document'] as const;
type EvidenceType = typeof VALID_EVIDENCE_TYPES[number];

function validateEvidenceType(value: string | undefined): EvidenceType {
  if (value && VALID_EVIDENCE_TYPES.includes(value as EvidenceType)) {
    return value as EvidenceType;
  }
  return 'other_document';
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false, // Disable body parser to handle multipart/form-data
  },
};

interface EvidenceFile {
  url: string;
  type: 'sign_photo' | 'location_photo' | 'ticket_photo' | 'permit' | 'receipt' | 'other_document';
  filename: string;
  uploaded_at: string;
  description?: string;
  file_size: number;
  mime_type: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - 20 uploads per hour per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'upload');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many upload attempts. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'upload');

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Parse multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 10, // Max 10 files per upload
      multiples: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const contestId = Array.isArray(fields.contestId) ? fields.contestId[0] : fields.contestId;
    const evidenceType = Array.isArray(fields.evidenceType) ? fields.evidenceType[0] : fields.evidenceType;
    const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;

    if (!contestId) {
      return res.status(400).json({ error: 'Missing contest ID' });
    }

    // Verify contest belongs to user
    const { data: contest, error: contestError } = await supabase
      .from('ticket_contests')
      .select('id, user_id, evidence_photos, supporting_documents')
      .eq('id', contestId)
      .eq('user_id', user.id)
      .single();

    if (contestError || !contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Process uploaded files
    const uploadedFiles: EvidenceFile[] = [];
    const fileArray = Array.isArray(files.files) ? files.files : [files.files].filter(Boolean);

    for (const file of fileArray) {
      if (!file) continue;

      // Read file
      const fileBuffer = fs.readFileSync(file.filepath);
      const fileExt = file.originalFilename?.split('.').pop() || 'jpg';
      const fileName = `${user.id}/${Date.now()}-${evidenceType || 'evidence'}.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('contest-evidence')
        .upload(fileName, fileBuffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('contest-evidence')
        .getPublicUrl(fileName);

      uploadedFiles.push({
        url: publicUrl,
        type: validateEvidenceType(evidenceType),
        filename: file.originalFilename || fileName,
        uploaded_at: new Date().toISOString(),
        description: description || undefined,
        file_size: file.size,
        mime_type: file.mimetype || 'application/octet-stream',
      });

      // Clean up temp file
      fs.unlinkSync(file.filepath);
    }

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No files uploaded successfully' });
    }

    // Update contest with new evidence
    const isPhotoType = uploadedFiles[0].type.includes('photo');
    const currentEvidence = isPhotoType
      ? (contest.evidence_photos as EvidenceFile[] || [])
      : (contest.supporting_documents as EvidenceFile[] || []);

    const updatedEvidence = [...currentEvidence, ...uploadedFiles];

    const updateField = isPhotoType ? 'evidence_photos' : 'supporting_documents';
    const { error: updateError } = await supabase
      .from('ticket_contests')
      .update({
        [updateField]: updatedEvidence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contestId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update contest' });
    }

    // Calculate evidence quality score
    await updateEvidenceQuality(contestId);

    return res.status(200).json({
      success: true,
      files: uploadedFiles,
      message: `Uploaded ${uploadedFiles.length} file(s) successfully`,
    });

  } catch (error: any) {
    console.error('Evidence upload error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}

/**
 * Calculate evidence quality score based on what's provided vs what's recommended
 */
async function updateEvidenceQuality(contestId: string) {
  try {
    const { data: contest } = await supabase
      .from('ticket_contests')
      .select('evidence_photos, supporting_documents, evidence_checklist, written_statement')
      .eq('id', contestId)
      .single();

    if (!contest) return;

    const evidencePhotos = contest.evidence_photos as EvidenceFile[] || [];
    const supportingDocs = contest.supporting_documents as EvidenceFile[] || [];
    const checklist = Array.isArray(contest.evidence_checklist) ? contest.evidence_checklist : [];

    // Calculate completeness
    const completeness: Record<string, boolean> = {};
    let score = 0;
    let totalRequired = 0;

    // Check each checklist item
    for (const item of checklist) {
      if (!item.required) continue;
      totalRequired++;

      const itemName = item.item.toLowerCase();

      // Check if evidence exists for this item
      let hasEvidence = false;

      if (itemName.includes('photo') || itemName.includes('picture')) {
        hasEvidence = evidencePhotos.length > 0;
      } else if (itemName.includes('witness')) {
        hasEvidence = !!contest.written_statement;
      } else if (itemName.includes('permit') || itemName.includes('proof')) {
        hasEvidence = supportingDocs.some(doc => doc.type === 'permit' || doc.type === 'receipt');
      } else if (itemName.includes('ticket')) {
        hasEvidence = evidencePhotos.some(photo => photo.type === 'ticket_photo');
      }

      if (hasEvidence) {
        score++;
      }

      completeness[item.item] = hasEvidence;
    }

    // Calculate quality score (0-100)
    const qualityScore = totalRequired > 0 ? Math.round((score / totalRequired) * 100) : 0;

    // Update contest
    await supabase
      .from('ticket_contests')
      .update({
        evidence_quality_score: qualityScore,
        evidence_completeness: completeness,
      })
      .eq('id', contestId);

  } catch (error) {
    console.error('Error calculating evidence quality:', error);
  }
}

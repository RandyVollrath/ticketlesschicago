-- Add comprehensive evidence fields to ticket_contests table
-- Supports multiple photos, witness statements, documents, and quality tracking

-- Add evidence storage fields
ALTER TABLE ticket_contests
ADD COLUMN IF NOT EXISTS evidence_photos JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS witness_statements TEXT,
ADD COLUMN IF NOT EXISTS supporting_documents JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS evidence_quality_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS evidence_completeness JSONB DEFAULT '{}'::jsonb;

-- Comment on new columns
COMMENT ON COLUMN ticket_contests.evidence_photos IS
'Array of evidence photo objects: [{"url": "https://...", "type": "sign_photo", "uploaded_at": "2025-01-01T...", "description": "Photo of street sign"}]';

COMMENT ON COLUMN ticket_contests.witness_statements IS
'Text field for witness statements or testimony details';

COMMENT ON COLUMN ticket_contests.supporting_documents IS
'Array of supporting documents: [{"url": "https://...", "type": "permit", "filename": "permit.pdf", "uploaded_at": "2025-01-01T..."}]';

COMMENT ON COLUMN ticket_contests.evidence_quality_score IS
'Quality score 0-100 based on evidence completeness and relevance. Auto-calculated based on what evidence is recommended vs provided.';

COMMENT ON COLUMN ticket_contests.evidence_completeness IS
'Tracks which recommended evidence items user has provided: {"sign_photos": true, "location_photos": false, "witness": false}';

-- Create index for evidence quality filtering
CREATE INDEX IF NOT EXISTS idx_ticket_contests_evidence_quality
ON ticket_contests(evidence_quality_score)
WHERE evidence_quality_score > 0;

-- Update existing records to have empty arrays
UPDATE ticket_contests
SET evidence_photos = '[]'::jsonb,
    supporting_documents = '[]'::jsonb,
    evidence_completeness = '{}'::jsonb
WHERE evidence_photos IS NULL
   OR supporting_documents IS NULL
   OR evidence_completeness IS NULL;

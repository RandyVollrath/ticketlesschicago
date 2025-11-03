-- Add video evidence support to ticket_contests table
-- Enables dashcam and phone video uploads with metadata, GPS, and automated slicing

-- Add video_evidence JSONB field
ALTER TABLE ticket_contests
ADD COLUMN IF NOT EXISTS video_evidence JSONB DEFAULT '[]'::jsonb;

-- Comment on new column
COMMENT ON COLUMN ticket_contests.video_evidence IS
'Array of video evidence objects with metadata, GPS, timestamps, and slicing info:
[{
  "id": "uuid",
  "url": "https://storage.../video.mp4",
  "thumbnail_url": "https://storage.../thumb.jpg",
  "source": "dashcam|phone|upload",
  "provider": "nextbase|garmin|manual",
  "timestamp": "2024-03-15T14:30:00Z",
  "duration_seconds": 120,
  "file_size": 45000000,
  "has_gps": true,
  "gps_location": {"lat": 41.9, "lon": -87.6},
  "gps_accuracy_meters": 10,
  "description": "Dashcam footage showing parking location",
  "relevant_time_start": 45,
  "relevant_time_end": 75,
  "uploaded_at": "2024-03-20T10:00:00Z",
  "processed": true,
  "processing_status": "completed|processing|failed",
  "original_filename": "dashcam_20240315_143000.mp4",
  "mime_type": "video/mp4",
  "codec": "h264",
  "resolution": "1920x1080",
  "fps": 30
}]';

-- Create index for video evidence searches
CREATE INDEX IF NOT EXISTS idx_ticket_contests_has_video
ON ticket_contests((video_evidence::text != '[]'::text))
WHERE video_evidence::text != '[]'::text;

-- Update existing records to have empty video arrays
UPDATE ticket_contests
SET video_evidence = '[]'::jsonb
WHERE video_evidence IS NULL;

-- Create table for video processing queue
CREATE TABLE IF NOT EXISTS video_processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL REFERENCES ticket_contests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL,

  -- Original video info
  original_video_url TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,

  -- Processing parameters
  ticket_timestamp TIMESTAMPTZ NOT NULL,
  video_timestamp TIMESTAMPTZ,
  slice_start_seconds INTEGER,
  slice_duration_seconds INTEGER DEFAULT 30,
  auto_detect_relevant_section BOOLEAN DEFAULT true,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, processing, completed, failed
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Output
  processed_video_url TEXT,
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_queue_status ON video_processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_video_queue_user ON video_processing_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_video_queue_contest ON video_processing_queue(contest_id);

COMMENT ON TABLE video_processing_queue IS
'Queue for async video processing with ffmpeg - slicing, thumbnails, metadata extraction';

COMMENT ON COLUMN video_processing_queue.auto_detect_relevant_section IS
'If true, use ticket timestamp to automatically calculate slice_start_seconds and slice_duration_seconds';

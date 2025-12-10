/**
 * Video Evidence Upload API
 * Handles dashcam and phone video uploads with automatic processing:
 * - Accepts videos up to 500MB
 * - Validates and extracts metadata (GPS, timestamps)
 * - Automatically slices video based on ticket timestamp
 * - Generates thumbnail
 * - Stores processed video and attaches to contest
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  processVideo,
  validateVideoFile,
  extractVideoMetadata,
} from '../../../lib/video-processor';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Valid video sources
const VALID_VIDEO_SOURCES = ['dashcam', 'phone', 'upload'] as const;
type VideoSource = typeof VALID_VIDEO_SOURCES[number];

function validateVideoSource(value: string | undefined): VideoSource {
  if (value && VALID_VIDEO_SOURCES.includes(value as VideoSource)) {
    return value as VideoSource;
  }
  return 'upload';
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

interface VideoEvidence {
  id: string;
  url: string;
  thumbnail_url: string;
  source: 'dashcam' | 'phone' | 'upload';
  provider?: string;
  timestamp?: string;
  duration_seconds: number;
  file_size: number;
  has_gps: boolean;
  gps_location?: { lat: number; lon: number };
  gps_accuracy_meters?: number;
  description?: string;
  relevant_time_start?: number;
  relevant_time_end?: number;
  uploaded_at: string;
  processed: boolean;
  processing_status: 'completed' | 'processing' | 'failed';
  original_filename: string;
  mime_type: string;
  codec: string;
  resolution: string;
  fps: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let tempVideoPath: string | null = null;
  let tempOutputDir: string | null = null;

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

    // Parse multipart form data with large file support
    const form = formidable({
      maxFileSize: 500 * 1024 * 1024, // 500MB max
      maxFiles: 1, // One video at a time
      multiples: false,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    const contestId = Array.isArray(fields.contestId)
      ? fields.contestId[0]
      : fields.contestId;
    const ticketTimestamp = Array.isArray(fields.ticketTimestamp)
      ? fields.ticketTimestamp[0]
      : fields.ticketTimestamp;
    const description = Array.isArray(fields.description)
      ? fields.description[0]
      : fields.description;
    const autoSlice = fields.autoSlice === 'true' || fields.autoSlice === true;
    const source = (Array.isArray(fields.source) ? fields.source[0] : fields.source) || 'upload';

    if (!contestId) {
      return res.status(400).json({ error: 'Missing contest ID' });
    }

    // Get ticket data for timestamp info
    const { data: contest, error: contestError } = await supabase
      .from('ticket_contests')
      .select('id, user_id, ticket_id, video_evidence, user_tickets(issue_date, violation_location)')
      .eq('id', contestId)
      .eq('user_id', user.id)
      .single();

    if (contestError || !contest) {
      return res.status(404).json({ error: 'Contest not found or unauthorized' });
    }

    // Get video file
    const videoFile = Array.isArray(files.video) ? files.video[0] : files.video;
    if (!videoFile) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    tempVideoPath = videoFile.filepath;

    // Validate video file
    console.log('Validating video file...');
    const validation = await validateVideoFile(tempVideoPath);
    if (!validation.valid) {
      return res.status(400).json({
        error: `Invalid video file: ${validation.error}`,
      });
    }

    // Determine ticket timestamp for auto-slicing
    let finalTicketTimestamp = ticketTimestamp;
    if (!finalTicketTimestamp && contest.user_tickets?.issue_date) {
      // Use ticket issue date if timestamp not provided
      finalTicketTimestamp = new Date(contest.user_tickets.issue_date).toISOString();
    }

    // Create temporary output directory
    tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-processing-'));

    // Process video (slice, thumbnail, metadata extraction)
    console.log('Processing video...');
    const processed = await processVideo(tempVideoPath, tempOutputDir, {
      ticketTimestamp: finalTicketTimestamp,
      autoCalculate: autoSlice,
      reEncode: true, // Re-encode for smaller file size and compatibility
      quality: 'balanced',
    });

    // Upload processed video to Supabase Storage
    console.log('Uploading processed video to storage...');
    const videoFileName = `${user.id}/${Date.now()}-video.mp4`;
    const thumbnailFileName = `${user.id}/${Date.now()}-thumb.jpg`;

    const videoBuffer = fs.readFileSync(processed.sliced_video_path);
    const thumbnailBuffer = fs.readFileSync(processed.thumbnail_path);

    // Upload video
    const { data: videoUploadData, error: videoUploadError } = await supabase.storage
      .from('contest-evidence')
      .upload(videoFileName, videoBuffer, {
        contentType: 'video/mp4',
        upsert: false,
      });

    if (videoUploadError) {
      throw new Error(`Failed to upload video: ${videoUploadError.message}`);
    }

    // Upload thumbnail
    const { data: thumbnailUploadData, error: thumbnailUploadError } = await supabase.storage
      .from('contest-evidence')
      .upload(thumbnailFileName, thumbnailBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (thumbnailUploadError) {
      console.error('Thumbnail upload failed:', thumbnailUploadError);
      // Continue even if thumbnail fails
    }

    // Get public URLs
    const { data: { publicUrl: videoUrl } } = supabase.storage
      .from('contest-evidence')
      .getPublicUrl(videoFileName);

    const { data: { publicUrl: thumbnailUrl } } = supabase.storage
      .from('contest-evidence')
      .getPublicUrl(thumbnailFileName);

    // Create video evidence object
    const videoEvidence: VideoEvidence = {
      id: crypto.randomUUID(),
      url: videoUrl,
      thumbnail_url: thumbnailUrl,
      source: validateVideoSource(source),
      timestamp: processed.metadata.video_timestamp,
      duration_seconds: processed.slice_info.slice_duration,
      file_size: processed.metadata.file_size,
      has_gps: processed.metadata.has_gps,
      gps_location: processed.metadata.gps_location,
      gps_accuracy_meters: processed.metadata.gps_accuracy_meters,
      description: description || undefined,
      relevant_time_start: processed.slice_info.slice_start,
      relevant_time_end:
        processed.slice_info.slice_start + processed.slice_info.slice_duration,
      uploaded_at: new Date().toISOString(),
      processed: true,
      processing_status: 'completed',
      original_filename: videoFile.originalFilename || 'video.mp4',
      mime_type: processed.metadata.mime_type,
      codec: processed.metadata.codec,
      resolution: processed.metadata.resolution,
      fps: processed.metadata.fps,
    };

    // Update contest with video evidence
    const currentVideoEvidence = (contest.video_evidence as VideoEvidence[]) || [];
    const updatedVideoEvidence = [...currentVideoEvidence, videoEvidence];

    const { error: updateError } = await supabase
      .from('ticket_contests')
      .update({
        video_evidence: updatedVideoEvidence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contestId);

    if (updateError) {
      throw new Error(`Failed to update contest: ${updateError.message}`);
    }

    // Clean up temp files
    if (tempVideoPath) {
      try {
        fs.unlinkSync(tempVideoPath);
      } catch (e) {
        console.error('Failed to clean up temp video:', e);
      }
    }
    if (tempOutputDir) {
      try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean up temp directory:', e);
      }
    }

    return res.status(200).json({
      success: true,
      video: videoEvidence,
      processing_info: {
        original_duration: processed.slice_info.original_duration,
        sliced_duration: processed.slice_info.slice_duration,
        slice_method: processed.slice_info.method,
        has_gps: processed.metadata.has_gps,
        gps_location: processed.metadata.gps_location,
      },
      message: 'Video uploaded and processed successfully',
    });
  } catch (error: any) {
    console.error('Video upload error:', error);

    // Clean up temp files on error
    if (tempVideoPath) {
      try {
        fs.unlinkSync(tempVideoPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (tempOutputDir) {
      try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    return res.status(500).json({
      error: sanitizeErrorMessage(error),
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

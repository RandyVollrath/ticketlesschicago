/**
 * Video Processing Queue Worker
 * Cron job that processes queued videos asynchronously
 * Useful for very large uploads or deferred processing
 *
 * Setup: Run this via Vercel Cron or external scheduler
 * Example: *\/5 * * * * (every 5 minutes)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { processVideo } from '../../../lib/video-processor';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret to prevent unauthorized calls
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Starting video processing queue worker...');

    // Get pending video processing jobs
    const { data: pendingJobs, error: fetchError } = await supabase
      .from('video_processing_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3) // Max 3 retries
      .order('created_at', { ascending: true })
      .limit(5); // Process max 5 videos per run

    if (fetchError) {
      throw new Error(`Failed to fetch pending jobs: ${fetchError.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending videos to process',
        processed: 0,
      });
    }

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each video
    for (const job of pendingJobs) {
      try {
        console.log(`Processing video job ${job.id}...`);

        // Mark as processing
        await supabase
          .from('video_processing_queue')
          .update({
            status: 'processing',
            processing_started_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        // Download original video from storage
        const tempVideoPath = path.join(os.tmpdir(), `video-${job.id}.tmp`);
        const tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), `video-output-${job.id}-`));

        const videoUrl = job.original_video_url;
        const { data: videoData, error: downloadError } = await supabase.storage
          .from('contest-evidence')
          .download(extractStoragePath(videoUrl));

        if (downloadError) {
          throw new Error(`Failed to download video: ${downloadError.message}`);
        }

        // Write to temp file
        const videoBuffer = await videoData.arrayBuffer();
        fs.writeFileSync(tempVideoPath, Buffer.from(videoBuffer));

        // Process video
        const processed = await processVideo(tempVideoPath, tempOutputDir, {
          ticketTimestamp: job.ticket_timestamp,
          autoCalculate: job.auto_detect_relevant_section,
          reEncode: true,
          quality: 'balanced',
        });

        // Upload processed video
        const videoFileName = `${job.user_id}/${Date.now()}-processed.mp4`;
        const thumbnailFileName = `${job.user_id}/${Date.now()}-thumb.jpg`;

        const videoBuffer2 = fs.readFileSync(processed.sliced_video_path);
        const thumbnailBuffer = fs.readFileSync(processed.thumbnail_path);

        await supabase.storage
          .from('contest-evidence')
          .upload(videoFileName, videoBuffer2, {
            contentType: 'video/mp4',
            upsert: false,
          });

        await supabase.storage
          .from('contest-evidence')
          .upload(thumbnailFileName, thumbnailBuffer, {
            contentType: 'image/jpeg',
            upsert: false,
          });

        const { data: { publicUrl: processedVideoUrl } } = supabase.storage
          .from('contest-evidence')
          .getPublicUrl(videoFileName);

        const { data: { publicUrl: thumbnailUrl } } = supabase.storage
          .from('contest-evidence')
          .getPublicUrl(thumbnailFileName);

        // Update job as completed
        await supabase
          .from('video_processing_queue')
          .update({
            status: 'completed',
            processing_completed_at: new Date().toISOString(),
            processed_video_url: processedVideoUrl,
            thumbnail_url: thumbnailUrl,
            metadata: {
              original_duration: processed.slice_info.original_duration,
              slice_start: processed.slice_info.slice_start,
              slice_duration: processed.slice_info.slice_duration,
              has_gps: processed.metadata.has_gps,
              gps_location: processed.metadata.gps_location,
              resolution: processed.metadata.resolution,
              codec: processed.metadata.codec,
              fps: processed.metadata.fps,
            },
          })
          .eq('id', job.id);

        // Update contest with video evidence
        const { data: contest } = await supabase
          .from('ticket_contests')
          .select('video_evidence')
          .eq('id', job.contest_id)
          .single();

        if (contest) {
          const currentVideoEvidence = (contest.video_evidence as any[]) || [];
          const newVideoEvidence = {
            id: crypto.randomUUID(),
            url: processedVideoUrl,
            thumbnail_url: thumbnailUrl,
            source: 'upload',
            timestamp: processed.metadata.video_timestamp,
            duration_seconds: processed.slice_info.slice_duration,
            file_size: processed.metadata.file_size,
            has_gps: processed.metadata.has_gps,
            gps_location: processed.metadata.gps_location,
            uploaded_at: new Date().toISOString(),
            processed: true,
            processing_status: 'completed',
            original_filename: job.original_filename,
            mime_type: processed.metadata.mime_type,
            codec: processed.metadata.codec,
            resolution: processed.metadata.resolution,
            fps: processed.metadata.fps,
          };

          await supabase
            .from('ticket_contests')
            .update({
              video_evidence: [...currentVideoEvidence, newVideoEvidence],
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.contest_id);
        }

        // Clean up temp files
        fs.unlinkSync(tempVideoPath);
        fs.rmSync(tempOutputDir, { recursive: true, force: true });

        results.processed++;
        console.log(`Successfully processed video job ${job.id}`);
      } catch (error: any) {
        console.error(`Failed to process video job ${job.id}:`, error);

        // Mark as failed and increment retry count
        await supabase
          .from('video_processing_queue')
          .update({
            status: job.retry_count >= 2 ? 'failed' : 'pending', // Fail after 3 attempts
            retry_count: job.retry_count + 1,
            error_message: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        results.failed++;
        results.errors.push(`Job ${job.id}: ${error.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${results.processed} videos, ${results.failed} failed`,
      ...results,
    });
  } catch (error: any) {
    console.error('Video queue processing error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process video queue',
    });
  }
}

/**
 * Extract storage path from public URL
 */
function extractStoragePath(url: string): string {
  // URL format: https://<project>.supabase.co/storage/v1/object/public/contest-evidence/<path>
  const match = url.match(/\/contest-evidence\/(.+)$/);
  return match ? match[1] : url;
}

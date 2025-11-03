/**
 * Video Processing Service
 * Handles ffmpeg-based video slicing, thumbnail generation, and metadata extraction
 * for dashcam and phone evidence videos
 */

import ffmpeg from 'fluent-ffmpeg';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { differenceInSeconds, parseISO } from 'date-fns';

export interface VideoMetadata {
  duration_seconds: number;
  resolution: string;
  codec: string;
  fps: number;
  file_size: number;
  mime_type: string;
  has_gps: boolean;
  gps_location?: {
    lat: number;
    lon: number;
  };
  gps_accuracy_meters?: number;
  video_timestamp?: string; // ISO 8601
  creation_time?: string;
}

export interface SliceParameters {
  start_seconds: number;
  duration_seconds: number;
  ticket_timestamp?: string; // ISO 8601
  auto_calculate?: boolean;
}

export interface ProcessedVideo {
  sliced_video_path: string;
  thumbnail_path: string;
  metadata: VideoMetadata;
  slice_info: {
    original_duration: number;
    slice_start: number;
    slice_duration: number;
    method: 'manual' | 'auto_calculated' | 'full_video';
  };
}

/**
 * Extract video metadata using ffprobe
 */
export async function extractVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to extract metadata: ${err.message}`));
        return;
      }

      try {
        const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
        if (!videoStream) {
          throw new Error('No video stream found');
        }

        // Extract GPS data if available (common in dashcam footage)
        let gpsLocation;
        let gpsAccuracy;
        let hasGps = false;

        // Check for GPS in format tags (common in dashcam metadata)
        const formatTags = metadata.format.tags || {};
        const locationString = formatTags.location || formatTags.com_apple_quicktime_location || formatTags['com.apple.quicktime.location'];

        if (locationString) {
          // Parse location strings like "+41.9000-087.6000/" or "GPS (41.9, -87.6)"
          const latLonMatch = locationString.match(/([+-]?\d+\.\d+)[^\d]+([+-]?\d+\.\d+)/);
          if (latLonMatch) {
            hasGps = true;
            gpsLocation = {
              lat: parseFloat(latLonMatch[1]),
              lon: parseFloat(latLonMatch[2]),
            };
          }
        }

        // Get creation time / video timestamp
        const creationTime = formatTags.creation_time || formatTags.date || videoStream.tags?.creation_time;

        // Get file size
        const fileSize = metadata.format.size || 0;

        const result: VideoMetadata = {
          duration_seconds: Math.round(metadata.format.duration || 0),
          resolution: `${videoStream.width}x${videoStream.height}`,
          codec: videoStream.codec_name || 'unknown',
          fps: eval(videoStream.r_frame_rate || '30/1'),
          file_size: fileSize,
          mime_type: getMimeType(videoPath),
          has_gps: hasGps,
          creation_time: creationTime,
        };

        if (gpsLocation) {
          result.gps_location = gpsLocation;
          result.gps_accuracy_meters = 10; // Default accuracy, dashcams typically 10-50m
        }

        if (creationTime) {
          result.video_timestamp = new Date(creationTime).toISOString();
        }

        resolve(result);
      } catch (error: any) {
        reject(new Error(`Failed to parse metadata: ${error.message}`));
      }
    });
  });
}

/**
 * Calculate optimal slice parameters based on ticket timestamp
 * Automatically determines the relevant section of video to extract
 */
export function calculateSliceWindow(
  videoMetadata: VideoMetadata,
  ticketTimestamp: string,
  bufferMinutes: number = 5
): SliceParameters {
  // If video has a timestamp, calculate the offset
  if (videoMetadata.video_timestamp) {
    const videoStart = parseISO(videoMetadata.video_timestamp);
    const ticketTime = parseISO(ticketTimestamp);

    // Calculate seconds from video start to ticket time
    const offsetSeconds = differenceInSeconds(ticketTime, videoStart);

    // If ticket time is within the video duration
    if (offsetSeconds >= 0 && offsetSeconds <= videoMetadata.duration_seconds) {
      // Extract ±bufferMinutes around the ticket time
      const bufferSeconds = bufferMinutes * 60;
      const start = Math.max(0, offsetSeconds - bufferSeconds);
      const end = Math.min(videoMetadata.duration_seconds, offsetSeconds + bufferSeconds);
      const duration = end - start;

      return {
        start_seconds: start,
        duration_seconds: duration,
        ticket_timestamp: ticketTimestamp,
        auto_calculate: true,
      };
    }
  }

  // Fallback: if we can't determine the exact time, extract around the middle
  // Assumption: dashcam circular buffer captured the incident in the last portion
  const sliceDuration = Math.min(videoMetadata.duration_seconds, bufferMinutes * 60 * 2);
  const start = Math.max(0, videoMetadata.duration_seconds - sliceDuration);

  return {
    start_seconds: start,
    duration_seconds: sliceDuration,
    ticket_timestamp: ticketTimestamp,
    auto_calculate: true,
  };
}

/**
 * Slice a video using ffmpeg with optimal compression
 * Fast slice with -c copy (no re-encode) or re-encode for smaller size
 */
export async function sliceVideo(
  inputPath: string,
  outputPath: string,
  sliceParams: SliceParameters,
  options: {
    reEncode?: boolean;
    quality?: 'fast' | 'balanced' | 'small';
  } = {}
): Promise<void> {
  const { reEncode = false, quality = 'balanced' } = options;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .setStartTime(sliceParams.start_seconds)
      .setDuration(sliceParams.duration_seconds);

    if (reEncode) {
      // Re-encode for smaller file size and compatibility
      const crf = quality === 'fast' ? 23 : quality === 'balanced' ? 26 : 28;
      const preset = quality === 'fast' ? 'fast' : quality === 'balanced' ? 'medium' : 'slow';

      command = command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate('96k')
        .outputOptions([
          `-preset ${preset}`,
          `-crf ${crf}`,
          '-movflags +faststart', // Enable streaming
        ])
        .size('1280x?'); // Scale down to 720p width, maintain aspect ratio
    } else {
      // Fast copy without re-encoding
      command = command.outputOptions(['-c copy']);
    }

    command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Processing: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('Video slicing completed');
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .run();
  });
}

/**
 * Generate a thumbnail from a video at a specific timestamp
 */
export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestampSeconds: number = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestampSeconds],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '640x360',
      })
      .on('end', () => {
        console.log('Thumbnail generated');
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`Thumbnail generation error: ${err.message}`));
      });
  });
}

/**
 * Complete video processing pipeline
 * 1. Extract metadata (including GPS)
 * 2. Calculate slice window if auto mode
 * 3. Slice video
 * 4. Generate thumbnail
 */
export async function processVideo(
  inputPath: string,
  outputDir: string,
  options: {
    ticketTimestamp?: string;
    sliceParams?: SliceParameters;
    autoCalculate?: boolean;
    reEncode?: boolean;
    quality?: 'fast' | 'balanced' | 'small';
  } = {}
): Promise<ProcessedVideo> {
  const {
    ticketTimestamp,
    sliceParams,
    autoCalculate = true,
    reEncode = false,
    quality = 'balanced',
  } = options;

  // Step 1: Extract metadata
  console.log('Extracting video metadata...');
  const metadata = await extractVideoMetadata(inputPath);

  // Step 2: Determine slice parameters
  let finalSliceParams: SliceParameters;

  if (sliceParams) {
    // Manual slice parameters provided
    finalSliceParams = sliceParams;
  } else if (autoCalculate && ticketTimestamp) {
    // Auto-calculate based on ticket timestamp
    finalSliceParams = calculateSliceWindow(metadata, ticketTimestamp);
  } else {
    // No slicing - use full video
    finalSliceParams = {
      start_seconds: 0,
      duration_seconds: metadata.duration_seconds,
    };
  }

  // Step 3: Slice video
  const timestamp = Date.now();
  const slicedVideoPath = path.join(outputDir, `sliced_${timestamp}.mp4`);
  const thumbnailPath = path.join(outputDir, `thumb_${timestamp}.jpg`);

  console.log(`Slicing video: ${finalSliceParams.start_seconds}s for ${finalSliceParams.duration_seconds}s`);
  await sliceVideo(inputPath, slicedVideoPath, finalSliceParams, { reEncode, quality });

  // Step 4: Generate thumbnail (at 1 second into the sliced video)
  console.log('Generating thumbnail...');
  await generateThumbnail(slicedVideoPath, thumbnailPath, 1);

  return {
    sliced_video_path: slicedVideoPath,
    thumbnail_path: thumbnailPath,
    metadata,
    slice_info: {
      original_duration: metadata.duration_seconds,
      slice_start: finalSliceParams.start_seconds,
      slice_duration: finalSliceParams.duration_seconds,
      method: sliceParams
        ? 'manual'
        : finalSliceParams.auto_calculate
        ? 'auto_calculated'
        : 'full_video',
    },
  };
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v',
  };
  return mimeTypes[ext] || 'video/mp4';
}

/**
 * Validate video file
 */
export async function validateVideoFile(
  filePath: string
): Promise<{ valid: boolean; error?: string; metadata?: VideoMetadata }> {
  try {
    // Check file exists
    await fs.access(filePath);

    // Extract metadata to validate it's a proper video
    const metadata = await extractVideoMetadata(filePath);

    // Validate minimum requirements
    if (metadata.duration_seconds < 1) {
      return { valid: false, error: 'Video duration too short (minimum 1 second)' };
    }

    if (metadata.file_size < 1000) {
      return { valid: false, error: 'File size too small (likely corrupted)' };
    }

    return { valid: true, metadata };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

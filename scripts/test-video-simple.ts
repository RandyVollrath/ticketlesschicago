/**
 * Simple Video Processing Test (TypeScript)
 *
 * Quick test of video processor functionality
 *
 * Usage:
 *   npx ts-node scripts/test-video-simple.ts
 */

import path from 'path';
import fs from 'fs';
import { extractVideoMetadata, calculateSliceWindow } from '../lib/video-processor';

async function testSimple() {
  console.log('🧪 Simple Video Processor Test\n');

  // Test with a sample video path (replace with actual path)
  const testVideoPath = process.argv[2] || './test-video.mp4';

  if (!fs.existsSync(testVideoPath)) {
    console.log('⚠️  No test video found at:', testVideoPath);
    console.log('\nTo test:');
    console.log('1. Download a sample dashcam video');
    console.log('2. Run: npx ts-node scripts/test-video-simple.ts /path/to/video.mp4');
    console.log('\nFor now, showing example metadata structure:\n');

    // Show example structure
    const exampleMetadata = {
      duration_seconds: 300,
      resolution: '1920x1080',
      codec: 'h264',
      fps: 30,
      file_size: 150000000,
      mime_type: 'video/mp4',
      has_gps: true,
      gps_location: { lat: 41.9, lon: -87.6 },
      gps_accuracy_meters: 10,
      video_timestamp: '2024-03-15T14:20:00Z',
    };

    console.log('Example Video Metadata:');
    console.log(JSON.stringify(exampleMetadata, null, 2));

    console.log('\n\nExample Slice Calculation:');
    const ticketTime = '2024-03-15T14:28:00Z';
    const sliceParams = calculateSliceWindow(exampleMetadata, ticketTime, 5);

    console.log('Ticket time:', ticketTime);
    console.log('Slice parameters:', sliceParams);
    console.log(`\nWould extract: ${sliceParams.start_seconds}s to ${sliceParams.start_seconds + sliceParams.duration_seconds}s`);
    console.log(`Duration: ${sliceParams.duration_seconds} seconds (${Math.round(sliceParams.duration_seconds / 60)} minutes)`);

    return;
  }

  console.log('Testing with video:', testVideoPath);
  console.log('Extracting metadata...\n');

  try {
    const metadata = await extractVideoMetadata(testVideoPath);

    console.log('✅ Metadata extracted successfully!\n');
    console.log('Duration:', metadata.duration_seconds, 'seconds');
    console.log('Resolution:', metadata.resolution);
    console.log('Codec:', metadata.codec);
    console.log('FPS:', metadata.fps);
    console.log('File size:', (metadata.file_size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Has GPS:', metadata.has_gps);

    if (metadata.has_gps && metadata.gps_location) {
      console.log('GPS Location:', metadata.gps_location);
      console.log('View on map:', `https://www.google.com/maps?q=${metadata.gps_location.lat},${metadata.gps_location.lon}`);
    }

    if (metadata.video_timestamp) {
      console.log('Video timestamp:', metadata.video_timestamp);

      // Test slice calculation
      console.log('\n\nTesting slice calculation:');
      const ticketTime = process.argv[3] || new Date(Date.now() - 5 * 60 * 1000).toISOString();
      console.log('Simulated ticket time:', ticketTime);

      const sliceParams = calculateSliceWindow(metadata, ticketTime, 5);
      console.log('Calculated slice:', sliceParams);
    }

    console.log('\n✅ Test complete!');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testSimple();

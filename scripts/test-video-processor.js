/**
 * Test Video Processing Service
 *
 * This script tests the video processing pipeline locally:
 * - Metadata extraction (duration, resolution, GPS, etc.)
 * - Automatic time-based slicing
 * - Thumbnail generation
 * - GPS parsing from dashcam footage
 *
 * Usage:
 *   node scripts/test-video-processor.js /path/to/video.mp4 "2024-03-15T14:30:00Z"
 *
 * Example:
 *   node scripts/test-video-processor.js ./test-dashcam.mp4 "2024-03-15T14:30:00Z"
 */

const path = require('path');
const fs = require('fs');

// Note: This script would need to be converted to TypeScript or use ts-node to work with the TypeScript modules
// For now, it serves as documentation of how to test the video processor

async function testVideoProcessor() {
  console.log('🎥 Video Processing Test\n');

  // Get command line arguments
  const videoPath = process.argv[2];
  const ticketTimestamp = process.argv[3];

  if (!videoPath) {
    console.error('❌ Error: Please provide a video file path');
    console.log('\nUsage:');
    console.log('  node scripts/test-video-processor.js <video-file> <ticket-timestamp>');
    console.log('\nExample:');
    console.log('  node scripts/test-video-processor.js ./dashcam.mp4 "2024-03-15T14:30:00Z"');
    process.exit(1);
  }

  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Error: Video file not found: ${videoPath}`);
    process.exit(1);
  }

  console.log('Input video:', videoPath);
  console.log('Ticket timestamp:', ticketTimestamp || 'Not provided (will use last 10 minutes)');
  console.log('\n' + '='.repeat(60) + '\n');

  try {
    // Import TypeScript modules (requires ts-node or compilation)
    // In production, compile TypeScript first: npx tsc
    const { processVideo, extractVideoMetadata, validateVideoFile } = require('../lib/video-processor');

    // Step 1: Validate video
    console.log('📋 Step 1: Validating video file...');
    const validation = await validateVideoFile(videoPath);

    if (!validation.valid) {
      console.error('❌ Validation failed:', validation.error);
      process.exit(1);
    }

    console.log('✅ Video is valid\n');

    // Step 2: Extract metadata
    console.log('📊 Step 2: Extracting metadata...');
    const metadata = await extractVideoMetadata(videoPath);

    console.log('Duration:', metadata.duration_seconds, 'seconds');
    console.log('Resolution:', metadata.resolution);
    console.log('Codec:', metadata.codec);
    console.log('FPS:', metadata.fps);
    console.log('File size:', (metadata.file_size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Has GPS:', metadata.has_gps);

    if (metadata.has_gps && metadata.gps_location) {
      console.log('GPS Location:', metadata.gps_location);
      console.log('GPS Accuracy:', metadata.gps_accuracy_meters, 'meters');
    }

    if (metadata.video_timestamp) {
      console.log('Video timestamp:', metadata.video_timestamp);
    }

    console.log('\n');

    // Step 3: Process video (slice, thumbnail)
    console.log('⚙️  Step 3: Processing video...');
    const outputDir = path.join(__dirname, '../tmp/test-output');

    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const result = await processVideo(videoPath, outputDir, {
      ticketTimestamp,
      autoCalculate: true,
      reEncode: true,
      quality: 'balanced',
    });

    console.log('✅ Processing complete!\n');

    // Step 4: Show results
    console.log('📁 Output Files:');
    console.log('  Sliced video:', result.sliced_video_path);
    console.log('  Thumbnail:', result.thumbnail_path);
    console.log('\n');

    console.log('🎬 Slice Information:');
    console.log('  Original duration:', result.slice_info.original_duration, 'seconds');
    console.log('  Slice start:', result.slice_info.slice_start, 'seconds');
    console.log('  Slice duration:', result.slice_info.slice_duration, 'seconds');
    console.log('  Method:', result.slice_info.method);
    console.log('\n');

    console.log('📍 GPS Data:');
    if (result.metadata.has_gps && result.metadata.gps_location) {
      console.log('  Location:', result.metadata.gps_location);
      console.log('  Accuracy:', result.metadata.gps_accuracy_meters, 'meters');
      console.log('  Google Maps:', `https://www.google.com/maps?q=${result.metadata.gps_location.lat},${result.metadata.gps_location.lon}`);
    } else {
      console.log('  No GPS data found in video');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Review the output files in:', outputDir);
    console.log('2. Upload to Supabase using the /api/contest/upload-video endpoint');
    console.log('3. Check video plays correctly in browser');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Note about running this script
console.log('⚠️  Note: This script requires TypeScript compilation or ts-node');
console.log('Run one of:');
console.log('  npx ts-node scripts/test-video-processor.js <video> <timestamp>');
console.log('  npm run build && node .next/server/scripts/test-video-processor.js <video> <timestamp>');
console.log('\nOr compile the lib/video-processor.ts first:\n');

// Only run if proper modules are available
if (require.resolve('../lib/video-processor').includes('.ts')) {
  console.log('To run this test:');
  console.log('1. Install ts-node: npm install -D ts-node');
  console.log('2. Run: npx ts-node scripts/test-video-processor.js ./test.mp4 "2024-03-15T14:30:00Z"');
} else {
  testVideoProcessor().catch(console.error);
}

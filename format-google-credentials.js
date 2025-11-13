#!/usr/bin/env node

/**
 * Helper script to format Google Cloud Vision credentials for Vercel
 *
 * Usage:
 *   node format-google-credentials.js path/to/your-credentials.json
 *
 * This will output a properly formatted single-line JSON string
 * that you can paste into Vercel environment variables.
 */

const fs = require('fs');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('❌ Please provide the path to your Google Cloud credentials JSON file');
  console.log('');
  console.log('Usage:');
  console.log('  node format-google-credentials.js path/to/your-credentials.json');
  console.log('');
  console.log('Example:');
  console.log('  node format-google-credentials.js ~/Downloads/vision-api-license-upload-xxxxx.json');
  process.exit(1);
}

const filePath = args[0];

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

try {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const jsonObject = JSON.parse(fileContent);

  // Validate it's a Google service account key
  if (!jsonObject.type || jsonObject.type !== 'service_account') {
    console.warn('⚠️  Warning: This doesn\'t look like a Google service account key file');
  }

  if (!jsonObject.private_key || !jsonObject.client_email) {
    console.warn('⚠️  Warning: Missing required fields (private_key or client_email)');
  }

  // Convert to single-line JSON string
  const singleLine = JSON.stringify(jsonObject);

  console.log('✅ Successfully formatted Google Cloud Vision credentials!');
  console.log('');
  console.log('📋 Copy the text below and paste it into Vercel as GOOGLE_CLOUD_VISION_CREDENTIALS:');
  console.log('');
  console.log('─'.repeat(80));
  console.log(singleLine);
  console.log('─'.repeat(80));
  console.log('');
  console.log('Next steps:');
  console.log('1. Copy the JSON string above (everything between the lines)');
  console.log('2. Go to: https://vercel.com/randyvollraths-projects/ticketless-chicago/settings/environment-variables');
  console.log('3. Find GOOGLE_CLOUD_VISION_CREDENTIALS and click Edit');
  console.log('4. Replace the value with the string you copied');
  console.log('5. Save and redeploy');

} catch (error) {
  console.error('❌ Error parsing JSON file:', error.message);
  process.exit(1);
}

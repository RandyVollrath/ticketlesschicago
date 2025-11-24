require('dotenv').config({ path: '.env.local' });

const rawCreds = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
console.log('Raw length:', rawCreds.length);
console.log('Has literal newlines:', rawCreds.includes('\n'));
console.log('Has escaped newlines:', rawCreds.includes('\\n'));

// Try to parse as-is
console.log('\nAttempt 1: Parse as-is...');
try {
  const parsed = JSON.parse(rawCreds);
  console.log('✅ SUCCESS! Parsed correctly');
  console.log('Project:', parsed.project_id);
} catch (e) {
  console.log('❌ FAILED:', e.message);

  // Try fixing by replacing actual newlines with escaped ones in private_key
  console.log('\nAttempt 2: Replace actual newlines in private_key...');
  try {
    // Replace newlines ONLY within the private_key value
    const fixed = rawCreds.replace(/"private_key":\s*"([^"]*?)"/gs, (match, key) => {
      const escaped = key.replace(/\n/g, '\\n');
      return `"private_key": "${escaped}"`;
    });
    const parsed = JSON.parse(fixed);
    console.log('✅ SUCCESS after escaping!');
    console.log('Project:', parsed.project_id);
    console.log('\n📝 This is what the credentials SHOULD look like:');
    console.log('   (Save this to Vercel environment variable)\n');
    console.log(fixed);
  } catch (e2) {
    console.log('❌ Still failed:', e2.message);
  }
}

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (match) {
    envVars[match[1]] = match[2].replace(/\\n/g, '').trim();
  }
}

async function main() {
  const projectRef = 'dzhqolbhuqdcpngdayuq';

  // Try to find Supabase access token
  const tokenPaths = [
    path.resolve(process.env.HOME || '', '.config', 'supabase', 'access-token'),
    path.resolve(process.env.HOME || '', '.supabase', 'access-token'),
  ];

  let accessToken = '';
  for (const tp of tokenPaths) {
    try {
      accessToken = fs.readFileSync(tp, 'utf8').trim();
      if (accessToken) break;
    } catch {}
  }

  if (!accessToken) {
    console.error('No Supabase access token found. Run: supabase login');
    console.log('\nManually run this SQL in the Supabase dashboard SQL editor:\n');
    console.log(`
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_color TEXT;

-- Add photo_url column to detected_tickets for future camera photo capture
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Add vehicle_mismatch columns to detected_tickets
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_detected BOOLEAN DEFAULT FALSE;
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_details JSONB;
    `);
    return;
  }

  console.log('Found access token, executing SQL via Management API...');

  const sql = `
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
    ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_detected BOOLEAN DEFAULT FALSE;
    ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_details JSONB;
  `;

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`API error ${response.status}: ${text}`);
    return;
  }

  const result = await response.json();
  console.log('Migration applied successfully:', JSON.stringify(result));
}

main().catch(console.error);

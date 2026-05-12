import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const ticketId = '8bedd5a9-7035-47f0-b7d7-4d96c6a3603d';
  const paths = [
    `camera-evidence/${ticketId}/image-1.jpg`,
    `camera-evidence/${ticketId}/image-2.jpg`,
    `camera-evidence/${ticketId}/image-3.jpg`,
    `camera-evidence/${ticketId}/video-1.mp4`,
  ];
  for (const p of paths) {
    const { data, error } = await s.storage.from('ticket-photos').createSignedUrl(p, 60 * 60 * 24 * 7);
    if (error) { console.log(p, 'ERR', error.message); continue; }
    console.log(p);
    console.log('  ', data.signedUrl);
  }
  // Also dump source urls from camera_evidence row
  const { data: ce } = await s.from('camera_evidence').select('image_source_urls, video_source_urls').eq('ticket_id', ticketId).single();
  console.log('\n=== City vendor source URLs (direct) ===');
  console.log(JSON.stringify(ce, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

import { createClient } from '@supabase/supabase-js';
import { runCameraEvidencePipeline } from '../lib/camera-evidence-pipeline';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const ticket = {
    id: '8bedd5a9-7035-47f0-b7d7-4d96c6a3603d',
    user_id: 'ee53192e-6f9a-465b-b465-0a787896631c',
    plate: 'FA81246',
    ticket_number: '7012587110',
    violation_type: 'red_light',
    violation_code: '9-102-010',
    violation_date: '2026-02-04',
    location: null,
  };

  console.log('Running camera evidence pipeline for ticket', ticket.ticket_number, '...');
  console.log('  (this will hit chicagophotociteweb.com via Playwright — may take 30-60s)');
  const result = await runCameraEvidencePipeline(s, ticket, { force: true });

  console.log('\n=== PIPELINE RESULT ===');
  console.log('cached:', result.cached);
  console.log('noEvidenceAvailable:', result.noEvidenceAvailable);
  console.log('persistenceUnavailable:', result.persistenceUnavailable);
  if (result.error) console.log('error:', result.error);

  if (result.evidence) {
    console.log('\n=== EVIDENCE ===');
    console.log('source:', result.evidence.source);
    console.log('imagePaths:', result.evidence.imagePaths);
    console.log('videoPaths:', result.evidence.videoPaths);
    console.log('imageSourceUrls:', result.evidence.imageSourceUrls);
    console.log('videoSourceUrls:', result.evidence.videoSourceUrls);
    console.log('notes:', result.evidence.notes);
    console.log('scrapedAt:', result.evidence.scrapedAt);
    console.log('analyzedAt:', result.evidence.analyzedAt);
    console.log('\n=== FINDINGS (AI analysis) ===');
    console.log(JSON.stringify(result.evidence.findings, null, 2));
  }
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });

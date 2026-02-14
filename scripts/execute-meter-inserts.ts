import { supabaseAdmin } from '../lib/supabase-server';
import { readFileSync } from 'fs';

async function main() {
  const sqlFile = process.argv[2] || '/tmp/remaining_chunks.sql';

  console.log(`Reading ${sqlFile}...`);
  const sql = readFileSync(sqlFile, 'utf-8');

  const statements = sql.split('\n').filter(line => line.trim());
  console.log(`Executing ${statements.length} INSERT statements...`);

  // Execute in chunks of 100
  const chunkSize = 100;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize).join('\n');
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql: chunk });

    if (error) {
      console.error(`Error at chunk ${i / chunkSize}:`, error);
      process.exit(1);
    }

    console.log(`Progress: ${Math.min(i + chunkSize, statements.length)}/${statements.length}`);
  }

  // Get final count
  const { count, error } = await supabaseAdmin
    .from('metered_parking_locations')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Count error:', error);
  } else {
    console.log(`\nFinal count: ${count} rows`);
  }
}

main().catch(console.error);

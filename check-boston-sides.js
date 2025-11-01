const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // Get all unique street names
  const { data: allStreets } = await supabase
    .from('boston_street_sweeping')
    .select('st_name')
    .order('st_name');

  const streetNames = [...new Set(allStreets.map(s => s.st_name))];
  console.log(`Total unique streets: ${streetNames.length}`);

  // Check how many have both Even and Odd sides
  let bothSides = 0;
  let exampleStreets = [];

  for (const street of streetNames) {
    const { data: segments } = await supabase
      .from('boston_street_sweeping')
      .select('side')
      .eq('st_name', street);

    const sides = [...new Set(segments.map(s => s.side))];
    const hasEven = sides.includes('Even');
    const hasOdd = sides.includes('Odd');

    if (hasEven && hasOdd) {
      bothSides++;
      if (exampleStreets.length < 5) {
        exampleStreets.push(street);
      }
    }
  }

  console.log(`\nStreets with BOTH Even and Odd sides: ${bothSides} (${(bothSides/streetNames.length*100).toFixed(1)}%)`);
  console.log(`\nExamples:`);
  exampleStreets.forEach(s => console.log(`  - ${s}`));

  // Check side distribution
  const { data: allSegments } = await supabase
    .from('boston_street_sweeping')
    .select('side');

  const evenCount = allSegments.filter(s => s.side === 'Even').length;
  const oddCount = allSegments.filter(s => s.side === 'Odd').length;
  const bothCount = allSegments.filter(s => !s.side || s.side === '').length;

  console.log(`\nSide distribution:`);
  console.log(`  Even only: ${evenCount} segments`);
  console.log(`  Odd only: ${oddCount} segments`);
  console.log(`  Both sides: ${bothCount} segments`);
}

check();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // Get all segments
  const { data: segments } = await supabase
    .from('boston_street_sweeping')
    .select('st_name, from_street, to_street, side')
    .order('st_name');

  // Group by block (street name + from/to streets)
  const blocks = {};

  for (const seg of segments) {
    const blockKey = `${seg.st_name}|${seg.from_street}|${seg.to_street}`;

    if (!blocks[blockKey]) {
      blocks[blockKey] = {
        street: seg.st_name,
        from: seg.from_street,
        to: seg.to_street,
        sides: new Set()
      };
    }

    blocks[blockKey].sides.add(seg.side || 'both');
  }

  // Analyze blocks
  const blockArray = Object.values(blocks);

  const bothSidesBlocks = blockArray.filter(b => b.sides.has('Even') && b.sides.has('Odd'));
  const oneSideBlocks = blockArray.filter(b => b.sides.size === 1);
  const allSidesBlocks = blockArray.filter(b => b.sides.has('both') || (b.sides.has('Even') && b.sides.has('Odd') && b.sides.has('both')));

  console.log(`Total unique blocks (street + from/to): ${blockArray.length}`);
  console.log(`\nBlocks with BOTH Even AND Odd sides: ${bothSidesBlocks.length} (${(bothSidesBlocks.length/blockArray.length*100).toFixed(1)}%)`);
  console.log(`Blocks with only ONE side: ${oneSideBlocks.length} (${(oneSideBlocks.length/blockArray.length*100).toFixed(1)}%)`);
  console.log(`Blocks that clean "both sides" at once: ${blockArray.filter(b => b.sides.has('both')).length}`);

  console.log(`\nExamples of blocks with BOTH Even and Odd:`);
  bothSidesBlocks.slice(0, 5).forEach(b => {
    console.log(`  - ${b.street} (${b.from} to ${b.to})`);
    console.log(`    Sides: ${[...b.sides].join(', ')}`);
  });

  console.log(`\nExamples of blocks with only ONE side:`);
  oneSideBlocks.slice(0, 5).forEach(b => {
    console.log(`  - ${b.street} (${b.from} to ${b.to})`);
    console.log(`    Side: ${[...b.sides].join(', ')}`);
  });
}

check();

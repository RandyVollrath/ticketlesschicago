/**
 * Mid-Season Street Cleaning Schedule Change Detection
 *
 * Runs weekly to compare our loaded schedule data against the City of Chicago
 * Data Portal API. If the city updates their schedule (changes dates, adds
 * new sections, etc.), this cron emails admins so we can reload data.
 *
 * Data source: https://data.cityofchicago.org/resource/4ijn-s7e5.json
 * (2026 Street Sweeping Schedule)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';

const ADMIN_EMAILS = ['randy@autopilotamerica.com'];

// City of Chicago 2026 street sweeping dataset
const CITY_API_URL = 'https://data.cityofchicago.org/resource/4ijn-s7e5.json';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const cronSecret = req.headers['authorization']?.replace('Bearer ', '');
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔍 Checking for mid-season street cleaning schedule changes...');

    // 1. Get total row count from city API
    const countResp = await fetch(
      `${CITY_API_URL}?$select=count(*) as total`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!countResp.ok) {
      console.error('City API returned', countResp.status);
      return res.status(200).json({ status: 'city_api_unavailable', checked: false });
    }

    const countData = await countResp.json();
    const cityRowCount = parseInt(countData[0]?.total || '0');

    // 2. Get our loaded row count
    const { count: ourRowCount, error: countError } = await supabase
      .from('street_cleaning_schedule')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting our schedule:', countError);
      return res.status(500).json({ error: 'Database error' });
    }

    // 3. Sample random sections from city API and compare dates
    // Pick 10 random ward/section combos from our data
    const { data: sampleSections, error: sampleError } = await supabase
      .from('street_cleaning_schedule')
      .select('ward, section')
      .limit(100);

    if (sampleError || !sampleSections) {
      console.error('Error sampling sections:', sampleError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Deduplicate ward/section pairs and sample 10
    const uniqueSections = [...new Map(
      sampleSections.map(s => [`${s.ward}-${s.section}`, s])
    ).values()].slice(0, 10);

    let mismatches: string[] = [];

    for (const { ward, section } of uniqueSections) {
      try {
        // Get city's dates for this ward/section
        const cityResp = await fetch(
          `${CITY_API_URL}?$where=ward='${ward}' AND section='${section}'&$select=month_name,dates&$limit=50`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (!cityResp.ok) continue;

        const cityData = await cityResp.json();
        const cityDateCount = cityData.length;

        // Get our dates for this ward/section
        const { data: ourData, error: ourError } = await supabase
          .from('street_cleaning_schedule')
          .select('cleaning_date')
          .eq('ward', ward)
          .eq('section', section);

        if (ourError) continue;

        const ourDateCount = ourData?.length || 0;

        // Compare counts — if city has more or fewer rows, something changed
        if (Math.abs(cityDateCount - ourDateCount) > 2) {
          mismatches.push(
            `Ward ${ward} Section ${section}: City has ${cityDateCount} entries, we have ${ourDateCount}`
          );
        }
      } catch {
        // Skip individual section errors
      }
    }

    // 4. Check row count difference
    const rowCountDiff = Math.abs(cityRowCount - (ourRowCount || 0));
    const rowCountChanged = rowCountDiff > 50; // Allow small tolerance for data formatting differences

    // 5. Report results
    const hasChanges = rowCountChanged || mismatches.length > 0;

    if (hasChanges) {
      console.warn('⚠️ Schedule changes detected!');

      const emailBody = `
        <h2>Street Cleaning Schedule Change Detected</h2>
        <p>The City of Chicago may have updated their 2026 street cleaning schedule.</p>

        <h3>Row Count Comparison</h3>
        <ul>
          <li>City Data Portal: ${cityRowCount} rows</li>
          <li>Our database: ${ourRowCount} rows</li>
          <li>Difference: ${rowCountDiff} rows</li>
        </ul>

        ${mismatches.length > 0 ? `
          <h3>Section-Level Mismatches (${mismatches.length})</h3>
          <ul>
            ${mismatches.map(m => `<li>${m}</li>`).join('\n')}
          </ul>
        ` : ''}

        <h3>Action Required</h3>
        <p>If the schedule changed, you should:</p>
        <ol>
          <li>Reload the schedule data from the City Data Portal</li>
          <li>Run <code>npx tsx scripts/reassign-user-sections.ts</code> to update user assignments</li>
          <li>Verify notification pipeline with a test run</li>
        </ol>
      `.trim();

      for (const adminEmail of ADMIN_EMAILS) {
        await notificationService.sendEmail({
          to: adminEmail,
          subject: `⚠️ Street Cleaning Schedule Change Detected (${rowCountDiff} row diff)`,
          html: emailBody,
          text: `Schedule change detected. City has ${cityRowCount} rows, we have ${ourRowCount}. ${mismatches.length} section mismatches. Check email for details.`,
        });
      }
    }

    const result = {
      status: hasChanges ? 'changes_detected' : 'no_changes',
      cityRowCount,
      ourRowCount,
      rowCountDiff,
      sectionMismatches: mismatches.length,
      mismatches: mismatches.slice(0, 5), // Include first 5 in response
      checkedAt: new Date().toISOString(),
    };

    console.log('📊 Schedule check result:', result);
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('❌ Schedule change check error:', error);
    return res.status(500).json({ error: 'Schedule change check failed' });
  }
}

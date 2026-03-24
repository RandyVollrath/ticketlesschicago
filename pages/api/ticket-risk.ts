/**
 * GET /api/ticket-risk?address=1710+S+Clinton+St&day=2&hour=8
 *
 * Returns ticket risk assessment for a specific address, day, and hour.
 * Uses FOIA hourly and monthly pattern data to predict enforcement likelihood.
 *
 * Query params:
 *   address (required) - Chicago street address
 *   day (optional) - Day of week 0=Sun..6=Sat (defaults to current day)
 *   hour (optional) - Hour 0-23 (defaults to current hour)
 *   month (optional) - Month 1-12 (defaults to current month)
 *
 * Returns:
 *   risk_level: 'low' | 'moderate' | 'high' | 'very_high'
 *   risk_score: 0-100
 *   top_risk: highest risk violation category for this time
 *   hourly_breakdown: risk by hour for the given day
 *   recommendations: text suggestions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { parseChicagoAddress } from '../../lib/address-parser';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Violation categories that are time-sensitive (enforcement windows)
const TIME_SENSITIVE = new Set([
  'street_cleaning', 'rush_hour', 'snow_removal', 'bus_zone',
  'no_parking', 'loading_zone',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const address = (req.query.address as string || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'address parameter required' });
  }

  const parsed = parseChicagoAddress(address);
  if (!parsed) {
    return res.status(400).json({ error: 'Could not parse address' });
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day = req.query.day !== undefined ? parseInt(req.query.day as string) : now.getDay();
  const hour = req.query.hour !== undefined ? parseInt(req.query.hour as string) : now.getHours();
  const month = req.query.month !== undefined ? parseInt(req.query.month as string) : now.getMonth() + 1;

  try {
    const blockId = `${Math.floor(parsed.number / 100) * 100} ${parsed.direction || ''} ${parsed.name}`.replace(/\s+/g, ' ').trim();

    // Fetch hourly patterns for this block (capped to prevent unbounded result sets)
    const { data: hourlyData, error: hourlyErr } = await supabaseAdmin
      .from('foia_block_hourly')
      .select('violation_category, hour, day_of_week, ticket_count')
      .eq('block_id', blockId)
      .limit(5000);

    if (hourlyErr) {
      console.error('[ticket-risk] Hourly query error:', hourlyErr.message);
    }

    // Fetch monthly patterns for this block (capped to prevent unbounded result sets)
    const { data: monthlyData, error: monthlyErr } = await supabaseAdmin
      .from('foia_block_monthly')
      .select('violation_category, month, ticket_count')
      .eq('block_id', blockId)
      .limit(1000);

    if (monthlyErr) {
      console.error('[ticket-risk] Monthly query error:', monthlyErr.message);
    }

    // If no data found, return low risk
    if ((!hourlyData || hourlyData.length === 0) && (!monthlyData || monthlyData.length === 0)) {
      return res.status(200).json({
        risk_level: 'low',
        risk_score: 5,
        block_id: blockId,
        message: 'No historical enforcement data for this block.',
        top_risk: null,
        hourly_breakdown: [],
        recommendations: ['No significant ticket history found for this block.'],
      });
    }

    // Calculate total tickets across all hours/days for this block
    const totalHourly = (hourlyData || []).reduce((sum, r) => sum + r.ticket_count, 0);

    // Current time risk: tickets for this specific hour+day
    const currentSlot = (hourlyData || []).filter(
      (r) => r.hour === hour && r.day_of_week === day
    );
    const currentSlotTotal = currentSlot.reduce((sum, r) => sum + r.ticket_count, 0);

    // Monthly factor: is this month historically high?
    const monthlyForBlock = (monthlyData || []).reduce((sum, r) => sum + r.ticket_count, 0);
    const currentMonthTickets = (monthlyData || [])
      .filter((r) => r.month === month)
      .reduce((sum, r) => sum + r.ticket_count, 0);
    const monthlyFactor = monthlyForBlock > 0 ? currentMonthTickets / (monthlyForBlock / 12) : 1;

    // Calculate risk score (0-100)
    // Base: what percentage of total tickets happen at this hour+day
    const totalSlots = 24 * 7; // 168 possible hour+day combos
    const expectedPerSlot = totalHourly / totalSlots;
    const hotness = expectedPerSlot > 0 ? currentSlotTotal / expectedPerSlot : 0;

    // Risk score: combination of hotness ratio and monthly factor
    let riskScore = Math.min(100, Math.round(
      (Math.min(hotness, 5) / 5) * 60 +  // Up to 60 points from hourly pattern
      (Math.min(monthlyFactor, 2) / 2) * 20 + // Up to 20 points from monthly pattern
      (totalHourly > 1000 ? 20 : totalHourly > 500 ? 15 : totalHourly > 100 ? 10 : 5) // Base activity level
    ));

    // Risk level
    let riskLevel: string;
    if (riskScore >= 70) riskLevel = 'very_high';
    else if (riskScore >= 45) riskLevel = 'high';
    else if (riskScore >= 25) riskLevel = 'moderate';
    else riskLevel = 'low';

    // Top risk category for current slot
    const topCategory = currentSlot.sort((a, b) => b.ticket_count - a.ticket_count)[0];

    // Build hourly breakdown for the requested day
    const dayHourly = (hourlyData || []).filter((r) => r.day_of_week === day);
    const hourlyBreakdown: { hour: number; tickets: number; score: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const hourTickets = dayHourly
        .filter((r) => r.hour === h)
        .reduce((sum, r) => sum + r.ticket_count, 0);
      const hourScore = expectedPerSlot > 0
        ? Math.min(100, Math.round((hourTickets / expectedPerSlot) * 20))
        : 0;
      hourlyBreakdown.push({ hour: h, tickets: hourTickets, score: hourScore });
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (riskScore >= 70) {
      recommendations.push(`High enforcement activity at this time. Consider moving your car.`);
    }
    if (topCategory) {
      const catLabels: Record<string, string> = {
        street_cleaning: 'Street Cleaning',
        expired_meter: 'Expired Meter',
        permit_parking: 'Permit Parking',
        no_parking: 'No Parking/Standing',
        rush_hour: 'Rush Hour',
        city_sticker: 'City Sticker',
      };
      const label = catLabels[topCategory.violation_category] || topCategory.violation_category;
      recommendations.push(`${label} is the most common violation at this time.`);
    }

    // Find safest hours
    const sorted = [...hourlyBreakdown].sort((a, b) => a.tickets - b.tickets);
    const safest = sorted.filter(h => h.tickets === 0).slice(0, 3);
    if (safest.length > 0) {
      const safeHours = safest.map(h => {
        const ampm = h.hour < 12 ? 'AM' : 'PM';
        const disp = h.hour === 0 ? 12 : h.hour > 12 ? h.hour - 12 : h.hour;
        return `${disp}${ampm}`;
      });
      recommendations.push(`Lowest risk hours: ${safeHours.join(', ')}.`);
    }

    // Peak hours warning
    const peak = [...hourlyBreakdown].sort((a, b) => b.tickets - a.tickets).slice(0, 3);
    if (peak[0]?.tickets > 0) {
      const peakHours = peak.map(h => {
        const ampm = h.hour < 12 ? 'AM' : 'PM';
        const disp = h.hour === 0 ? 12 : h.hour > 12 ? h.hour - 12 : h.hour;
        return `${disp}${ampm}`;
      });
      recommendations.push(`Peak enforcement: ${peakHours.join(', ')}.`);
    }

    if (monthlyFactor > 1.3) {
      const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      recommendations.push(`${monthNames[month]} is a historically high-enforcement month for this block.`);
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      risk_level: riskLevel,
      risk_score: riskScore,
      block_id: blockId,
      top_risk: topCategory ? {
        category: topCategory.violation_category,
        tickets: topCategory.ticket_count,
      } : null,
      hourly_breakdown: hourlyBreakdown,
      monthly_factor: Math.round(monthlyFactor * 100) / 100,
      recommendations,
    });
  } catch (err: any) {
    console.error('[ticket-risk] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

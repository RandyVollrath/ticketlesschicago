import type { NextApiRequest, NextApiResponse } from 'next';
import wardData from '../../lib/ward-ticket-data.json';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Return ward ticket data with computed stats
    const data = wardData.map(ward => ({
      ward: ward.ward,
      tickets_2024: ward['2024'],
      risk_level: ward.risk_level,
      yoy_change: ward.yoy_change_pct,
      total_5yr: ward.total,
      avg_per_year: ward.avg_per_year,
      trend: ward.yoy_change_pct > 10 ? 'increasing' : ward.yoy_change_pct < -10 ? 'decreasing' : 'stable'
    }));

    // Sort by tickets (highest first)
    data.sort((a, b) => b.tickets_2024 - a.tickets_2024);

    return res.status(200).json({
      wards: data,
      stats: {
        highest_risk: data[0],
        lowest_risk: data[data.length - 1],
        avg_tickets: Math.round(data.reduce((sum, w) => sum + w.tickets_2024, 0) / data.length),
        total_tickets_2024: data.reduce((sum, w) => sum + w.tickets_2024, 0)
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

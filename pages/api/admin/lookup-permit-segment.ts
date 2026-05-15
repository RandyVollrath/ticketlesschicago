/**
 * GET /api/admin/lookup-permit-segment?street_dir=N&street_name=LAKEWOOD&block_low=2300
 *
 * Returns matching u9xt-hiju segment(s) for a given address-block.
 * Used by the field-collection form to auto-resolve zone + side-of-street.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { street_dir, street_name, block_low } = req.query;
  if (!street_dir || !street_name) {
    return res.status(400).json({ error: 'street_dir and street_name are required' });
  }

  // Build SODA query: find any segment whose address range overlaps block_low..block_low+99
  const lo = Number(block_low ?? 0);
  const hi = lo + 99;
  const dir = String(street_dir).toUpperCase();
  const name = String(street_name).toUpperCase();
  const where = `status='ACTIVE' AND street_direction='${dir}' AND upper(street_name)='${name}' ` +
    `AND address_range_low <= ${hi} AND address_range_high >= ${lo}`;
  const url = `https://data.cityofchicago.org/resource/u9xt-hiju.json?$where=${encodeURIComponent(where)}&$limit=10`;

  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: `SODA ${r.status}` });
    const rows = await r.json();
    return res.status(200).json({ segments: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

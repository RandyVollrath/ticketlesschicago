import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Street View Proxy — allows CLI scripts to fetch Street View images
 * through Vercel (where the Google API key is whitelisted).
 *
 * GET /api/street-view-proxy?lat=41.96&lng=-87.68&heading=0&mode=metadata
 * GET /api/street-view-proxy?lat=41.96&lng=-87.68&heading=0&mode=image
 *
 * Protected by ADMIN_API_TOKEN.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check (fail closed if not configured)
  const token = req.headers['x-admin-token'] as string;
  const adminToken = process.env.ADMIN_API_TOKEN;

  if (!adminToken) {
    console.error('ADMIN_API_TOKEN not configured - rejecting request (fail closed)');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!token || token !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { lat, lng, heading, mode, pitch, fov, width, height } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  try {
    if (mode === 'metadata') {
      // Street View Metadata API
      const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return res.status(200).json(data);
    }

    // Default: Street View Static Image
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      size: `${width || '640'}x${height || '400'}`,
      heading: String(heading || '0'),
      pitch: String(pitch || '10'),
      fov: String(fov || '90'),
      key: apiKey,
    });

    const url = `https://maps.googleapis.com/maps/api/streetview?${params}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Google API returned ${resp.status}` });
    }

    const buffer = Buffer.from(await resp.arrayBuffer());

    // Return as base64 JSON (easier for CLI to consume)
    return res.status(200).json({
      base64: buffer.toString('base64'),
      size: buffer.length,
      contentType: resp.headers.get('content-type') || 'image/jpeg',
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

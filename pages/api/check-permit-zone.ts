import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';
import { checkPermitZoneForAddress } from '../../lib/check-permit-zone';

export interface PermitZoneResult {
  hasPermitZone: boolean;
  zones: Array<{
    zone: string;
    status: string;
    addressRange: string;
    ward: string;
  }>;
  parsedAddress: {
    number: number;
    direction: string | null;
    name: string;
    type: string | null;
  } | null;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PermitZoneResult>
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: 'Method not allowed'
    });
  }

  // Get address from query or body
  const address = (req.method === 'GET'
    ? req.query.address
    : req.body?.address) as string;

  if (!address) {
    return res.status(400).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: 'Missing required parameter: address'
    });
  }

  // Rate limiting — 100 requests per minute per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: 'Too many requests. Please try again later.'
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    const result = await checkPermitZoneForAddress(address);
    if (!result.parsedAddress) {
      return res.status(400).json({
        hasPermitZone: false,
        zones: [],
        parsedAddress: null,
        error: 'Could not parse address. Please provide a valid Chicago address (e.g., "1710 S Clinton St")',
      });
    }
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error checking permit zone:', error);
    return res.status(500).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: sanitizeErrorMessage(error),
    });
  }
}

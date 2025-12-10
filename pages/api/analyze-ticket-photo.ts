import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';
import { sanitizeErrorMessage } from '../../lib/error-utils';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit expensive Vision API calls
  const ip = getClientIP(req);
  const rateLimitResult = await checkRateLimit(ip, 'vision_api');

  res.setHeader('X-RateLimit-Limit', rateLimitResult.limit);
  res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);

  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${Math.ceil(rateLimitResult.resetIn / 1000)} seconds.`,
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }

  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Image is required' });
  }

  // Record the action before making the expensive API call
  await recordRateLimitAction(ip, 'vision_api');

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this Chicago parking ticket and extract the following information in JSON format:

{
  "violation_type": "Street Cleaning" | "Expired Meter" | "Residential Permit Zone" | "No City Sticker" | "Fire Hydrant" | "Expired Plate/Registration" | "Snow Route Parking" | "Other",
  "ticket_number": "ticket number if visible",
  "ticket_date": "date in YYYY-MM-DD format if visible",
  "fine_amount": "dollar amount if visible",
  "violation_description": "brief description of what the ticket says"
}

If you can't determine a field, use null. Be as accurate as possible.`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');

    return res.status(200).json(result);

  } catch (error: any) {
    console.error('Error analyzing ticket photo:', error);
    return res.status(500).json({
      error: 'Failed to analyze ticket photo'
    });
  }
}

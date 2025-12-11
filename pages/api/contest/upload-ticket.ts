import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Anthropic client
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - 20 uploads per hour per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'upload');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many upload attempts. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'upload');

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { imageData, imageType } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // Upload image to Supabase storage
    const fileName = `${user.id}/${Date.now()}-ticket.${imageType === 'image/jpeg' ? 'jpg' : 'png'}`;
    const base64Data = imageData.split(',')[1] || imageData;
    const buffer = Buffer.from(base64Data, 'base64');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('ticket-photos')
      .upload(fileName, buffer, {
        contentType: imageType,
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload image' });
    }

    const { data: urlData } = supabase.storage
      .from('ticket-photos')
      .getPublicUrl(fileName);

    const photoUrl = urlData.publicUrl;

    // Extract ticket details using Claude vision
    let extractedData = null;
    if (anthropic) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: imageType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: `Extract all information from this parking/traffic ticket. Return a JSON object with the following fields (use null if not found):
{
  "ticketNumber": "string",
  "violationCode": "string",
  "violationDescription": "string",
  "ticketDate": "YYYY-MM-DD",
  "ticketAmount": number,
  "location": "string",
  "licensePlate": "string",
  "issueTime": "string",
  "dueDate": "YYYY-MM-DD",
  "cityOrMunicipality": "string"
}

Only return the JSON object, no other text.`
                }
              ]
            }
          ]
        });

        // Parse the response
        const content = message.content[0];
        if (content.type === 'text') {
          const jsonText = content.text.trim();
          // Remove markdown code blocks if present
          const cleanedJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
          extractedData = JSON.parse(cleanedJson);
        }
      } catch (error) {
        console.error('Error extracting ticket data with Claude:', error);
        // Continue without extracted data
      }
    }

    // Create initial contest record
    const { data: contest, error: insertError } = await supabase
      .from('ticket_contests')
      .insert({
        user_id: user.id,
        ticket_photo_url: photoUrl,
        ticket_number: extractedData?.ticketNumber,
        violation_code: extractedData?.violationCode,
        violation_description: extractedData?.violationDescription,
        ticket_date: extractedData?.ticketDate,
        ticket_amount: extractedData?.ticketAmount,
        ticket_location: extractedData?.location,
        license_plate: extractedData?.licensePlate,
        extracted_data: extractedData,
        status: 'draft'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create contest record' });
    }

    res.status(200).json({
      success: true,
      contest,
      extractedData
    });

  } catch (error: any) {
    console.error('Upload ticket error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

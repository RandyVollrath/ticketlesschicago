/**
 * Lob.com Mail Service Integration
 * Handles automated letter mailing for contest submissions
 */

interface MailingAddress {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface SendLetterParams {
  to: MailingAddress;
  letterContent: string; // HTML content of the letter
  description?: string;
  metadata?: Record<string, string>;
}

interface LobMailResponse {
  id: string;
  url: string;
  tracking_number?: string;
  expected_delivery_date?: string;
}

/**
 * Send a letter via Lob.com
 */
export async function sendLetter(params: SendLetterParams): Promise<LobMailResponse> {
  const { to, letterContent, description, metadata } = params;

  if (!process.env.LOB_API_KEY) {
    throw new Error('LOB_API_KEY not configured');
  }

  const lobApiKey = process.env.LOB_API_KEY;
  const authHeader = 'Basic ' + Buffer.from(lobApiKey + ':').toString('base64');

  try {
    // Lob API expects letter content as HTML
    const response = await fetch('https://api.lob.com/v1/letters', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: description || 'Contest letter mailing',
        to: {
          name: to.name,
          address_line1: to.address,
          address_city: to.city,
          address_state: to.state,
          address_zip: to.zip,
          address_country: 'US'
        },
        from: {
          name: 'Autopilot America',
          address_line1: '123 Main St', // TODO: Replace with actual return address
          address_city: 'Chicago',
          address_state: 'IL',
          address_zip: '60601',
          address_country: 'US'
        },
        file: letterContent, // HTML string
        color: false, // Black & white printing (cheaper)
        double_sided: false,
        metadata: metadata || {}
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Lob API error:', errorData);
      throw new Error(`Lob API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    return {
      id: data.id,
      url: data.url,
      tracking_number: data.tracking_number,
      expected_delivery_date: data.expected_delivery_date
    };

  } catch (error) {
    console.error('Error sending letter via Lob:', error);
    throw error;
  }
}

/**
 * Convert plain text letter to HTML format for Lob
 */
export function formatLetterAsHTML(letterText: string): string {
  // Escape HTML entities
  const escaped = letterText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert line breaks to <br> and wrap in basic HTML structure
  const withBreaks = escaped.replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      margin: 1in;
    }
  </style>
</head>
<body>
  ${withBreaks}
</body>
</html>
  `.trim();
}

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

// Chicago Department of Finance - Parking Ticket Contest Address
// Per city website: must be signed by registered owner
export const CHICAGO_PARKING_CONTEST_ADDRESS: MailingAddress = {
  name: 'City of Chicago - Department of Finance',
  address: 'PO Box 88292',
  city: 'Chicago',
  state: 'IL',
  zip: '60680-1292'
};

// Cook County Board of Review - Property Tax Appeals Address
// For filing residential property tax appeals
export const COOK_COUNTY_BOR_ADDRESS: MailingAddress = {
  name: 'Cook County Board of Review',
  address: '118 N. Clark Street, Room 601',
  city: 'Chicago',
  state: 'IL',
  zip: '60602'
};

interface SendLetterParams {
  from: MailingAddress; // User's address (sender)
  to: MailingAddress; // City department address (recipient)
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
 * from = User's address (appears as sender)
 * to = City department (recipient)
 */
export async function sendLetter(params: SendLetterParams): Promise<LobMailResponse> {
  const { from, to, letterContent, description, metadata } = params;

  if (!process.env.LOB_API_KEY) {
    throw new Error('LOB_API_KEY not configured');
  }

  const lobApiKey = process.env.LOB_API_KEY;
  const authHeader = 'Basic ' + Buffer.from(lobApiKey + ':').toString('base64');

  try {
    console.log('Sending letter via Lob API...');
    console.log('  From:', from.name, '-', from.address, from.city, from.state, from.zip);
    console.log('  To:', to.name, '-', to.address, to.city, to.state, to.zip);
    console.log('  Letter content length:', letterContent.length, 'chars');

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
          name: from.name,
          address_line1: from.address,
          address_city: from.city,
          address_state: from.state,
          address_zip: from.zip,
          address_country: 'US'
        },
        file: letterContent, // HTML string
        color: false, // Black & white printing (cheaper)
        double_sided: false,
        use_type: 'operational', // Required by Lob - operational for transactional mail like contest letters
        metadata: metadata || {}
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Lob API error response:', JSON.stringify(errorData, null, 2));
      console.error('Lob API status code:', response.status);
      const errorMessage = errorData.error?.message || errorData.message || JSON.stringify(errorData);
      throw new Error(`Lob API error (${response.status}): ${errorMessage}`);
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
 * Maximum number of user evidence images to include.
 * Street View images are separate and don't count toward this limit.
 */
const MAX_USER_EVIDENCE_IMAGES = 5;

/**
 * Direction labels for Street View images
 */
const DIRECTION_LABELS: Record<number, string> = {
  0: 'North',
  1: 'East',
  2: 'South',
  3: 'West',
};

/**
 * Convert plain text letter to HTML format for Lob.
 * Optionally includes signature image, user evidence images, and Street View images.
 *
 * @param letterText - The letter content text
 * @param options.signatureImage - Optional signature image URL
 * @param options.evidenceImages - Array of user evidence image URLs (max 5 will be included)
 * @param options.streetViewImages - Array of Street View image URLs (N/E/S/W directions)
 * @param options.streetViewDate - Date of the Street View imagery (e.g., "2024-07")
 * @param options.streetViewAddress - Address shown in the Street View images
 */
export function formatLetterAsHTML(
  letterText: string,
  options?: {
    signatureImage?: string;
    evidenceImages?: string[];
    streetViewImages?: string[];
    streetViewDate?: string | null;
    streetViewAddress?: string | null;
  }
): string {
  const { signatureImage, evidenceImages, streetViewImages, streetViewDate, streetViewAddress } = options || {};

  // Clean up the letter text - remove leading/trailing delimiters and whitespace
  let cleanedText = letterText.trim();
  // Remove markdown-style delimiters that AI might add
  if (cleanedText.startsWith('---')) {
    cleanedText = cleanedText.replace(/^---\s*\n?/, '');
  }
  if (cleanedText.endsWith('---')) {
    cleanedText = cleanedText.replace(/\n?---\s*$/, '');
  }

  // Escape HTML entities
  const escaped = cleanedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert line breaks to <br> and wrap in basic HTML structure
  const withBreaks = escaped.replace(/\n/g, '<br>');

  // Add signature if provided
  const signatureHTML = signatureImage
    ? `<div style="margin-top: 30px;">
        <p style="margin-bottom: 10px;">Signature:</p>
        <img src="${signatureImage}" alt="Signature" style="max-width: 300px; height: auto; border-bottom: 1px solid #000;" />
      </div>`
    : '';

  // Track exhibit numbering across all evidence types
  let exhibitNumber = 1;

  // Add Street View images (these go first as signage evidence)
  let streetViewHTML = '';
  if (streetViewImages && streetViewImages.length > 0) {
    const locationLabel = streetViewAddress || 'Ticket Location';
    const dateLabel = streetViewDate ? ` (Imagery Date: ${streetViewDate})` : '';

    streetViewHTML = `
      <div style="page-break-before: always; margin-top: 30px;">
        <h3 style="font-size: 14pt; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 8px;">
          Exhibit A: Google Street View Signage Evidence
        </h3>
        <p style="font-size: 10pt; color: #333; margin-bottom: 15px;">
          Location: ${locationLabel}${dateLabel}<br>
          The following ${streetViewImages.length} photographs show the signage conditions at the citation location
          from each cardinal direction, as captured by Google Street View.
          These images are publicly available and can be independently verified.
        </p>
        ${streetViewImages.map((url, index) => `
          <div style="margin-bottom: 15px; ${index === 2 ? 'page-break-before: always;' : ''}">
            <p style="font-size: 10pt; font-weight: bold; margin-bottom: 5px;">
              Exhibit ${exhibitNumber++}: ${DIRECTION_LABELS[index] || `Direction ${index + 1}`}-Facing View
            </p>
            <img src="${url}" alt="Street View - ${DIRECTION_LABELS[index] || `Direction ${index + 1}`}" style="max-width: 100%; max-height: 350px; border: 1px solid #999;" />
          </div>
        `).join('')}
      </div>
    `;
  }

  // Add user evidence images if provided (limit to MAX_USER_EVIDENCE_IMAGES)
  let evidenceHTML = '';
  if (evidenceImages && evidenceImages.length > 0) {
    const imagesToInclude = evidenceImages.slice(0, MAX_USER_EVIDENCE_IMAGES);

    evidenceHTML = `
      <div style="page-break-before: always; margin-top: 30px;">
        <h3 style="font-size: 14pt; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 8px;">
          ${streetViewImages && streetViewImages.length > 0 ? 'Exhibit B: ' : ''}Additional Supporting Evidence
        </h3>
        ${imagesToInclude.map((url, index) => `
          <div style="margin-bottom: 20px; ${index > 0 && index % 2 === 0 ? 'page-break-before: always;' : ''}">
            <p style="font-size: 10pt; font-weight: bold; margin-bottom: 5px;">Exhibit ${exhibitNumber++}</p>
            <img src="${url}" alt="Evidence ${index + 1}" style="max-width: 100%; max-height: 400px; border: 1px solid #ccc;" />
          </div>
        `).join('')}
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.3;
      margin: 0.75in 0.75in 0.5in 0.75in;
    }
    @media print {
      img { max-width: 100%; height: auto; }
    }
    @page {
      margin: 0.5in;
    }
  </style>
</head>
<body>
  ${withBreaks}
  ${signatureHTML}
  ${streetViewHTML}
  ${evidenceHTML}
</body>
</html>
  `.trim();
}

/**
 * Send a property tax appeal letter with PDF attachment via Lob
 * Uses Lob's letter API with PDF file support
 */
interface SendPropertyTaxAppealParams {
  from: MailingAddress;
  pdfUrl: string; // URL to the generated appeal PDF
  appealId: string;
  pin: string;
  township: string;
  useCertifiedMail?: boolean;
}

export async function sendPropertyTaxAppealLetter(
  params: SendPropertyTaxAppealParams
): Promise<LobMailResponse> {
  const { from, pdfUrl, appealId, pin, township, useCertifiedMail = false } = params;

  if (!process.env.LOB_API_KEY) {
    throw new Error('LOB_API_KEY not configured');
  }

  const lobApiKey = process.env.LOB_API_KEY;
  const authHeader = 'Basic ' + Buffer.from(lobApiKey + ':').toString('base64');

  try {
    const response = await fetch('https://api.lob.com/v1/letters', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `Property Tax Appeal - ${pin} - ${township}`,
        to: {
          name: COOK_COUNTY_BOR_ADDRESS.name,
          address_line1: COOK_COUNTY_BOR_ADDRESS.address,
          address_city: COOK_COUNTY_BOR_ADDRESS.city,
          address_state: COOK_COUNTY_BOR_ADDRESS.state,
          address_zip: COOK_COUNTY_BOR_ADDRESS.zip,
          address_country: 'US'
        },
        from: {
          name: from.name,
          address_line1: from.address,
          address_city: from.city,
          address_state: from.state,
          address_zip: from.zip,
          address_country: 'US'
        },
        file: pdfUrl, // Lob accepts PDF URL
        color: false,
        double_sided: true, // Property tax appeals can be multi-page
        address_placement: 'top_first_page',
        extra_service: useCertifiedMail ? 'certified' : undefined,
        use_type: 'operational', // Required by Lob - operational for transactional mail
        metadata: {
          appealId,
          pin,
          township,
          type: 'property_tax_appeal'
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Lob API error for property tax appeal:', errorData);
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
    console.error('Error sending property tax appeal via Lob:', error);
    throw error;
  }
}

/**
 * Get letter status from Lob
 */
export async function getLetterStatus(letterId: string): Promise<{
  id: string;
  status: string;
  tracking_number?: string;
  expected_delivery_date?: string;
  carrier?: string;
}> {
  if (!process.env.LOB_API_KEY) {
    throw new Error('LOB_API_KEY not configured');
  }

  const lobApiKey = process.env.LOB_API_KEY;
  const authHeader = 'Basic ' + Buffer.from(lobApiKey + ':').toString('base64');

  const response = await fetch(`https://api.lob.com/v1/letters/${letterId}`, {
    method: 'GET',
    headers: {
      'Authorization': authHeader
    }
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Lob API error: ${errorData.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    status: data.send_date ? 'mailed' : 'processing',
    tracking_number: data.tracking_number,
    expected_delivery_date: data.expected_delivery_date,
    carrier: data.carrier
  };
}

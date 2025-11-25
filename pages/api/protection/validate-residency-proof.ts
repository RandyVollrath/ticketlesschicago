/**
 * Validate Residency Proof Document - OCR-based Verification
 *
 * Uses Google Cloud Vision to:
 * 1. Verify it's a legitimate document (utility bill, lease, mortgage, property tax)
 * 2. Extract and validate address against user's profile
 * 3. Extract document date and determine validity period
 * 4. Cross-reference with city sticker expiry date
 *
 * Returns validation results for admin review or auto-approval
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import vision from '@google-cloud/vision';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Google Cloud Vision client
let visionClient: vision.ImageAnnotatorClient | null = null;
if (process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
  try {
    const rawCreds = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    const fixedCreds = rawCreds.replace(/"private_key":\s*"([^"]*?)"/gs, (match, key) => {
      const escaped = key.replace(/\n/g, '\\n');
      return `"private_key": "${escaped}"`;
    });
    const credentials = JSON.parse(fixedCreds);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
    console.log('Google Cloud Vision initialized for residency proof validation');
  } catch (error) {
    console.error('Failed to initialize Google Cloud Vision:', error);
  }
}

// Document type detection patterns
const DOCUMENT_TYPE_PATTERNS = {
  utility_bill: [
    /(?:comed|commonwealth\s*edison)/i,
    /(?:peoples?\s*gas|nicor)/i,
    /(?:chicago\s*water|water\s*bill)/i,
    /(?:at&t|xfinity|comcast|rcn)/i,
    /(?:electric|gas|water|internet|phone)\s*(?:bill|service|statement)/i,
    /(?:utility|service)\s*(?:bill|statement|charge)/i,
    /(?:meter\s*read|usage|consumption)/i,
    /(?:kwh|therms|ccf|gallons)/i,
  ],
  lease: [
    /(?:lease\s*agreement|rental\s*agreement|lease\s*contract)/i,
    /(?:landlord|tenant|lessee|lessor)/i,
    /(?:term\s*of\s*lease|lease\s*term)/i,
    /(?:monthly\s*rent|rent\s*(?:amount|payment))/i,
    /(?:security\s*deposit)/i,
    /(?:premises|leased\s*property|apartment\s*address)/i,
    /(?:lessee|tenant)[:\s]+[A-Za-z\s]+/i,
    /(?:lessor|landlord|owner)[:\s]+[A-Za-z\s]+/i,
  ],
  mortgage: [
    /(?:mortgage\s*statement|loan\s*statement)/i,
    /(?:principal|interest|escrow)/i,
    /(?:mortgage\s*payment|loan\s*payment)/i,
    /(?:property\s*taxes|homeowners?\s*insurance)/i,
    /(?:lender|servicer|mortgagee)/i,
  ],
  property_tax: [
    /(?:property\s*tax|real\s*estate\s*tax)/i,
    /(?:cook\s*county|tax\s*bill)/i,
    /(?:assessed\s*value|tax\s*rate)/i,
    /(?:PIN|parcel|property\s*index)/i,
    /(?:installment|first\s*installment|second\s*installment)/i,
    // IRS Form 1098 - Mortgage Interest Statement (shows property taxes paid)
    /form\s*1098/i,
    /mortgage\s*interest\s*statement/i,
    /real\s*estate\s*taxes\s*paid/i,
    /property\s*securing\s*(?:the\s*)?mortgage/i,
    /address\s*(?:of|or\s*description\s*of)\s*property\s*securing/i,
  ],
};

// Address extraction patterns
const ADDRESS_PATTERNS = [
  // Full address with city/state
  /(\d+\s+[A-Za-z0-9\s\.]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle)[.,]?\s*(?:#|Apt|Unit|Suite|Ste|Floor|Fl)?[.,]?\s*[A-Za-z0-9]*[.,]?\s*Chicago[.,]?\s*(?:IL|Illinois)?[.,]?\s*\d{5}(?:-\d{4})?)/gi,
  // Address without zip
  /(\d+\s+[A-Za-z0-9\s\.]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle)[.,]?\s*(?:#|Apt|Unit|Suite|Ste|Floor|Fl)?[.,]?\s*[A-Za-z0-9]*[.,]?\s*Chicago)/gi,
  // Labeled address patterns (lease, property documents)
  /(?:apartment\s*address|service\s*address|property\s*address|premises|location)[:\s]*([^\n]+(?:Chicago|IL)[^\n]*)/gi,
  // Property securing mortgage (Form 1098)
  /(?:address\s*(?:of|or\s*description\s*of)\s*property)[:\s]*([^\n]+(?:Chicago|IL)[^\n]*)/gi,
];

// Date extraction patterns
const DATE_PATTERNS = {
  // Statement/Bill date patterns
  statement_date: [
    /(?:statement\s*date|bill\s*date|invoice\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(?:statement\s*date|bill\s*date)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/gi,
    /(?:dated?|issued)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    // Form 1098 calendar year format
    /(?:for\s*)?calendar\s*year[:\s]*(\d{4})/gi,
    /(?:tax\s*year|for\s*year)[:\s]*(\d{4})/gi,
  ],
  // Due date patterns
  due_date: [
    /(?:due\s*date|payment\s*due|pay\s*by)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(?:due\s*date|payment\s*due)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/gi,
    /(?:due\s*(?:by|on))[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
  ],
  // Service period patterns
  service_period: [
    /(?:service\s*period|billing\s*period)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(?:for\s*period)[:\s]*([A-Za-z]+\s+\d{1,2})\s*(?:to|-|through)\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/gi,
  ],
  // Lease term patterns
  lease_term: [
    /(?:lease\s*(?:term|period)|term\s*of\s*lease)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(?:commencing|beginning|start)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}).*?(?:ending|expir(?:es|ing)|terminat(?:es|ing))[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
  ],
};

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  documentType: string | null;
  extractedAddress: string | null;
  addressMatch: {
    matches: boolean;
    confidence: number;
    userAddress: string;
    extractedAddress: string;
    explanation: string;
  } | null;
  dates: {
    statementDate: string | null;
    dueDate: string | null;
    servicePeriodStart: string | null;
    servicePeriodEnd: string | null;
    documentValidUntil: string | null;
  };
  cityStrickerCheck: {
    stickerExpiry: string | null;
    documentValidForRenewal: boolean;
    explanation: string;
  } | null;
  issues: string[];
  rawText?: string;
}

/**
 * Parse date string into Date object
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try year-only format (for Form 1098 "calendar year 2024")
  // Treat as end of that year for validity purposes
  const yearOnlyMatch = dateStr.match(/^(\d{4})$/);
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1]);
    return new Date(year, 11, 31); // December 31 of that year
  }

  // Try MM/DD/YYYY or MM-DD-YYYY
  let match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let [, month, day, year] = match;
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Try "Month DD, YYYY" format
  match = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (match) {
    const [, monthStr, day, year] = match;
    const months: { [key: string]: number } = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
    };
    const monthNum = months[monthStr.toLowerCase()];
    if (monthNum !== undefined) {
      return new Date(parseInt(year), monthNum, parseInt(day));
    }
  }

  return null;
}

/**
 * Detect document type from extracted text
 */
function detectDocumentType(text: string): { type: string; confidence: number } | null {
  const scores: { [key: string]: number } = {};

  for (const [docType, patterns] of Object.entries(DOCUMENT_TYPE_PATTERNS)) {
    scores[docType] = 0;
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        scores[docType] += matches.length;
      }
    }
  }

  // Find highest scoring type
  let bestType: string | null = null;
  let bestScore = 0;

  for (const [docType, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = docType;
    }
  }

  if (bestType && bestScore >= 2) {
    // Confidence based on match count (2 matches = 60%, 5+ matches = 95%)
    const confidence = Math.min(0.95, 0.5 + (bestScore * 0.1));
    return { type: bestType, confidence };
  }

  return null;
}

/**
 * Extract addresses from text
 */
function extractAddresses(text: string): string[] {
  const addresses: string[] = [];

  for (const pattern of ADDRESS_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const addr = match[1]?.trim()
        .replace(/\s+/g, ' ')
        .replace(/[.,]+$/, '');
      if (addr && addr.length > 10 && !addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  }

  return addresses;
}

/**
 * Normalize address for comparison
 */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bapartment\b/g, 'apt')
    .replace(/\bunit\b/g, '#')
    .replace(/\bsuite\b/g, 'ste')
    .replace(/\billinois\b/g, 'il')
    .trim();
}

/**
 * Compare two addresses and return match confidence
 */
function compareAddresses(addr1: string, addr2: string): { matches: boolean; confidence: number; explanation: string } {
  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);

  // Exact match
  if (norm1 === norm2) {
    return { matches: true, confidence: 1.0, explanation: 'Exact match' };
  }

  // Extract street number and name
  const extractStreet = (addr: string) => {
    const match = addr.match(/^(\d+)\s+(.+?)(?:\s+(?:apt|#|unit|ste|chicago|il|\d{5}))/i);
    return match ? { number: match[1], street: match[2].trim() } : null;
  };

  const street1 = extractStreet(norm1);
  const street2 = extractStreet(norm2);

  if (street1 && street2) {
    // Same street number and street name
    if (street1.number === street2.number && street1.street === street2.street) {
      return { matches: true, confidence: 0.95, explanation: 'Street address matches (minor formatting differences)' };
    }

    // Same street number, similar street name
    if (street1.number === street2.number) {
      const similarity = calculateStringSimilarity(street1.street, street2.street);
      if (similarity > 0.8) {
        return { matches: true, confidence: 0.85, explanation: 'Street number matches, street name similar' };
      }
    }
  }

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return { matches: true, confidence: 0.8, explanation: 'One address contains the other' };
  }

  // Calculate overall similarity
  const similarity = calculateStringSimilarity(norm1, norm2);
  if (similarity > 0.7) {
    return { matches: true, confidence: similarity, explanation: `Addresses are ${Math.round(similarity * 100)}% similar` };
  }

  return { matches: false, confidence: similarity, explanation: 'Addresses do not match' };
}

/**
 * Simple string similarity (Jaccard index on words)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 1));
  const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 1));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Extract dates from document text
 */
function extractDates(text: string): {
  statementDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
} {
  const result = {
    statementDate: null as string | null,
    dueDate: null as string | null,
    servicePeriodStart: null as string | null,
    servicePeriodEnd: null as string | null,
  };

  // Extract statement date
  for (const pattern of DATE_PATTERNS.statement_date) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const date = parseDate(match[1]);
      if (date) {
        result.statementDate = date.toISOString().split('T')[0];
        break;
      }
    }
  }

  // Extract due date
  for (const pattern of DATE_PATTERNS.due_date) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const date = parseDate(match[1]);
      if (date) {
        result.dueDate = date.toISOString().split('T')[0];
        break;
      }
    }
  }

  // Extract service period (for utility bills)
  for (const pattern of DATE_PATTERNS.service_period) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const startDate = parseDate(match[1]);
      const endDate = parseDate(match[2]);
      if (startDate) result.servicePeriodStart = startDate.toISOString().split('T')[0];
      if (endDate) result.servicePeriodEnd = endDate.toISOString().split('T')[0];
      break;
    }
  }

  // Extract lease term (for leases)
  if (!result.servicePeriodEnd) {
    for (const pattern of DATE_PATTERNS.lease_term) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) {
        const startDate = parseDate(match[1]);
        const endDate = parseDate(match[2]);
        if (startDate) result.servicePeriodStart = startDate.toISOString().split('T')[0];
        if (endDate) result.servicePeriodEnd = endDate.toISOString().split('T')[0];
        break;
      }
    }
  }

  return result;
}

/**
 * Calculate document validity period based on type and dates
 */
function calculateValidityPeriod(
  documentType: string | null,
  dates: { statementDate: string | null; dueDate: string | null; servicePeriodEnd: string | null }
): string | null {
  const today = new Date();

  // Leases are valid until lease end date
  if (documentType === 'lease' && dates.servicePeriodEnd) {
    return dates.servicePeriodEnd;
  }

  // Utility bills are typically valid for 60 days from statement date or 30 days from due date
  if (documentType === 'utility_bill') {
    if (dates.dueDate) {
      const dueDate = new Date(dates.dueDate);
      dueDate.setDate(dueDate.getDate() + 30);
      return dueDate.toISOString().split('T')[0];
    }
    if (dates.statementDate) {
      const statementDate = new Date(dates.statementDate);
      statementDate.setDate(statementDate.getDate() + 60);
      return statementDate.toISOString().split('T')[0];
    }
  }

  // Property tax bills/Form 1098 are valid for 12 months from statement date
  // This covers the full tax year plus buffer for renewals
  if (documentType === 'property_tax') {
    if (dates.statementDate) {
      const statementDate = new Date(dates.statementDate);
      statementDate.setMonth(statementDate.getMonth() + 12);
      return statementDate.toISOString().split('T')[0];
    }
  }

  // Mortgage statements are valid for 12 months (proves ongoing homeownership)
  if (documentType === 'mortgage') {
    if (dates.statementDate) {
      const statementDate = new Date(dates.statementDate);
      statementDate.setMonth(statementDate.getMonth() + 12);
      return statementDate.toISOString().split('T')[0];
    }
  }

  // Default: 60 days from today if we can't determine
  const defaultValidity = new Date(today);
  defaultValidity.setDate(defaultValidity.getDate() + 60);
  return defaultValidity.toISOString().split('T')[0];
}

/**
 * Check if document is valid for city sticker renewal
 */
function checkCityStickerValidity(
  documentValidUntil: string | null,
  cityStickerExpiry: string | null
): { documentValidForRenewal: boolean; explanation: string } {
  if (!cityStickerExpiry) {
    return {
      documentValidForRenewal: true,
      explanation: 'No city sticker expiry date on file - cannot verify renewal period',
    };
  }

  if (!documentValidUntil) {
    return {
      documentValidForRenewal: false,
      explanation: 'Could not determine document validity period',
    };
  }

  const docValid = new Date(documentValidUntil);
  const stickerExpiry = new Date(cityStickerExpiry);

  // Document should be valid at the time of renewal
  // City sticker renewals typically open 2 months before expiry
  const renewalStart = new Date(stickerExpiry);
  renewalStart.setMonth(renewalStart.getMonth() - 2);

  if (docValid >= stickerExpiry) {
    return {
      documentValidForRenewal: true,
      explanation: `Document valid until ${documentValidUntil}, covers sticker expiry ${cityStickerExpiry}`,
    };
  } else if (docValid >= renewalStart) {
    return {
      documentValidForRenewal: true,
      explanation: `Document valid until ${documentValidUntil}, covers early renewal period starting ${renewalStart.toISOString().split('T')[0]}`,
    };
  } else {
    return {
      documentValidForRenewal: false,
      explanation: `Document expires ${documentValidUntil}, before sticker renewal period. Need document dated after ${renewalStart.toISOString().split('T')[0]}`,
    };
  }
}

/**
 * Main validation function using Google Cloud Vision OCR
 */
export async function validateResidencyProof(
  imageBuffer: Buffer,
  userAddress: string,
  cityStickerExpiry: string | null
): Promise<ValidationResult> {
  const result: ValidationResult = {
    isValid: false,
    confidence: 0,
    documentType: null,
    extractedAddress: null,
    addressMatch: null,
    dates: {
      statementDate: null,
      dueDate: null,
      servicePeriodStart: null,
      servicePeriodEnd: null,
      documentValidUntil: null,
    },
    cityStrickerCheck: null,
    issues: [],
  };

  if (!visionClient) {
    result.issues.push('Google Cloud Vision not configured');
    return result;
  }

  try {
    // Run OCR with document text detection
    const [ocrResult] = await visionClient.documentTextDetection({
      image: { content: imageBuffer },
    });

    const fullText = ocrResult.fullTextAnnotation?.text || '';
    result.rawText = fullText;

    if (!fullText || fullText.length < 50) {
      result.issues.push('Could not extract readable text from document');
      return result;
    }

    console.log(`OCR extracted ${fullText.length} characters`);

    // 1. Detect document type
    const docType = detectDocumentType(fullText);
    if (docType) {
      result.documentType = docType.type;
      result.confidence = docType.confidence;
    } else {
      result.issues.push('Could not identify document type (utility bill, lease, mortgage, or property tax)');
    }

    // 2. Extract and validate address
    const addresses = extractAddresses(fullText);
    if (addresses.length > 0) {
      result.extractedAddress = addresses[0];

      if (userAddress) {
        const addressComparison = compareAddresses(addresses[0], userAddress);
        result.addressMatch = {
          matches: addressComparison.matches,
          confidence: addressComparison.confidence,
          userAddress,
          extractedAddress: addresses[0],
          explanation: addressComparison.explanation,
        };

        if (!addressComparison.matches) {
          result.issues.push(`Address mismatch: Document shows "${addresses[0]}" but profile shows "${userAddress}"`);
        }
      }
    } else {
      result.issues.push('Could not extract address from document');
    }

    // 3. Extract dates
    const dates = extractDates(fullText);
    result.dates = {
      ...dates,
      documentValidUntil: calculateValidityPeriod(result.documentType, dates),
    };

    if (!dates.statementDate && !dates.dueDate && !dates.servicePeriodEnd) {
      result.issues.push('Could not extract any dates from document');
    }

    // 4. Check city sticker validity
    if (cityStickerExpiry) {
      const stickerCheck = checkCityStickerValidity(result.dates.documentValidUntil, cityStickerExpiry);
      result.cityStrickerCheck = {
        stickerExpiry: cityStickerExpiry,
        ...stickerCheck,
      };

      if (!stickerCheck.documentValidForRenewal) {
        result.issues.push(stickerCheck.explanation);
      }
    }

    // 5. Determine overall validity
    result.isValid =
      result.documentType !== null &&
      result.addressMatch?.matches === true &&
      result.issues.length === 0;

    // Calculate overall confidence
    if (result.isValid) {
      result.confidence = Math.min(
        result.confidence,
        result.addressMatch?.confidence || 0
      );
    }

    return result;

  } catch (error: any) {
    console.error('Vision API error:', error);
    result.issues.push(`OCR processing failed: ${error.message}`);
    return result;
  }
}

/**
 * API Handler - validates uploaded document or stored document
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, documentPath } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('home_address_full, city_sticker_expiry, residency_proof_path')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get document from storage
    const docPath = documentPath || profile.residency_proof_path;
    if (!docPath) {
      return res.status(400).json({ error: 'No document path provided and no residency proof on file' });
    }

    // Download document from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('residency-proofs-temps')
      .download(docPath);

    if (downloadError || !fileData) {
      return res.status(404).json({ error: 'Document not found in storage', details: downloadError?.message });
    }

    // Convert to buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Run validation
    const validationResult = await validateResidencyProof(
      buffer,
      profile.home_address_full || '',
      profile.city_sticker_expiry
    );

    // Store validation results in database
    await supabase
      .from('user_profiles')
      .update({
        residency_proof_validation: validationResult,
        residency_proof_validated_at: new Date().toISOString(),
        residency_proof_verified: validationResult.isValid,
        residency_proof_verified_at: validationResult.isValid ? new Date().toISOString() : null,
      })
      .eq('user_id', userId);

    // Don't return raw OCR text to client (too large, contains PII)
    const clientResult = { ...validationResult };
    delete clientResult.rawText;

    return res.status(200).json({
      success: true,
      validation: clientResult,
      autoApproved: validationResult.isValid,
    });

  } catch (error: any) {
    console.error('Validation error:', error);
    return res.status(500).json({
      error: 'Validation failed',
      details: error.message,
    });
  }
}

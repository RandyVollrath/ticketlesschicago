/**
 * Generate Property Tax Appeal Letter
 *
 * Uses Claude to generate a professional appeal letter
 * based on property data and comparables.
 *
 * POST /api/property-tax/generate-letter
 * Body: { appealId: string, additionalContext?: string }
 * Response: { letter: string, letterHtml: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to generate a letter' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in to generate a letter' });
    }

    const { appealId, additionalContext } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Please provide an appeal ID' });
    }

    // Get the appeal record
    const { data: appeal, error: appealError } = await supabase
      .from('property_tax_appeals')
      .select('*')
      .eq('id', appealId)
      .eq('user_id', user.id)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Get comparables for this appeal
    const { data: comparables } = await supabase
      .from('property_tax_comparables')
      .select('*')
      .eq('appeal_id', appealId)
      .eq('is_primary', true)
      .order('value_per_sqft', { ascending: true })
      .limit(5);

    // Get user profile for name
    const { data: profile } = await supabase
      .from('users')
      .select('first_name, last_name, email, phone_number, street_address')
      .eq('id', user.id)
      .single();

    // Check if Anthropic is configured
    if (!anthropic) {
      return res.status(503).json({
        error: 'Letter generation service is not configured'
      });
    }

    // Build context for Claude
    const ownerName = profile?.first_name && profile?.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : '[Property Owner Name]';

    const formattedComparables = (comparables || []).map((comp, i) => ({
      number: i + 1,
      address: comp.comp_address,
      pin: formatPin(comp.comp_pin),
      assessedValue: comp.comp_assessed_value,
      squareFootage: comp.comp_square_footage,
      yearBuilt: comp.comp_year_built,
      valuePerSqft: comp.value_per_sqft ? `$${comp.value_per_sqft.toFixed(2)}` : 'N/A',
      recentSale: comp.comp_sale_price ? `$${comp.comp_sale_price.toLocaleString()} (${comp.comp_sale_date})` : null
    }));

    const subjectValuePerSqft = appeal.current_assessed_value && appeal.opportunity_analysis?.squareFootage
      ? (appeal.current_assessed_value / appeal.opportunity_analysis.squareFootage).toFixed(2)
      : null;

    // Calculate the average comparable value
    const avgCompValue = formattedComparables.length > 0
      ? formattedComparables.reduce((sum, c) => sum + (c.assessedValue || 0), 0) / formattedComparables.length
      : null;

    // Format appeal grounds for letter
    const appealGroundsDescriptions: Record<string, string> = {
      comparable_sales: 'comparable properties in the same assessment neighborhood have lower assessed values',
      characteristic_error: 'there are errors in the recorded property characteristics',
      recent_purchase: 'the recent purchase price was significantly lower than the assessed value',
      appraisal: 'a recent professional appraisal indicates a lower value',
      damage: 'the property has sustained damage that reduces its value'
    };

    const groundsText = (appeal.appeal_grounds || [])
      .map((g: string) => appealGroundsDescriptions[g] || g)
      .join('; ');

    // Generate the letter using Claude
    const prompt = `You are an expert property tax appeal writer for Cook County, Illinois. Generate a professional, compelling appeal letter for the Cook County Board of Review.

PROPERTY INFORMATION:
- Owner: ${ownerName}
- Property Address: ${appeal.address}
- PIN: ${formatPin(appeal.pin)}
- Township: ${appeal.township}
- Assessment Year: ${appeal.assessment_year}
- Current Assessed Value: $${appeal.current_assessed_value?.toLocaleString()}
- Current Market Value (10x assessed): $${appeal.current_market_value?.toLocaleString()}
${subjectValuePerSqft ? `- Value Per Square Foot: $${subjectValuePerSqft}` : ''}

PROPOSED VALUES:
- Proposed Assessed Value: $${appeal.proposed_assessed_value?.toLocaleString()}
- Proposed Market Value: $${appeal.proposed_market_value?.toLocaleString()}
- Requested Reduction: $${(appeal.current_assessed_value - appeal.proposed_assessed_value)?.toLocaleString()}

APPEAL GROUNDS:
${groundsText || 'Comparable sales analysis shows property is overvalued'}

COMPARABLE PROPERTIES:
${formattedComparables.length > 0 ? formattedComparables.map(c => `
${c.number}. ${c.address} (PIN: ${c.pin})
   - Assessed Value: $${c.assessedValue?.toLocaleString()}
   - Square Footage: ${c.squareFootage?.toLocaleString()} sq ft
   - Year Built: ${c.yearBuilt}
   - Value/Sq Ft: ${c.valuePerSqft}
   ${c.recentSale ? `- Recent Sale: ${c.recentSale}` : ''}
`).join('') : 'No comparables available'}

${avgCompValue ? `AVERAGE COMPARABLE VALUE: $${Math.round(avgCompValue).toLocaleString()}` : ''}

${additionalContext ? `ADDITIONAL INFORMATION FROM OWNER:\n${additionalContext}` : ''}

INSTRUCTIONS:
1. Write a formal letter addressed to the Cook County Board of Review
2. Clearly state the property PIN, address, and assessment year being appealed
3. Present a compelling case using the comparable properties as evidence
4. Reference specific data points (assessed values, square footage, year built, value per square foot)
5. Request a specific reduction amount based on the comparable analysis
6. Be professional, factual, and persuasive
7. Keep the letter to 1-2 pages
8. Do NOT include placeholder brackets - use the actual data provided
9. End with a formal closing

Format the letter properly with date, addresses, salutation, body paragraphs, and closing.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the letter text
    const letterText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    // Convert to HTML for display
    const letterHtml = convertToHtml(letterText);

    // Update the appeal with the generated letter
    await supabase
      .from('property_tax_appeals')
      .update({
        appeal_letter: letterText,
        appeal_letter_html: letterHtml,
        appeal_letter_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', appealId);

    return res.status(200).json({
      success: true,
      letter: letterText,
      letterHtml,
      comparablesUsed: formattedComparables.length,
      appealId
    });

  } catch (error) {
    console.error('Generate letter error:', error);

    if (error instanceof Error && error.message.includes('rate_limit')) {
      return res.status(429).json({
        error: 'Service is busy. Please try again in a moment.'
      });
    }

    return res.status(500).json({
      error: 'An error occurred while generating the letter. Please try again.'
    });
  }
}

/**
 * Convert plain text letter to HTML for display
 */
function convertToHtml(text: string): string {
  // Escape HTML entities
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert line breaks to paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map(p => {
      // Keep single line breaks within paragraphs
      const lines = p.split('\n');
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('\n');

  // Wrap in a container with styling
  return `
    <div class="appeal-letter" style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; max-width: 8.5in; margin: 0 auto; padding: 1in;">
      ${html}
    </div>
  `;
}

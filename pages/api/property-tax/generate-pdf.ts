/**
 * Generate Property Tax Appeal PDF
 *
 * Creates a Board of Review-ready PDF packet including:
 * - Appeal cover letter
 * - Comparable properties table
 * - Property characteristics comparison
 * - Supporting evidence summary
 *
 * POST /api/property-tax/generate-pdf
 * Body: { appealId: string }
 * Response: PDF file stream
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to generate PDF' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in to generate PDF' });
    }

    const appealId = req.method === 'GET' ? req.query.appealId : req.body.appealId;

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

    // Require payment before generating PDF
    if (appeal.status !== 'paid' && appeal.status !== 'letter_generated') {
      return res.status(402).json({
        error: 'Payment required',
        message: 'Please complete payment to generate your appeal PDF.',
        requiresPayment: true
      });
    }

    // Require letter to be generated first
    if (!appeal.appeal_letter) {
      return res.status(400).json({
        error: 'Letter not generated',
        message: 'Please generate your appeal letter first.'
      });
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

    const ownerName = profile?.first_name && profile?.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : 'Property Owner';

    // Create PDF document
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: `Property Tax Appeal - ${formatPin(appeal.pin)}`,
        Author: 'Ticketless Chicago',
        Subject: `Appeal for ${appeal.address}`,
        Keywords: 'property tax, appeal, Cook County',
      }
    });

    // Set response headers for PDF download
    const filename = `Appeal_${formatPin(appeal.pin).replace(/-/g, '')}_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe the PDF to the response
    doc.pipe(res);

    // === PAGE 1: COVER LETTER ===
    generateCoverLetter(doc, appeal, ownerName);

    // === PAGE 2: COMPARABLE PROPERTIES TABLE ===
    doc.addPage();
    generateComparablesTable(doc, appeal, comparables || []);

    // === PAGE 3: PROPERTY COMPARISON SUMMARY ===
    doc.addPage();
    generateComparisonSummary(doc, appeal, comparables || []);

    // Finalize the PDF
    doc.end();

  } catch (error) {
    console.error('Generate PDF error:', error);
    return res.status(500).json({
      error: 'An error occurred while generating the PDF. Please try again.'
    });
  }
}

/**
 * Generate the cover letter page
 */
function generateCoverLetter(doc: PDFKit.PDFDocument, appeal: any, ownerName: string) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Header
  doc.fontSize(11)
    .text(today, { align: 'right' })
    .moveDown(2);

  // Recipient
  doc.text('Cook County Board of Review')
    .text('118 N. Clark Street, Room 601')
    .text('Chicago, IL 60602')
    .moveDown(2);

  // Subject line
  doc.font('Helvetica-Bold')
    .text(`Re: Appeal of Property Tax Assessment`)
    .font('Helvetica')
    .text(`PIN: ${formatPin(appeal.pin)}`)
    .text(`Property Address: ${appeal.address}`)
    .text(`Township: ${appeal.township}`)
    .text(`Assessment Year: ${appeal.assessment_year}`)
    .moveDown(2);

  // Salutation
  doc.text('Dear Members of the Board of Review:')
    .moveDown();

  // Letter body - use the generated letter
  if (appeal.appeal_letter) {
    // Parse out just the body of the letter (skip headers if any)
    let letterBody = appeal.appeal_letter;

    // Remove any date/address headers from the AI-generated letter
    const bodyStart = letterBody.indexOf('Dear');
    if (bodyStart > 0) {
      letterBody = letterBody.substring(bodyStart);
    }

    // Remove the salutation since we added our own
    letterBody = letterBody.replace(/^Dear.*?[,:]\s*/i, '');

    // Add the letter content
    doc.fontSize(11)
      .text(letterBody, {
        align: 'justify',
        lineGap: 4
      });
  } else {
    // Fallback if no letter exists
    doc.text(`I am writing to appeal the ${appeal.assessment_year} property tax assessment for the above-referenced property. ` +
      `The current assessed value of $${appeal.current_assessed_value?.toLocaleString()} is excessive when compared to similar properties in the same assessment neighborhood.`)
      .moveDown()
      .text(`Based on comparable sales and assessment data, I am requesting a reduction to $${appeal.proposed_assessed_value?.toLocaleString()}, ` +
        `which would result in a fair market value of $${appeal.proposed_market_value?.toLocaleString()}.`)
      .moveDown()
      .text('Please see the attached comparable properties analysis for supporting evidence.')
      .moveDown(2);
  }

  // Closing
  doc.moveDown(2)
    .text('Respectfully submitted,')
    .moveDown(3)
    .text(ownerName)
    .text('Property Owner');

  // Footer
  doc.fontSize(9)
    .text('Prepared with Ticketless Chicago Property Tax Appeal Service', 72, 700, {
      align: 'center',
      opacity: 0.5
    });
}

/**
 * Generate the comparable properties table
 */
function generateComparablesTable(doc: PDFKit.PDFDocument, appeal: any, comparables: any[]) {
  // Title
  doc.fontSize(16)
    .font('Helvetica-Bold')
    .text('Comparable Properties Analysis', { align: 'center' })
    .moveDown(0.5);

  doc.fontSize(11)
    .font('Helvetica')
    .text(`Subject Property: ${appeal.address} (PIN: ${formatPin(appeal.pin)})`, { align: 'center' })
    .moveDown(2);

  // Subject property box
  doc.font('Helvetica-Bold')
    .fontSize(12)
    .text('Subject Property')
    .moveDown(0.5);

  const subjectData = [
    ['Address:', appeal.address],
    ['PIN:', formatPin(appeal.pin)],
    ['Township:', appeal.township],
    ['Current Assessed Value:', `$${appeal.current_assessed_value?.toLocaleString()}`],
    ['Proposed Assessed Value:', `$${appeal.proposed_assessed_value?.toLocaleString()}`],
    ['Requested Reduction:', `$${(appeal.current_assessed_value - appeal.proposed_assessed_value)?.toLocaleString()}`],
  ];

  doc.font('Helvetica').fontSize(10);
  for (const [label, value] of subjectData) {
    doc.text(`${label} ${value}`);
  }

  doc.moveDown(2);

  // Comparables header
  doc.font('Helvetica-Bold')
    .fontSize(12)
    .text('Comparable Properties')
    .moveDown(0.5);

  if (comparables.length === 0) {
    doc.font('Helvetica')
      .fontSize(10)
      .text('No comparable properties available.');
    return;
  }

  // Table header
  const tableTop = doc.y;
  const colWidths = [30, 140, 80, 60, 50, 60, 60];
  const headers = ['#', 'Address', 'PIN', 'Sq Ft', 'Year', 'Assessed', '$/Sq Ft'];

  doc.font('Helvetica-Bold').fontSize(9);

  let x = 72;
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i], align: i >= 3 ? 'right' : 'left' });
    x += colWidths[i];
  });

  // Draw header line
  doc.moveTo(72, tableTop + 15)
    .lineTo(540, tableTop + 15)
    .stroke();

  // Table rows
  doc.font('Helvetica').fontSize(9);
  let y = tableTop + 20;

  comparables.forEach((comp, index) => {
    x = 72;
    const rowData = [
      String(index + 1),
      comp.comp_address?.substring(0, 25) || 'N/A',
      formatPin(comp.comp_pin),
      comp.comp_square_footage?.toLocaleString() || 'N/A',
      String(comp.comp_year_built || 'N/A'),
      `$${comp.comp_assessed_value?.toLocaleString() || 'N/A'}`,
      comp.value_per_sqft ? `$${comp.value_per_sqft.toFixed(0)}` : 'N/A'
    ];

    rowData.forEach((cell, i) => {
      doc.text(cell, x, y, { width: colWidths[i], align: i >= 3 ? 'right' : 'left' });
      x += colWidths[i];
    });

    y += 18;

    // Add page break if needed
    if (y > 680) {
      doc.addPage();
      y = 72;
    }
  });

  // Draw bottom line
  doc.moveTo(72, y)
    .lineTo(540, y)
    .stroke();

  // Summary statistics
  doc.moveDown(2);

  const avgAssessed = comparables.reduce((sum, c) => sum + (c.comp_assessed_value || 0), 0) / comparables.length;
  const avgPerSqft = comparables.reduce((sum, c) => sum + (c.value_per_sqft || 0), 0) / comparables.length;

  doc.font('Helvetica-Bold').fontSize(10)
    .text('Summary Statistics:')
    .font('Helvetica')
    .text(`Average Comparable Assessed Value: $${Math.round(avgAssessed).toLocaleString()}`)
    .text(`Average Value per Square Foot: $${avgPerSqft.toFixed(2)}`)
    .text(`Subject Property Assessed Value: $${appeal.current_assessed_value?.toLocaleString()}`);

  const overvaluation = appeal.current_assessed_value - avgAssessed;
  if (overvaluation > 0) {
    doc.font('Helvetica-Bold')
      .fillColor('red')
      .text(`Subject Property Overvalued By: $${Math.round(overvaluation).toLocaleString()}`)
      .fillColor('black');
  }
}

/**
 * Generate comparison summary page
 */
function generateComparisonSummary(doc: PDFKit.PDFDocument, appeal: any, comparables: any[]) {
  // Title
  doc.fontSize(16)
    .font('Helvetica-Bold')
    .text('Assessment Uniformity Analysis', { align: 'center' })
    .moveDown(2);

  // Introduction
  doc.fontSize(11)
    .font('Helvetica')
    .text('This analysis demonstrates that the subject property is assessed at a higher rate than comparable properties in the same assessment neighborhood, warranting a reduction in assessed value.')
    .moveDown(2);

  // Key findings
  doc.font('Helvetica-Bold')
    .fontSize(12)
    .text('Key Findings:')
    .moveDown(0.5);

  const findings: string[] = [];

  // Calculate statistics
  if (comparables.length > 0) {
    const avgPerSqft = comparables.reduce((sum, c) => sum + (c.value_per_sqft || 0), 0) / comparables.length;
    const medianAssessed = comparables.map(c => c.comp_assessed_value || 0).sort((a, b) => a - b)[Math.floor(comparables.length / 2)];

    const opportunityAnalysis = appeal.opportunity_analysis || {};
    const subjectSqft = opportunityAnalysis.squareFootage || 1;
    const subjectPerSqft = appeal.current_assessed_value / subjectSqft;

    findings.push(`The subject property is assessed at $${subjectPerSqft.toFixed(2)} per square foot.`);
    findings.push(`The average comparable property is assessed at $${avgPerSqft.toFixed(2)} per square foot.`);

    if (subjectPerSqft > avgPerSqft) {
      const percentHigher = ((subjectPerSqft - avgPerSqft) / avgPerSqft * 100).toFixed(1);
      findings.push(`The subject property is assessed ${percentHigher}% higher than comparable properties.`);
    }

    findings.push(`Based on comparable assessments, the fair assessed value would be approximately $${appeal.proposed_assessed_value?.toLocaleString()}.`);

    if (appeal.estimated_tax_savings > 0) {
      findings.push(`If reduced, the estimated annual tax savings would be approximately $${Math.round(appeal.estimated_tax_savings).toLocaleString()}.`);
    }
  }

  doc.font('Helvetica').fontSize(11);
  findings.forEach((finding, i) => {
    doc.text(`${i + 1}. ${finding}`);
    doc.moveDown(0.5);
  });

  // Appeal grounds
  doc.moveDown()
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Grounds for Appeal:')
    .moveDown(0.5);

  const groundsDescriptions: Record<string, string> = {
    'value_per_sqft': 'Property is assessed at a higher rate per square foot than comparable properties',
    'comparable_sales': 'Comparable properties have lower assessed values',
    'lower_assessed_comps': 'Multiple comparable properties are assessed significantly lower',
    'equity_disparity': 'Assessment is not uniform with similarly situated properties',
    'excessive_increase': 'Assessment increased more than comparable properties',
    'dramatic_increase': 'Assessment increased dramatically (40%+) from prior year',
    'market_sales': 'Recent sales data supports a lower valuation',
    'historical_overassessment': 'Property has been persistently overassessed'
  };

  const appealGrounds = appeal.appeal_grounds || [];
  doc.font('Helvetica').fontSize(11);

  appealGrounds.forEach((ground: string) => {
    const description = groundsDescriptions[ground] || ground;
    doc.text(`• ${description}`);
  });

  // Closing statement
  doc.moveDown(2)
    .font('Helvetica-Bold')
    .text('Conclusion:')
    .font('Helvetica')
    .moveDown(0.5)
    .text(`Based on the foregoing analysis, the subject property at ${appeal.address} is overassessed relative to comparable properties. ` +
      `I respectfully request that the Board of Review reduce the assessed value from $${appeal.current_assessed_value?.toLocaleString()} ` +
      `to $${appeal.proposed_assessed_value?.toLocaleString()} to ensure uniformity with similarly situated properties.`);

  // Footer
  doc.fontSize(9)
    .text('Prepared with Ticketless Chicago Property Tax Appeal Service', 72, 700, {
      align: 'center',
      opacity: 0.5
    });
}

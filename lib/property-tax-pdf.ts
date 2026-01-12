/**
 * Property Tax Appeal PDF Packet Generator
 *
 * Generates a professional, board-ready PDF packet for property tax appeals
 * including:
 * 1. Cover Letter (neutral legal tone)
 * 2. Executive Summary (strategy, target value, savings, rationale)
 * 3. Evidence: Comparable table + audit notes
 * 4. Charts: Subject vs distribution, assessment history
 * 5. Appendices
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import {
  PropertyTaxAnalysisResult,
  ComparableAuditItem
} from './property-tax-analysis';
import {
  NormalizedProperty,
  ComparableProperty,
  formatPin
} from './cook-county-api';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface AppealPDFData {
  /** Property owner name */
  ownerName: string;
  /** Property owner address (for return address) */
  ownerAddress?: string;
  /** Email */
  email?: string;
  /** Phone */
  phone?: string;
  /** Analysis result */
  analysis: PropertyTaxAnalysisResult;
  /** Assessment history for charts */
  assessmentHistory?: { year: number; assessedValue: number }[];
  /** Township filing deadline */
  filingDeadline?: string;
  /** Case number if already assigned */
  caseNumber?: string;
}

export interface PDFGenerationResult {
  /** Base64 encoded PDF */
  pdfBase64: string;
  /** PDF byte array */
  pdfBytes: Uint8Array;
  /** Page count */
  pageCount: number;
  /** Filename */
  filename: string;
}

// =============================================================================
// PDF GENERATION
// =============================================================================

const COLORS = {
  primary: rgb(0.12, 0.29, 0.49), // Navy blue
  secondary: rgb(0.4, 0.4, 0.4),  // Gray
  accent: rgb(0.05, 0.47, 0.31),  // Green
  danger: rgb(0.8, 0.2, 0.2),     // Red
  light: rgb(0.95, 0.95, 0.95),   // Light gray
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
};

const FONTS = {
  title: 18,
  heading: 14,
  subheading: 12,
  body: 10,
  small: 8,
};

const MARGINS = {
  top: 72,
  bottom: 72,
  left: 72,
  right: 72,
};

/**
 * Helper to draw wrapped text
 */
function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
  lineHeight: number = 1.3
): number {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (const word of words) {
    const testLine = line + (line ? ' ' : '') + word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && line) {
      page.drawText(line, { x, y: currentY, size: fontSize, font, color: COLORS.black });
      currentY -= fontSize * lineHeight;
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) {
    page.drawText(line, { x, y: currentY, size: fontSize, font, color: COLORS.black });
    currentY -= fontSize * lineHeight;
  }

  return currentY;
}

/**
 * Generate the appeal PDF packet
 */
export async function generateAppealPDF(data: AppealPDFData): Promise<PDFGenerationResult> {
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesRomanBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { analysis } = data;
  const subject = analysis.rawData.subject;
  const strategy = analysis.strategyDecision;

  const pageWidth = 612; // Letter size
  const pageHeight = 792;
  const contentWidth = pageWidth - MARGINS.left - MARGINS.right;

  // =========================================================================
  // PAGE 1: COVER LETTER
  // =========================================================================
  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - MARGINS.top;

  // Date
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  coverPage.drawText(today, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  y -= 40;

  // Recipient
  const recipient = [
    'Cook County Board of Review',
    '118 N. Clark Street, Room 601',
    'Chicago, IL 60602'
  ];
  for (const line of recipient) {
    coverPage.drawText(line, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: timesRoman,
    });
    y -= 14;
  }
  y -= 20;

  // Subject line
  coverPage.drawText('RE: Property Tax Assessment Appeal', {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRomanBold,
  });
  y -= 14;
  coverPage.drawText(`PIN: ${subject.pinFormatted}`, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  y -= 14;
  coverPage.drawText(`Property: ${subject.address}`, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  y -= 14;
  coverPage.drawText(`Township: ${subject.township}`, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  if (data.filingDeadline) {
    y -= 14;
    coverPage.drawText(`Filing Deadline: ${data.filingDeadline}`, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: timesRoman,
    });
  }
  y -= 30;

  // Salutation
  coverPage.drawText('Dear Members of the Board of Review:', {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  y -= 24;

  // Body paragraphs
  const currentValue = subject.assessedValue?.toLocaleString() || 'N/A';
  const targetValue = strategy.targetAssessedValue.toLocaleString();
  const reduction = ((subject.assessedValue || 0) - strategy.targetAssessedValue).toLocaleString();
  const savings = strategy.estimatedSavings.toLocaleString();

  const paragraph1 = `I am writing to formally appeal the assessed value of the above-referenced property for tax year ${subject.assessmentYear}. The current assessed value of $${currentValue} exceeds the fair market value and/or is not uniform with similarly situated properties in the area.`;

  y = drawWrappedText(coverPage, paragraph1, MARGINS.left, y, timesRoman, FONTS.body, contentWidth);
  y -= 12;

  // Case-specific paragraph
  let caseDescription: string;
  if (strategy.strategy === 'file_both') {
    caseDescription = `This appeal is based on both market value and uniformity grounds. Analysis of ${analysis.rawData.comparables.length} comparable properties and ${analysis.rawData.sales.length} recent sales demonstrates that the current assessment significantly exceeds both market value and the assessments of similar properties.`;
  } else if (strategy.strategy === 'file_mv') {
    caseDescription = `This appeal is based on market value evidence. Analysis of recent sales data for comparable properties indicates that the current assessment exceeds the fair market value of this property.`;
  } else {
    caseDescription = `This appeal is based on uniformity/equity grounds. Analysis of ${analysis.rawData.comparables.length} comparable properties demonstrates that this property is assessed at a higher rate than similar properties in the area, violating the uniformity requirement.`;
  }

  y = drawWrappedText(coverPage, caseDescription, MARGINS.left, y, timesRoman, FONTS.body, contentWidth);
  y -= 12;

  const paragraph3 = `Based on the evidence presented in this packet, I respectfully request that the assessed value be reduced from $${currentValue} to $${targetValue}, a reduction of $${reduction}. This would result in estimated annual tax savings of approximately $${savings}.`;

  y = drawWrappedText(coverPage, paragraph3, MARGINS.left, y, timesRoman, FONTS.body, contentWidth);
  y -= 12;

  const paragraph4 = 'The enclosed documentation includes: (1) an executive summary of the appeal basis, (2) a comparable properties analysis with supporting data, and (3) relevant charts and evidence supporting this request.';

  y = drawWrappedText(coverPage, paragraph4, MARGINS.left, y, timesRoman, FONTS.body, contentWidth);
  y -= 12;

  const paragraph5 = 'Thank you for your consideration of this appeal. Please contact me if additional information is required.';

  y = drawWrappedText(coverPage, paragraph5, MARGINS.left, y, timesRoman, FONTS.body, contentWidth);
  y -= 30;

  // Signature
  coverPage.drawText('Respectfully submitted,', {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  y -= 40;
  coverPage.drawText(data.ownerName || '[Property Owner]', {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: timesRoman,
  });
  if (data.phone) {
    y -= 14;
    coverPage.drawText(data.phone, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: timesRoman,
    });
  }
  if (data.email) {
    y -= 14;
    coverPage.drawText(data.email, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: timesRoman,
    });
  }

  // Footer
  coverPage.drawText('Page 1', {
    x: pageWidth / 2 - 15,
    y: MARGINS.bottom - 20,
    size: FONTS.small,
    font: helvetica,
    color: COLORS.secondary,
  });

  // =========================================================================
  // PAGE 2: EXECUTIVE SUMMARY
  // =========================================================================
  const summaryPage = pdfDoc.addPage([pageWidth, pageHeight]);
  y = pageHeight - MARGINS.top;

  // Header
  summaryPage.drawText('EXECUTIVE SUMMARY', {
    x: MARGINS.left,
    y,
    size: FONTS.title,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 8;
  summaryPage.drawLine({
    start: { x: MARGINS.left, y },
    end: { x: pageWidth - MARGINS.right, y },
    thickness: 2,
    color: COLORS.primary,
  });
  y -= 30;

  // Property Information Box
  summaryPage.drawRectangle({
    x: MARGINS.left,
    y: y - 80,
    width: contentWidth,
    height: 85,
    color: COLORS.light,
    borderColor: COLORS.secondary,
    borderWidth: 0.5,
  });

  summaryPage.drawText('SUBJECT PROPERTY', {
    x: MARGINS.left + 10,
    y: y - 15,
    size: FONTS.subheading,
    font: helveticaBold,
    color: COLORS.primary,
  });

  const propertyInfo = [
    `PIN: ${subject.pinFormatted}`,
    `Address: ${subject.address}`,
    `Township: ${subject.township}`,
    `Property Class: ${subject.propertyClass} - ${subject.propertyClassDescription}`,
    `Year Built: ${subject.yearBuilt || 'N/A'} | Size: ${subject.squareFootage?.toLocaleString() || 'N/A'} sq ft | Beds: ${subject.bedrooms || 'N/A'} | Baths: ${subject.bathrooms || 'N/A'}`,
  ];

  let infoY = y - 30;
  for (const info of propertyInfo) {
    summaryPage.drawText(info, {
      x: MARGINS.left + 10,
      y: infoY,
      size: FONTS.body,
      font: helvetica,
    });
    infoY -= 12;
  }

  y -= 100;

  // Appeal Strategy Box
  const strategyText = strategy.strategy === 'file_both' ? 'DUAL: MARKET VALUE + UNIFORMITY'
    : strategy.strategy === 'file_mv' ? 'MARKET VALUE'
    : strategy.strategy === 'file_uni' ? 'UNIFORMITY/EQUITY' : 'N/A';

  summaryPage.drawText('APPEAL STRATEGY', {
    x: MARGINS.left,
    y,
    size: FONTS.heading,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 18;
  summaryPage.drawText(strategyText, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: helveticaBold,
    color: COLORS.accent,
  });
  y -= 24;

  // Key Figures
  const figures = [
    { label: 'Current Assessed Value:', value: `$${currentValue}` },
    { label: 'Requested Assessed Value:', value: `$${targetValue}` },
    { label: 'Requested Reduction:', value: `$${reduction}` },
    { label: 'Estimated Annual Tax Savings:', value: `$${savings}` },
    { label: 'Confidence Level:', value: `${Math.round(strategy.overallConfidence * 100)}%` },
  ];

  for (const fig of figures) {
    summaryPage.drawText(fig.label, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: helvetica,
    });
    summaryPage.drawText(fig.value, {
      x: MARGINS.left + 200,
      y,
      size: FONTS.body,
      font: helveticaBold,
    });
    y -= 16;
  }

  y -= 20;

  // Rationale Section
  summaryPage.drawText('BASIS FOR APPEAL', {
    x: MARGINS.left,
    y,
    size: FONTS.heading,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 20;

  // Market Value rationale
  if (strategy.strategy === 'file_mv' || strategy.strategy === 'file_both') {
    summaryPage.drawText('Market Value Evidence:', {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: helveticaBold,
    });
    y -= 14;
    for (const point of analysis.mvCase.rationale.slice(0, 4)) {
      summaryPage.drawText(`• ${point}`, {
        x: MARGINS.left + 10,
        y,
        size: FONTS.body,
        font: helvetica,
      });
      y -= 12;
    }
    y -= 8;
  }

  // Uniformity rationale
  if (strategy.strategy === 'file_uni' || strategy.strategy === 'file_both') {
    summaryPage.drawText('Uniformity Evidence:', {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: helveticaBold,
    });
    y -= 14;
    for (const point of analysis.uniCase.rationale.slice(0, 4)) {
      summaryPage.drawText(`• ${point}`, {
        x: MARGINS.left + 10,
        y,
        size: FONTS.body,
        font: helvetica,
      });
      y -= 12;
    }
  }

  // Risk Flags (if any)
  if (strategy.riskFlags.length > 0) {
    y -= 20;
    summaryPage.drawText('NOTES / CONSIDERATIONS', {
      x: MARGINS.left,
      y,
      size: FONTS.heading,
      font: helveticaBold,
      color: COLORS.danger,
    });
    y -= 16;
    for (const flag of strategy.riskFlags.slice(0, 3)) {
      summaryPage.drawText(`• ${flag}`, {
        x: MARGINS.left + 10,
        y,
        size: FONTS.body,
        font: helvetica,
        color: COLORS.danger,
      });
      y -= 12;
    }
  }

  // Footer
  summaryPage.drawText('Page 2', {
    x: pageWidth / 2 - 15,
    y: MARGINS.bottom - 20,
    size: FONTS.small,
    font: helvetica,
    color: COLORS.secondary,
  });

  // =========================================================================
  // PAGE 3: COMPARABLE PROPERTIES TABLE
  // =========================================================================
  const compsPage = pdfDoc.addPage([pageWidth, pageHeight]);
  y = pageHeight - MARGINS.top;

  compsPage.drawText('COMPARABLE PROPERTIES ANALYSIS', {
    x: MARGINS.left,
    y,
    size: FONTS.title,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 8;
  compsPage.drawLine({
    start: { x: MARGINS.left, y },
    end: { x: pageWidth - MARGINS.right, y },
    thickness: 2,
    color: COLORS.primary,
  });
  y -= 20;

  // Quality score
  compsPage.drawText(`Comparable Quality Score: ${analysis.comparableQuality.qualityScore}/100 (${analysis.comparableQuality.aggregateAssessment})`, {
    x: MARGINS.left,
    y,
    size: FONTS.body,
    font: helveticaBold,
  });
  y -= 20;

  // Table header
  const colWidths = [120, 50, 70, 70, 70, 50];
  const colHeaders = ['Address', 'Beds', 'Sq Ft', 'Assessed', '$/SqFt', 'Score'];
  let tableX = MARGINS.left;

  compsPage.drawRectangle({
    x: MARGINS.left - 2,
    y: y - 12,
    width: contentWidth + 4,
    height: 16,
    color: COLORS.primary,
  });

  for (let i = 0; i < colHeaders.length; i++) {
    compsPage.drawText(colHeaders[i], {
      x: tableX + 2,
      y: y - 8,
      size: FONTS.small,
      font: helveticaBold,
      color: COLORS.white,
    });
    tableX += colWidths[i];
  }
  y -= 16;

  // Table rows - Subject first
  const drawRow = (
    address: string,
    beds: string,
    sqft: string,
    assessed: string,
    perSqft: string,
    score: string,
    isSubject: boolean = false
  ) => {
    if (isSubject) {
      compsPage.drawRectangle({
        x: MARGINS.left - 2,
        y: y - 10,
        width: contentWidth + 4,
        height: 14,
        color: COLORS.light,
      });
    }

    tableX = MARGINS.left;
    const values = [address, beds, sqft, assessed, perSqft, score];
    for (let i = 0; i < values.length; i++) {
      const text = values[i].length > 18 ? values[i].substring(0, 16) + '...' : values[i];
      compsPage.drawText(text, {
        x: tableX + 2,
        y: y - 8,
        size: FONTS.small,
        font: isSubject ? helveticaBold : helvetica,
      });
      tableX += colWidths[i];
    }
    y -= 14;
  };

  // Subject row
  const subjectPerSqft = subject.squareFootage && subject.assessedValue
    ? (subject.assessedValue / subject.squareFootage).toFixed(2)
    : 'N/A';

  drawRow(
    'SUBJECT: ' + (subject.address.split(',')[0] || subject.address).substring(0, 20),
    subject.bedrooms?.toString() || '-',
    subject.squareFootage?.toLocaleString() || '-',
    '$' + (subject.assessedValue?.toLocaleString() || '-'),
    '$' + subjectPerSqft,
    '-',
    true
  );

  // Comparable rows
  const topComps = analysis.comparableQuality.comparableAudits
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 12);

  for (const audit of topComps) {
    const comp = analysis.rawData.comparables.find(c => c.pin === audit.pin);
    if (!comp) continue;

    const compPerSqft = comp.squareFootage && comp.assessedValue
      ? (comp.assessedValue / comp.squareFootage).toFixed(2)
      : 'N/A';

    drawRow(
      (comp.address.split(',')[0] || comp.address).substring(0, 22),
      comp.bedrooms?.toString() || '-',
      comp.squareFootage?.toLocaleString() || '-',
      '$' + (comp.assessedValue?.toLocaleString() || '-'),
      '$' + compPerSqft,
      audit.qualityScore.toString()
    );

    if (y < MARGINS.bottom + 100) break;
  }

  // Footer
  compsPage.drawText('Page 3', {
    x: pageWidth / 2 - 15,
    y: MARGINS.bottom - 20,
    size: FONTS.small,
    font: helvetica,
    color: COLORS.secondary,
  });

  // =========================================================================
  // PAGE 4: COMPARABLE AUDIT DETAILS
  // =========================================================================
  const auditPage = pdfDoc.addPage([pageWidth, pageHeight]);
  y = pageHeight - MARGINS.top;

  auditPage.drawText('COMPARABLE SELECTION METHODOLOGY', {
    x: MARGINS.left,
    y,
    size: FONTS.title,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 8;
  auditPage.drawLine({
    start: { x: MARGINS.left, y },
    end: { x: pageWidth - MARGINS.right, y },
    thickness: 2,
    color: COLORS.primary,
  });
  y -= 24;

  // Scoring methodology explanation
  const methodologyText = 'Comparable properties were scored based on: proximity to subject (0-20 pts), ' +
    'same neighborhood/building bonus (0-25 pts), size similarity (0-15 pt penalty), ' +
    'bedroom match (0-10 pt penalty), sale recency (0-15 pt penalty), and data completeness (0-15 pt penalty).';

  y = drawWrappedText(auditPage, methodologyText, MARGINS.left, y, helvetica, FONTS.body, contentWidth);
  y -= 20;

  // Top 5 comparables with detailed audit
  auditPage.drawText('TOP COMPARABLE DETAILS:', {
    x: MARGINS.left,
    y,
    size: FONTS.heading,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 20;

  for (const audit of topComps.slice(0, 5)) {
    if (y < MARGINS.bottom + 120) break;

    auditPage.drawText(`${audit.pinFormatted} - ${audit.address.substring(0, 40)}`, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: helveticaBold,
    });
    auditPage.drawText(`Quality: ${audit.qualityScore}/100`, {
      x: pageWidth - MARGINS.right - 80,
      y,
      size: FONTS.body,
      font: helveticaBold,
      color: audit.qualityScore >= 70 ? COLORS.accent : COLORS.secondary,
    });
    y -= 14;

    // Why included
    for (const reason of audit.whyIncluded.slice(0, 2)) {
      auditPage.drawText(`+ ${reason}`, {
        x: MARGINS.left + 10,
        y,
        size: FONTS.small,
        font: helvetica,
        color: COLORS.accent,
      });
      y -= 10;
    }

    // Penalties
    for (const penalty of audit.penaltiesApplied.slice(0, 2)) {
      auditPage.drawText(`- ${penalty.reason} (-${penalty.points} pts)`, {
        x: MARGINS.left + 10,
        y,
        size: FONTS.small,
        font: helvetica,
        color: COLORS.danger,
      });
      y -= 10;
    }

    y -= 10;
  }

  // Footer
  auditPage.drawText('Page 4', {
    x: pageWidth / 2 - 15,
    y: MARGINS.bottom - 20,
    size: FONTS.small,
    font: helvetica,
    color: COLORS.secondary,
  });

  // =========================================================================
  // PAGE 5: STATISTICAL ANALYSIS
  // =========================================================================
  const statsPage = pdfDoc.addPage([pageWidth, pageHeight]);
  y = pageHeight - MARGINS.top;

  statsPage.drawText('STATISTICAL ANALYSIS', {
    x: MARGINS.left,
    y,
    size: FONTS.title,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 8;
  statsPage.drawLine({
    start: { x: MARGINS.left, y },
    end: { x: pageWidth - MARGINS.right, y },
    thickness: 2,
    color: COLORS.primary,
  });
  y -= 30;

  // Uniformity metrics
  statsPage.drawText('UNIFORMITY METRICS', {
    x: MARGINS.left,
    y,
    size: FONTS.heading,
    font: helveticaBold,
    color: COLORS.primary,
  });
  y -= 20;

  const uniData = analysis.uniCase.supportingData;
  const uniformityStats = [
    { label: 'Comparable Pool Size:', value: uniData.comparablePoolSize.toString() },
    { label: 'Subject Percentile Rank:', value: `${uniData.currentPercentileRank}th (100 = highest assessed)` },
    { label: 'Properties Assessed Lower:', value: `${uniData.propertiesAssessedLower} of ${uniData.comparablePoolSize}` },
    { label: 'Coefficient of Dispersion:', value: `${uniData.coefficientOfDispersion.toFixed(1)}%` },
    { label: 'Subject $/sq ft:', value: `$${uniData.subjectValuePerSqft.toFixed(2)}` },
    { label: 'Median $/sq ft:', value: `$${uniData.medianValuePerSqft.toFixed(2)}` },
    { label: 'Difference:', value: `$${(uniData.subjectValuePerSqft - uniData.medianValuePerSqft).toFixed(2)} (${((uniData.subjectValuePerSqft / uniData.medianValuePerSqft - 1) * 100).toFixed(1)}% above median)` },
  ];

  for (const stat of uniformityStats) {
    statsPage.drawText(stat.label, {
      x: MARGINS.left,
      y,
      size: FONTS.body,
      font: helvetica,
    });
    statsPage.drawText(stat.value, {
      x: MARGINS.left + 180,
      y,
      size: FONTS.body,
      font: helveticaBold,
    });
    y -= 16;
  }

  y -= 20;

  // Market Value metrics (if applicable)
  if (analysis.mvCase.supportingData.salesCount > 0) {
    statsPage.drawText('MARKET VALUE METRICS', {
      x: MARGINS.left,
      y,
      size: FONTS.heading,
      font: helveticaBold,
      color: COLORS.primary,
    });
    y -= 20;

    const mvData = analysis.mvCase.supportingData;
    const mvStats = [
      { label: 'Comparable Sales Analyzed:', value: mvData.salesCount.toString() },
      { label: 'Median Sale Price:', value: mvData.medianSalePrice ? `$${mvData.medianSalePrice.toLocaleString()}` : 'N/A' },
      { label: 'Median Sale $/sq ft:', value: mvData.medianSalePricePerSqft ? `$${mvData.medianSalePricePerSqft.toFixed(2)}` : 'N/A' },
      { label: 'Implied Market Value:', value: mvData.impliedMarketValue ? `$${mvData.impliedMarketValue.toLocaleString()}` : 'N/A' },
      { label: 'Assessment Level:', value: mvData.assessmentLevel ? `${(mvData.assessmentLevel * 100).toFixed(1)}% (target: 10%)` : 'N/A' },
    ];

    for (const stat of mvStats) {
      statsPage.drawText(stat.label, {
        x: MARGINS.left,
        y,
        size: FONTS.body,
        font: helvetica,
      });
      statsPage.drawText(stat.value, {
        x: MARGINS.left + 180,
        y,
        size: FONTS.body,
        font: helveticaBold,
      });
      y -= 16;
    }
  }

  // Assessment History (if provided)
  if (data.assessmentHistory && data.assessmentHistory.length > 0) {
    y -= 30;
    statsPage.drawText('ASSESSMENT HISTORY', {
      x: MARGINS.left,
      y,
      size: FONTS.heading,
      font: helveticaBold,
      color: COLORS.primary,
    });
    y -= 20;

    for (const hist of data.assessmentHistory.slice(-5)) {
      statsPage.drawText(`${hist.year}:`, {
        x: MARGINS.left,
        y,
        size: FONTS.body,
        font: helvetica,
      });
      statsPage.drawText(`$${hist.assessedValue.toLocaleString()}`, {
        x: MARGINS.left + 60,
        y,
        size: FONTS.body,
        font: helveticaBold,
      });
      y -= 14;
    }
  }

  // Footer
  statsPage.drawText('Page 5', {
    x: pageWidth / 2 - 15,
    y: MARGINS.bottom - 20,
    size: FONTS.small,
    font: helvetica,
    color: COLORS.secondary,
  });

  // =========================================================================
  // FINALIZE
  // =========================================================================
  const pdfBytes = await pdfDoc.save();

  // Generate filename
  const pin = subject.pin.replace(/\D/g, '');
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const filename = `PropertyTaxAppeal_${pin}_${date}.pdf`;

  return {
    pdfBase64: Buffer.from(pdfBytes).toString('base64'),
    pdfBytes,
    pageCount: pdfDoc.getPageCount(),
    filename
  };
}

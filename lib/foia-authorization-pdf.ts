/**
 * FOIA Authorization PDF Generator
 *
 * Generates a professional PDF of the signed FOIA authorization for a given request.
 * Used for:
 * 1. Attaching to the FOIA email sent to the City of Chicago
 * 2. User's own records (viewable via /api/foia/authorization-pdf)
 * 3. Audit trail / legal compliance
 *
 * Uses pdf-lib (already a project dependency) for zero-external-dependency PDF generation.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

export interface FoiaAuthorizationData {
  id: string;
  name: string;
  email: string;
  licensePlate: string;
  licenseState: string;
  signatureName: string;
  signatureAgreedText: string | null;
  consentGivenAt: string | null;
  createdAt: string;
  consentIp: string | null;
  signatureUserAgent: string | null;
  consentElectronicProcess: boolean;
}

const COLORS = {
  black: rgb(0.1, 0.1, 0.11),
  darkGray: rgb(0.27, 0.33, 0.39),
  medGray: rgb(0.39, 0.45, 0.53),
  lightGray: rgb(0.58, 0.64, 0.71),
  bgGray: rgb(0.94, 0.96, 0.97),
  border: rgb(0.89, 0.91, 0.93),
  white: rgb(1, 1, 1),
};

/**
 * Generate a PDF Buffer for the FOIA authorization document.
 */
export async function generateFoiaAuthorizationPdf(data: FoiaAuthorizationData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const page = doc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();
  const margin = 60;
  let y = height - margin;

  // ── Header ──
  y = drawCenteredText(page, 'Scarlet Carson, Inc', y, helveticaBold, 18, COLORS.black);
  y -= 4;
  y = drawCenteredText(page, 'd/b/a Autopilot America', y, helvetica, 11, COLORS.medGray);
  y -= 2;
  y = drawCenteredText(page, 'Chicago, Illinois', y, helvetica, 11, COLORS.medGray);
  y -= 16;

  // Divider
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1.5, color: COLORS.border });
  y -= 24;

  // ── Document title ──
  y = drawCenteredText(page, 'LIMITED AUTHORIZATION FOR FOIA REQUEST', y, helveticaBold, 14, COLORS.black);
  y -= 28;

  // ── Info table ──
  const labelX = margin + 8;
  const valueX = margin + 130;
  const infoFields: [string, string][] = [
    ['Full Name:', data.name],
    ['Email:', data.email],
    ['License Plate:', `${data.licenseState} ${data.licensePlate}`],
    ['Request ID:', data.id],
  ];

  // Background box
  const boxHeight = infoFields.length * 20 + 16;
  page.drawRectangle({
    x: margin,
    y: y - boxHeight + 4,
    width: width - 2 * margin,
    height: boxHeight,
    color: COLORS.bgGray,
    borderColor: COLORS.border,
    borderWidth: 0.5,
  });

  y -= 6;
  for (const [label, value] of infoFields) {
    page.drawText(label, { x: labelX, y, size: 10, font: helveticaBold, color: COLORS.medGray });
    page.drawText(value, { x: valueX, y, size: 10, font: helvetica, color: COLORS.black });
    y -= 20;
  }
  y -= 18;

  // ── Authorization text ──
  const authText = data.signatureAgreedText || 'Authorization text not recorded.';
  const wrappedAuth = wrapText(authText, helvetica, 10, width - 2 * margin - 24);

  const authBoxHeight = wrappedAuth.length * 16 + 24;
  page.drawRectangle({
    x: margin,
    y: y - authBoxHeight + 8,
    width: width - 2 * margin,
    height: authBoxHeight,
    color: rgb(0.99, 0.99, 0.99),
    borderColor: COLORS.border,
    borderWidth: 0.5,
  });

  y -= 8;
  for (const line of wrappedAuth) {
    page.drawText(line, { x: margin + 12, y, size: 10, font: helvetica, color: COLORS.darkGray, lineHeight: 16 });
    y -= 16;
  }
  y -= 24;

  // ── Signature block ──
  const signedDate = new Date(data.consentGivenAt || data.createdAt);
  const formattedDate = formatDate(signedDate);
  const formattedTime = formatTime(signedDate);

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: COLORS.border });
  y -= 24;

  // Signature
  page.drawText('SIGNATURE:', { x: labelX, y, size: 9, font: helveticaBold, color: COLORS.medGray });
  page.drawText(data.signatureName, { x: valueX, y: y - 2, size: 22, font: helveticaOblique, color: COLORS.black });
  y -= 14;
  page.drawLine({ start: { x: valueX, y }, end: { x: width - margin, y }, thickness: 0.5, color: COLORS.black });
  y -= 22;

  // Date
  page.drawText('DATE:', { x: labelX, y, size: 9, font: helveticaBold, color: COLORS.medGray });
  page.drawText(formattedDate, { x: valueX, y, size: 11, font: helvetica, color: COLORS.black });
  y -= 14;
  page.drawLine({ start: { x: valueX, y }, end: { x: width - margin, y }, thickness: 0.5, color: COLORS.black });
  y -= 22;

  // Printed name
  page.drawText('PRINTED NAME:', { x: labelX, y, size: 9, font: helveticaBold, color: COLORS.medGray });
  page.drawText(data.name, { x: valueX, y, size: 11, font: helvetica, color: COLORS.black });
  y -= 14;
  page.drawLine({ start: { x: valueX, y }, end: { x: width - margin, y }, thickness: 0.5, color: COLORS.black });
  y -= 30;

  // ── Audit trail ──
  const auditBoxTop = y + 8;
  const auditEntries: [string, string][] = [
    ['Signed at:', `${formattedDate} at ${formattedTime}`],
    ['IP Address:', data.consentIp || 'Not recorded'],
    ['User Agent:', truncate(data.signatureUserAgent || 'Not recorded', 80)],
    ['Electronic Consent:', data.consentElectronicProcess ? 'Yes' : 'Not recorded'],
    ['Legal Basis:', 'Federal ESIGN Act (15 U.S.C. \u00A7 7001); Illinois UETA (815 ILCS 334)'],
  ];

  const auditBoxHeight = auditEntries.length * 14 + 30;
  page.drawRectangle({
    x: margin,
    y: y - auditBoxHeight + 14,
    width: width - 2 * margin,
    height: auditBoxHeight,
    color: COLORS.bgGray,
  });

  page.drawText('ELECTRONIC SIGNATURE AUDIT TRAIL', { x: labelX, y, size: 8, font: helveticaBold, color: COLORS.medGray });
  y -= 16;

  for (const [label, value] of auditEntries) {
    page.drawText(label, { x: labelX, y, size: 8, font: helveticaBold, color: COLORS.medGray });
    page.drawText(value, { x: margin + 110, y, size: 8, font: helvetica, color: COLORS.medGray });
    y -= 14;
  }
  y -= 18;

  // ── Legal footer ──
  const footer1 = 'This document was electronically signed via Autopilot America (autopilotamerica.com).';
  const footer2 = 'Electronic signatures are legally valid under the Federal ESIGN Act and the Illinois Uniform Electronic Transactions Act.';
  y = drawCenteredText(page, footer1, y, helvetica, 8, COLORS.lightGray);
  y -= 4;
  y = drawCenteredText(page, footer2, y, helvetica, 8, COLORS.lightGray);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// ── Helpers ──

function drawCenteredText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>): number {
  const width = font.widthOfTextAtSize(text, size);
  const pageWidth = page.getSize().width;
  page.drawText(text, { x: (pageWidth - width) / 2, y, size, font, color });
  return y - size - 2;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

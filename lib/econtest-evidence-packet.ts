import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export interface EcontestFoiaExhibitInput {
  agencyLabel: string;
  attachmentUrls?: string[];
}

interface AttachmentPdf {
  label: string;
  pdfBuffer: Buffer;
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'packet';
}

async function renderHtmlToPdfBuffer(htmlContent: string): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function renderImageToPdfBuffer(imageBuffer: Buffer, mimeType: string, label: string): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 0.5in; }
            h1 { font-size: 16pt; margin: 0 0 0.25in 0; }
            .wrap { display: flex; justify-content: center; align-items: flex-start; }
            img { max-width: 100%; max-height: 9in; object-fit: contain; border: 1px solid #ccc; }
          </style>
        </head>
        <body>
          <h1>${label}</h1>
          <div class="wrap"><img src="${dataUri}" alt="${label}" /></div>
        </body>
      </html>
    `;
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function attachmentUrlToPdf(url: string, label: string): Promise<AttachmentPdf> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment (${response.status}) from ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = (response.headers.get('content-type') || '').toLowerCase();

  if (mimeType.includes('pdf') || url.toLowerCase().includes('.pdf')) {
    return { label, pdfBuffer: buffer };
  }

  if (mimeType.startsWith('image/')) {
    return {
      label,
      pdfBuffer: await renderImageToPdfBuffer(buffer, mimeType || 'image/png', label),
    };
  }

  throw new Error(`Unsupported FOIA attachment type "${mimeType || 'unknown'}" from ${url}`);
}

async function appendPdf(target: PDFDocument, sourceBuffer: Buffer): Promise<void> {
  const src = await PDFDocument.load(sourceBuffer);
  const copied = await target.copyPages(src, src.getPageIndices());
  copied.forEach(page => target.addPage(page));
}

export async function buildEcontestEvidencePacket(params: {
  ticketNumber: string;
  htmlContent: string;
  foiaExhibits?: EcontestFoiaExhibitInput[];
}): Promise<{ packetPath: string; attachmentCount: number; pageCount: number; byteSize: number }> {
  const { ticketNumber, htmlContent, foiaExhibits } = params;

  const basePdf = await renderHtmlToPdfBuffer(htmlContent);
  const finalPdf = await PDFDocument.create();
  await appendPdf(finalPdf, basePdf);

  let attachmentCount = 0;
  for (const exhibit of foiaExhibits || []) {
    const urls = Array.isArray(exhibit.attachmentUrls) ? exhibit.attachmentUrls : [];
    for (let i = 0; i < urls.length; i++) {
      const attachment = await attachmentUrlToPdf(urls[i], `${exhibit.agencyLabel} Attachment ${i + 1}`);
      await appendPdf(finalPdf, attachment.pdfBuffer);
      attachmentCount++;
    }
  }

  const pdfBytes = await finalPdf.save();
  const pageCount = finalPdf.getPageCount();
  const byteSize = pdfBytes.length;

  // Refuse to hand back a degenerate packet. A 0-page or near-empty PDF
  // would still upload "successfully" to the City and leave the customer
  // contesting with literally nothing in evidence — see the broader concern
  // about no-bad-runs that fail to attach the letter.
  if (pageCount < 1) {
    throw new Error(`Evidence packet for ${ticketNumber} has 0 pages — refusing to write`);
  }
  if (byteSize < 500) {
    throw new Error(`Evidence packet for ${ticketNumber} is only ${byteSize} bytes — refusing to write (too small to contain a real letter)`);
  }

  const dir = '/tmp/econtest-packets';
  await mkdir(dir, { recursive: true });
  const packetPath = path.join(
    dir,
    `${sanitizeFilenamePart(ticketNumber)}-${Date.now()}-econtest-packet.pdf`,
  );
  await writeFile(packetPath, Buffer.from(pdfBytes));

  return { packetPath, attachmentCount, pageCount, byteSize };
}

import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { letterContent, violationType, ticketNumber } = req.body;

  if (!letterContent) {
    return res.status(400).json({ error: 'Letter content is required' });
  }

  try {
    // Create PDF document
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: {
        top: 72,
        bottom: 72,
        left: 72,
        right: 72,
      },
    });

    // Collect PDF chunks
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // When PDF is done, send response
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="contest-letter-${violationType || 'sample'}-${ticketNumber || 'draft'}.pdf"`
      );
      res.send(pdfBuffer);
    });

    // Set font
    doc.font('Times-Roman');

    // Split content into lines and render
    const lines = letterContent.split('\n');
    let isFirstLine = true;

    for (const line of lines) {
      if (isFirstLine) {
        // Date - right aligned
        doc.fontSize(12).text(line, { align: 'left' });
        isFirstLine = false;
      } else if (line.startsWith('RE:') || line.startsWith('License Plate:') || line.startsWith('Violation Date:') || line.startsWith('Amount:')) {
        // RE block - bold
        doc.fontSize(12).font('Times-Bold').text(line, { align: 'left' });
        doc.font('Times-Roman');
      } else if (line === 'To Whom It May Concern:') {
        doc.moveDown(0.5);
        doc.fontSize(12).text(line, { align: 'left' });
        doc.moveDown(0.5);
      } else if (line === 'Sincerely,') {
        doc.moveDown(1);
        doc.fontSize(12).text(line, { align: 'left' });
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.fontSize(12).text(line, { align: 'left', lineGap: 2 });
      }
    }

    // End the document
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

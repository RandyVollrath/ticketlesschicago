import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import {
  SCORING_WEIGHTS,
  CHICAGO_AVERAGES,
  calculateCategoryScore,
  getLetterGrade,
  getGradeColor,
  getScoreDescription,
  type ReportData,
  type CategoryScore,
} from '../../../lib/neighborhood-scoring';

function calculateOverallScoreFromReport(data: ReportData): { overallScore: number; overallGrade: string; categoryScores: CategoryScore[] } {
  const categoryScores: CategoryScore[] = [
    calculateCategoryScore('crime', data.crime.total, SCORING_WEIGHTS.crime, CHICAGO_AVERAGES.crime),
    calculateCategoryScore('crashes', data.crashes.total, SCORING_WEIGHTS.crashes, CHICAGO_AVERAGES.crashes),
    calculateCategoryScore('violations', data.violations.total, SCORING_WEIGHTS.violations, CHICAGO_AVERAGES.violations),
    calculateCategoryScore('serviceRequests', data.serviceRequests.total, SCORING_WEIGHTS.serviceRequests, CHICAGO_AVERAGES.serviceRequests),
    calculateCategoryScore('cameras', data.cameras.total, SCORING_WEIGHTS.cameras, CHICAGO_AVERAGES.cameras),
    calculateCategoryScore('potholes', data.potholes.total, SCORING_WEIGHTS.potholes, CHICAGO_AVERAGES.potholes),
    calculateCategoryScore('permits', data.permits.total, SCORING_WEIGHTS.permits, CHICAGO_AVERAGES.permits),
    calculateCategoryScore('licenses', data.licenses.total, SCORING_WEIGHTS.licenses, CHICAGO_AVERAGES.licenses),
  ];

  const overallScore = Math.round(categoryScores.reduce((sum, cat) => sum + cat.weightedScore, 0));
  const overallGrade = getLetterGrade(overallScore);

  return { overallScore, overallGrade, categoryScores };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data: ReportData = req.body;

    if (!data.address || !data.latitude || !data.longitude) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { overallScore, overallGrade, categoryScores } = calculateOverallScoreFromReport(data);

    // Create PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Collect PDF chunks
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('Neighborhood Safety Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').fillColor('#666666')
       .text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.text('Powered by Autopilot America', { align: 'center' });

    doc.moveDown(1);

    // Address box
    doc.rect(50, doc.y, 512, 60).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.fillColor('#374151').fontSize(11).font('Helvetica-Bold')
       .text('Location:', 60, doc.y - 50);
    doc.font('Helvetica').fontSize(10)
       .text(data.address, 60, doc.y + 5, { width: 490 });
    doc.text(`Search Radius: ${data.radius === 0.1 ? '500 ft (~0.1 mi)' : `${data.radius.toFixed(1)} miles`}`, 60, doc.y + 5);

    doc.y += 30;
    doc.moveDown(1);

    // Overall Grade - Large display
    const gradeBoxY = doc.y;
    const gradeColor = getGradeColor(overallGrade);

    // Grade circle
    doc.circle(110, gradeBoxY + 50, 45).fillAndStroke(gradeColor, gradeColor);
    doc.fillColor('white').fontSize(48).font('Helvetica-Bold')
       .text(overallGrade, 85, gradeBoxY + 25, { width: 50, align: 'center' });

    // Score and description
    doc.fillColor('#1f2937').fontSize(20).font('Helvetica-Bold')
       .text(`Overall Score: ${overallScore}/100`, 180, gradeBoxY + 20);
    doc.fontSize(11).font('Helvetica').fillColor('#6b7280')
       .text(getScoreDescription(overallScore), 180, gradeBoxY + 50, { width: 350 });

    doc.y = gradeBoxY + 120;
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke('#e5e7eb');
    doc.moveDown(1);

    // Category Scores Section
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937')
       .text('Category Breakdown');
    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b7280');
    doc.text('Category', 50, tableTop, { width: 130 });
    doc.text('Weight', 180, tableTop, { width: 50 });
    doc.text('Value', 230, tableTop, { width: 60 });
    doc.text('Score', 290, tableTop, { width: 50 });
    doc.text('Grade', 340, tableTop, { width: 40 });
    doc.text('Impact', 380, tableTop, { width: 180 });

    doc.moveTo(50, tableTop + 15).lineTo(562, tableTop + 15).stroke('#e5e7eb');

    let rowY = tableTop + 25;

    // Sort: negative factors first (descending by impact), then positive
    const sortedScores = [...categoryScores].sort((a, b) => {
      if (a.isPositive !== b.isPositive) return a.isPositive ? 1 : -1;
      return b.weight - a.weight;
    });

    for (const cat of sortedScores) {
      const rowColor = cat.isPositive ? '#f0fdf4' : '#fef2f2';
      doc.rect(50, rowY - 5, 512, 22).fill(rowY % 2 === 0 ? rowColor : 'white');

      doc.fillColor('#374151').fontSize(9).font('Helvetica');
      doc.text(cat.label, 50, rowY, { width: 130 });
      doc.text(`${(cat.weight * 100).toFixed(1)}%`, 180, rowY, { width: 50 });
      doc.text(cat.rawValue.toString(), 230, rowY, { width: 60 });
      doc.text(`${cat.normalizedScore}/100`, 290, rowY, { width: 50 });

      // Grade with color
      doc.fillColor(getGradeColor(cat.grade)).font('Helvetica-Bold')
         .text(cat.grade, 340, rowY, { width: 40 });

      // Impact indicator
      const impactText = cat.isPositive
        ? (cat.normalizedScore >= 70 ? '+Positive' : 'Neutral')
        : (cat.normalizedScore >= 70 ? 'Low Risk' : cat.normalizedScore >= 50 ? 'Moderate' : 'High Risk');
      const impactColor = cat.normalizedScore >= 70 ? '#22c55e' : cat.normalizedScore >= 50 ? '#eab308' : '#ef4444';
      doc.fillColor(impactColor).font('Helvetica')
         .text(impactText, 380, rowY, { width: 180 });

      rowY += 22;
    }

    doc.y = rowY + 10;
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke('#e5e7eb');
    doc.moveDown(1);

    // Methodology Section
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1f2937')
       .text('Scoring Methodology');
    doc.moveDown(0.5);

    doc.fontSize(9).font('Helvetica').fillColor('#4b5563')
       .text('This report uses a weighted scoring system to evaluate neighborhood safety and livability. Each category is compared against Chicago-wide averages for a typical 0.1-mile radius area.', { width: 512 });
    doc.moveDown(0.5);

    // Weight breakdown
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151')
       .text('Category Weights:');
    doc.moveDown(0.3);

    doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
    const negativeFactors = sortedScores.filter(c => !c.isPositive);
    const positiveFactors = sortedScores.filter(c => c.isPositive);

    doc.text('Negative Factors (reduce score):', { continued: false });
    negativeFactors.forEach(c => {
      doc.text(`  - ${c.label}: ${(c.weight * 100).toFixed(1)}% - ${c.description}`, { indent: 10 });
    });

    doc.moveDown(0.3);
    doc.text('Positive Factors (boost score):');
    positiveFactors.forEach(c => {
      doc.text(`  - ${c.label}: ${(c.weight * 100).toFixed(1)}% - ${c.description}`, { indent: 10 });
    });

    doc.moveDown(0.5);

    // Grading scale
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151')
       .text('Grading Scale:');
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
       .text('A (90-100): Excellent | B (80-89): Good | C (70-79): Average | D (60-69): Below Average | F (0-59): Poor');

    doc.moveDown(1);

    // Data Details Section (if room)
    if (doc.y < 600) {
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke('#e5e7eb');
      doc.moveDown(1);

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1f2937')
         .text('Detailed Statistics');
      doc.moveDown(0.5);

      const statsY = doc.y;
      const colWidth = 250;

      // Left column
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151');
      doc.text('Crime (Last 12 months)', 50, statsY);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.crime.total} | Violent: ${data.crime.violent} | Property: ${data.crime.property}`, 50, doc.y);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('Traffic Crashes', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.crashes.total} | Injuries: ${data.crashes.injuries} | Fatal: ${data.crashes.fatal} | Hit & Run: ${data.crashes.hitAndRun}`, 50, doc.y);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('Building Violations', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.violations.total} | High Risk: ${data.violations.highRisk} | Open: ${data.violations.open}`, 50, doc.y);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('311 Service Requests', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.serviceRequests.total} | Recent (90 days): ${data.serviceRequests.recent}`, 50, doc.y);

      // Right column would go here if needed

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('Enforcement Cameras', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.cameras.total} | Speed: ${data.cameras.speed} | Red Light: ${data.cameras.redLight}`, 50, doc.y);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('Building Permits', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.permits.total} | Recent: ${data.permits.recent} | Value: $${(data.permits.cost / 1000000).toFixed(1)}M`, 50, doc.y);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fillColor('#374151').text('Business Licenses', 50, doc.y);
      doc.font('Helvetica').fillColor('#6b7280');
      doc.text(`  Total: ${data.licenses.total} | Active: ${data.licenses.active}`, 50, doc.y);
    }

    // Footer
    doc.fontSize(8).fillColor('#9ca3af')
       .text(
         'Data sourced from Chicago Data Portal. This report is for informational purposes only.',
         50,
         720,
         { align: 'center', width: 512 }
       );
    doc.text(
      'www.autopilotamerica.com',
      50,
      732,
      { align: 'center', width: 512 }
    );

    // Finalize PDF
    doc.end();

    // Wait for PDF to finish
    await new Promise<void>((resolve) => {
      doc.on('end', resolve);
    });

    const pdfBuffer = Buffer.concat(chunks);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="neighborhood-report-${Date.now()}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating report:', error);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
}

// Scoring utilities are imported from lib/neighborhood-scoring.ts

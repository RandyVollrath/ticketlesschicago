/**
 * Neighborhood Reality Report PDF Generator
 *
 * Generates a decision-grade PDF version of the neighborhood reality report.
 *
 * Usage:
 * GET /api/neighborhood-report-pdf?address=123+W+Main+St,+Chicago,+IL
 * GET /api/neighborhood-report-pdf?lat=41.8781&lng=-87.6298
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import {
  generateNeighborhoodRealityReport,
  NeighborhoodRealityReport,
} from '../../lib/neighborhood-reality-report';

interface GeocodeResponse {
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    formatted_address: string;
  }>;
  status: string;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const encodedAddress = encodeURIComponent(address);
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) return null;

    const data: GeocodeResponse = await response.json();
    if (data.status !== 'OK' || !data.results?.length) return null;

    const location = data.results[0].geometry.location;
    return { lat: location.lat, lng: location.lng };
  } catch {
    return null;
  }
}

// Colors
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  slate: '#64748B',
  danger: '#DC2626',
  warning: '#F59E0B',
  signal: '#10B981',
};

function getRiskColor(level: string): string {
  switch (level) {
    case 'low': return COLORS.signal;
    case 'moderate': return COLORS.warning;
    case 'elevated': return '#EA580C';
    case 'high': return COLORS.danger;
    default: return COLORS.slate;
  }
}

function getComparisonLabel(level: string): string {
  switch (level) {
    case 'unusually_high': return 'UNUSUALLY HIGH';
    case 'high': return 'HIGH';
    case 'average': return 'AVERAGE';
    case 'low': return 'LOW';
    case 'unusually_low': return 'UNUSUALLY LOW';
    default: return level.toUpperCase();
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let latitude: number | undefined;
    let longitude: number | undefined;

    // Parse coordinates
    if (req.query.lat && req.query.lng) {
      latitude = parseFloat(req.query.lat as string);
      longitude = parseFloat(req.query.lng as string);
      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }
    } else if (req.query.address) {
      const address = req.query.address as string;
      const chicagoAddress = address.toLowerCase().includes('chicago')
        ? address
        : `${address}, Chicago, IL`;
      const coords = await geocodeAddress(chicagoAddress);
      if (!coords) {
        return res.status(400).json({ error: 'Could not geocode address' });
      }
      latitude = coords.lat;
      longitude = coords.lng;
    } else {
      return res.status(400).json({ error: 'Missing address or coordinates' });
    }

    // Generate report
    const report = await generateNeighborhoodRealityReport(latitude, longitude);

    // Create PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Neighborhood Reality Report - ${report.location.address}`,
        Author: 'Ticketless Chicago',
        Subject: 'Address-level enforcement and risk analysis',
      },
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="neighborhood-report-${Date.now()}.pdf"`
    );

    // Pipe PDF to response
    doc.pipe(res);

    // ===== HEADER =====
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(24)
      .font('Helvetica-Bold')
      .text('Neighborhood Reality Report', { align: 'center' });

    doc
      .fontSize(10)
      .fillColor(COLORS.slate)
      .font('Helvetica')
      .text('Decision-grade address analysis', { align: 'center' });

    doc.moveDown(1.5);

    // ===== LOCATION =====
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(report.location.address);

    const locationParts: string[] = [];
    if (report.location.neighborhood) locationParts.push(`Neighborhood: ${report.location.neighborhood}`);
    if (report.location.ward) locationParts.push(`Ward: ${report.location.ward}`);

    if (locationParts.length > 0) {
      doc
        .fontSize(10)
        .fillColor(COLORS.slate)
        .font('Helvetica')
        .text(locationParts.join('  |  '));
    }

    doc.moveDown(1);

    // ===== OVERALL PROFILE BOX =====
    const boxTop = doc.y;
    const boxWidth = 500;
    const boxHeight = 80;

    // Draw box background
    doc.rect(50, boxTop, boxWidth, boxHeight).fill('#F8FAFC');
    doc.rect(50, boxTop, boxWidth, boxHeight).stroke('#E2E8F0');

    doc.y = boxTop + 12;

    doc
      .fillColor(COLORS.slate)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('AT A GLANCE', 60, doc.y);

    doc.y += 18;

    // Profile badges in a row
    const badgeY = doc.y;
    const badgeWidth = 100;

    // Risk Level
    doc
      .fillColor(COLORS.slate)
      .fontSize(8)
      .font('Helvetica')
      .text('Risk Level', 60, badgeY);
    doc
      .fillColor(getRiskColor(report.overallProfile.riskLevel))
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(report.overallProfile.riskLevel.toUpperCase(), 60, badgeY + 12);

    // Enforcement
    doc
      .fillColor(COLORS.slate)
      .fontSize(8)
      .font('Helvetica')
      .text('Enforcement', 160, badgeY);
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(report.overallProfile.enforcementIntensity.toUpperCase(), 160, badgeY + 12);

    // Friction
    doc
      .fillColor(COLORS.slate)
      .fontSize(8)
      .font('Helvetica')
      .text('Friction', 280, badgeY);
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(report.overallProfile.frictionLevel.toUpperCase(), 280, badgeY + 12);

    // Summary phrase
    doc.y = boxTop + boxHeight - 20;
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(report.overallProfile.summaryPhrase, 60);

    doc.y = boxTop + boxHeight + 16;

    // ===== MOST UNDERESTIMATED =====
    const insightBoxTop = doc.y;
    const insightBoxHeight = 50;

    doc.rect(50, insightBoxTop, boxWidth, insightBoxHeight).fill('#FFFBEB');
    doc.rect(50, insightBoxTop, boxWidth, insightBoxHeight).stroke('#FDE68A');

    doc.y = insightBoxTop + 10;
    doc
      .fillColor(COLORS.warning)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('WHAT PEOPLE UNDERESTIMATE', 60);

    doc.y += 4;
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(report.mostUnderestimated.finding, 60, doc.y, { width: boxWidth - 20 });

    doc.y = insightBoxTop + insightBoxHeight + 20;

    // ===== SECTION 1: ENFORCEMENT EXPOSURE =====
    addSectionHeader(doc, '1. Enforcement Exposure');

    doc.fontSize(10).font('Helvetica').fillColor('#333333');

    doc.text(`Speed Cameras (0.5 mi): ${report.enforcementExposure.speedCameras.count.HALF_MILE}`);
    if (report.enforcementExposure.speedCameras.closest) {
      doc.fontSize(9).fillColor(COLORS.slate)
        .text(`  Closest: ${report.enforcementExposure.speedCameras.closest.address}`, { indent: 10 });
    }

    doc.fontSize(10).fillColor('#333333')
      .text(`Red Light Cameras (0.5 mi): ${report.enforcementExposure.redLightCameras.count.HALF_MILE}`);

    if (report.enforcementExposure.cameraViolations.totalNearbyViolations > 0) {
      doc.text(`Total Nearby Violations: ${report.enforcementExposure.cameraViolations.totalNearbyViolations.toLocaleString()}`);
    }

    if (report.enforcementExposure.wardTicketClimate.wardRank) {
      doc.text(`Ward Ticket Rank: #${report.enforcementExposure.wardTicketClimate.wardRank}/50 (${getComparisonLabel(report.enforcementExposure.wardTicketClimate.vsCity)})`);
    }

    addKeyTakeaway(doc, report.enforcementExposure.keyTakeaway);

    // ===== SECTION 2: SAFETY & RISK =====
    addSectionHeader(doc, '2. Safety & Risk');

    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(`Violent Crimes (0.5 mi): ${report.safetyRisk.violentCrime.count} - ${getComparisonLabel(report.safetyRisk.violentCrime.comparison.vsCity)}`);

    if (report.safetyRisk.violentCrime.severityMix !== 'No data available') {
      doc.fontSize(9).fillColor(COLORS.slate).text(`  ${report.safetyRisk.violentCrime.severityMix}`, { indent: 10 });
    }

    doc.fontSize(10).fillColor('#333333')
      .text(`Nuisance Crimes (0.5 mi): ${report.safetyRisk.nuisanceCrime.count} - ${getComparisonLabel(report.safetyRisk.nuisanceCrime.comparison.vsCity)}`);

    doc.text(`Traffic Crashes (2 yrs): ${report.safetyRisk.trafficCrashes.total} (${report.safetyRisk.trafficCrashes.withInjuries} injuries, ${report.safetyRisk.trafficCrashes.fatal} fatal)`);

    addKeyTakeaway(doc, report.safetyRisk.keyTakeaway);

    // ===== SECTION 3: DAILY FRICTION =====
    addSectionHeader(doc, '3. Daily Friction');

    const restrictions = [
      { name: 'Street Cleaning', found: report.dailyFriction.streetCleaning.found },
      { name: 'Permit Zone', found: report.dailyFriction.permitZone.found, zone: report.dailyFriction.permitZone.zoneName },
      { name: 'Snow Route', found: report.dailyFriction.snowRoute.found },
      { name: 'Winter Overnight Ban', found: report.dailyFriction.winterBan.found },
    ];

    for (const r of restrictions) {
      const color = r.found ? COLORS.danger : COLORS.signal;
      const status = r.found ? 'YES' : 'NO';
      const extra = r.zone ? ` (${r.zone})` : '';

      doc.fontSize(10).font('Helvetica')
        .fillColor(COLORS.deepHarbor).text(`${r.name}: `, { continued: true })
        .fillColor(color).text(status + extra);
    }

    addKeyTakeaway(doc, report.dailyFriction.keyTakeaway);

    // Check if we need a new page
    if (doc.y > 600) {
      doc.addPage();
    }

    // ===== SECTION 4: QUALITY OF LIFE =====
    addSectionHeader(doc, '4. Quality-of-Life Volatility');

    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(`311 Complaints (Last Year): ${report.qualityOfLife.complaints311.totalLastYear.toLocaleString()} - ${getComparisonLabel(report.qualityOfLife.complaints311.comparison.vsCity)}`);

    if (report.qualityOfLife.volatilityPattern !== 'Insufficient data') {
      doc.fontSize(9).fillColor(COLORS.slate).text(`  ${report.qualityOfLife.volatilityPattern}`, { indent: 10 });
    }

    addKeyTakeaway(doc, report.qualityOfLife.keyTakeaway);

    // ===== SECTION 5: MOVEMENT =====
    addSectionHeader(doc, '5. Movement & Congestion');
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.slate).text(report.movementCongestion.keyTakeaway);

    // ===== SECTION 6: TRAJECTORY =====
    addSectionHeader(doc, '6. Trajectory');

    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(`Business Licenses (0.5 mi): ${report.trajectory.businessLicenses.count} - ${getComparisonLabel(report.trajectory.businessLicenses.comparison.vsCity)}`);

    doc.text(`Change Signal: ${report.trajectory.changeSignal.replace('_', ' ').toUpperCase()}`);

    addKeyTakeaway(doc, report.trajectory.keyTakeaway);

    // ===== WHO THIS IS FOR =====
    doc.moveDown(1);
    doc
      .fillColor(COLORS.deepHarbor)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Who This Location Is For');

    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.signal);
    doc.text('Good fit for: ', { continued: true })
      .fillColor('#333333').text(report.audienceFit.goodFitFor.join(', '));

    doc.fillColor(COLORS.danger);
    doc.text('Challenges for: ', { continued: true })
      .fillColor('#333333').text(report.audienceFit.poorFitFor.join(', '));

    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Oblique').fillColor(COLORS.slate)
      .text(report.audienceFit.summary);

    // ===== FOOTER =====
    const bottomY = doc.page.height - 80;
    doc.y = bottomY;

    doc
      .fontSize(8)
      .fillColor(COLORS.slate)
      .font('Helvetica')
      .text(
        `Generated by Ticketless Chicago on ${new Date(report.generatedAt).toLocaleString()}`,
        { align: 'center' }
      );

    doc.text(
      'Data sources: Chicago Data Portal, City of Chicago FOIA records',
      { align: 'center' }
    );

    doc.text(
      'ticketlesschicago.com',
      { align: 'center', link: 'https://ticketlesschicago.com' }
    );

    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
}

function addSectionHeader(doc: typeof PDFDocument.prototype, title: string) {
  doc.moveDown(0.8);
  doc
    .fillColor(COLORS.deepHarbor)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(title);
  doc.moveDown(0.3);
}

function addKeyTakeaway(doc: typeof PDFDocument.prototype, takeaway: string) {
  doc.moveDown(0.3);
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor(COLORS.regulatory)
    .text('Key Takeaway: ', { continued: true })
    .font('Helvetica')
    .fillColor('#333333')
    .text(takeaway);
}

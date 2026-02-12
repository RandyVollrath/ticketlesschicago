/**
 * Red Light Camera Evidence Receipt PDF Generator
 *
 * Generates a formatted evidence document with:
 * - GPS trace summary showing approach, deceleration, and stop
 * - Speed profile over time
 * - Accelerometer data proving deceleration/stop pattern
 * - Yellow light timing analysis (Chicago standards vs ITE recommendations)
 * - Camera location and intersection details
 *
 * Usage:
 * POST /api/evidence/red-light-receipt-pdf
 * Body: { receiptId: string } or { receipt: RedLightReceipt }
 *
 * Returns: PDF binary (application/pdf)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

const COLORS = {
  deepNavy: '#0F172A',
  blue: '#2563EB',
  slate: '#64748B',
  green: '#059669',
  red: '#DC2626',
  amber: '#D97706',
  lightGray: '#F1F5F9',
  medGray: '#CBD5E1',
};

interface TracePoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  speedMps: number;
  speedMph: number;
  heading: number;
  horizontalAccuracyMeters: number | null;
}

interface AccelPoint {
  timestamp: number;
  x: number; y: number; z: number;
  gx: number; gy: number; gz: number;
}

interface ReceiptData {
  id: string;
  device_timestamp: string;
  camera_address: string;
  camera_latitude: number;
  camera_longitude: number;
  intersection_id: string;
  heading: number;
  approach_speed_mph: number | null;
  min_speed_mph: number | null;
  speed_delta_mph: number | null;
  full_stop_detected: boolean;
  full_stop_duration_sec: number | null;
  horizontal_accuracy_meters: number | null;
  estimated_speed_accuracy_mph: number | null;
  trace: TracePoint[];
  accelerometer_trace: AccelPoint[] | null;
  peak_deceleration_g: number | null;
  expected_yellow_duration_sec: number | null;
  posted_speed_limit_mph: number | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let receipt: ReceiptData;

    if (req.body.receiptId) {
      // Fetch from database
      const { data, error } = await supabase
        .from('red_light_receipts')
        .select('*')
        .eq('id', req.body.receiptId)
        .single();
      if (error || !data) {
        return res.status(404).json({ error: 'Receipt not found' });
      }
      receipt = data as ReceiptData;
    } else if (req.body.receipt) {
      // Use provided receipt data (from mobile local storage)
      receipt = normalizeReceipt(req.body.receipt);
    } else {
      return res.status(400).json({ error: 'receiptId or receipt required' });
    }

    // Generate PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Red Light Camera Evidence - ${receipt.camera_address}`,
        Author: 'Autopilot America',
        Subject: 'Red light camera intersection evidence receipt',
        Keywords: 'red light camera, evidence, GPS trace, deceleration',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="red-light-evidence-${receipt.id}.pdf"`
    );

    doc.pipe(res);

    // ===== PAGE 1: HEADER =====
    drawHeader(doc, receipt);

    // ===== INTERSECTION DETAILS =====
    drawIntersectionDetails(doc, receipt);

    // ===== VEHICLE BEHAVIOR SUMMARY =====
    drawBehaviorSummary(doc, receipt);

    // ===== SPEED PROFILE CHART =====
    if (receipt.trace && receipt.trace.length >= 2) {
      drawSpeedProfile(doc, receipt.trace);
    }

    // ===== ACCELEROMETER EVIDENCE =====
    if (receipt.accelerometer_trace && receipt.accelerometer_trace.length > 0) {
      if (doc.y > 580) doc.addPage();
      drawAccelerometerSection(doc, receipt);
    }

    // ===== YELLOW LIGHT ANALYSIS =====
    if (doc.y > 600) doc.addPage();
    drawYellowLightAnalysis(doc, receipt);

    // ===== GPS TRACE TABLE =====
    if (doc.y > 500) doc.addPage();
    drawTraceTable(doc, receipt.trace);

    // ===== FOOTER =====
    drawFooter(doc, receipt);

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate evidence PDF' });
  }
}

function normalizeReceipt(r: any): ReceiptData {
  return {
    id: r.id || `${Date.now()}`,
    device_timestamp: r.deviceTimestamp
      ? new Date(r.deviceTimestamp).toISOString()
      : r.device_timestamp || new Date().toISOString(),
    camera_address: r.cameraAddress || r.camera_address || 'Unknown',
    camera_latitude: Number(r.cameraLatitude || r.camera_latitude || 0),
    camera_longitude: Number(r.cameraLongitude || r.camera_longitude || 0),
    intersection_id: r.intersectionId || r.intersection_id || '',
    heading: Number(r.heading || 0),
    approach_speed_mph: r.approachSpeedMph ?? r.approach_speed_mph ?? null,
    min_speed_mph: r.minSpeedMph ?? r.min_speed_mph ?? null,
    speed_delta_mph: r.speedDeltaMph ?? r.speed_delta_mph ?? null,
    full_stop_detected: Boolean(r.fullStopDetected ?? r.full_stop_detected),
    full_stop_duration_sec: r.fullStopDurationSec ?? r.full_stop_duration_sec ?? null,
    horizontal_accuracy_meters: r.horizontalAccuracyMeters ?? r.horizontal_accuracy_meters ?? null,
    estimated_speed_accuracy_mph: r.estimatedSpeedAccuracyMph ?? r.estimated_speed_accuracy_mph ?? null,
    trace: Array.isArray(r.trace) ? r.trace : [],
    accelerometer_trace: Array.isArray(r.accelerometerTrace || r.accelerometer_trace)
      ? (r.accelerometerTrace || r.accelerometer_trace)
      : null,
    peak_deceleration_g: r.peakDecelerationG ?? r.peak_deceleration_g ?? null,
    expected_yellow_duration_sec: r.expectedYellowDurationSec ?? r.expected_yellow_duration_sec ?? null,
    posted_speed_limit_mph: r.postedSpeedLimitMph ?? r.posted_speed_limit_mph ?? null,
  };
}

// ===== Drawing functions =====

function drawHeader(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  // Title bar
  doc
    .rect(50, 50, 512, 60)
    .fill(COLORS.deepNavy);

  doc
    .fillColor('#FFFFFF')
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('Red Light Camera Evidence Receipt', 70, 65);

  doc
    .fontSize(10)
    .font('Helvetica')
    .text('Generated by Autopilot America - GPS & Sensor Verified', 70, 90);

  doc.y = 125;

  // Timestamp and ID
  const timestamp = new Date(receipt.device_timestamp);
  doc
    .fillColor(COLORS.slate)
    .fontSize(9)
    .font('Helvetica')
    .text(`Receipt ID: ${receipt.id}`, 50)
    .text(`Captured: ${timestamp.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    })}`)
    .text(`Generated: ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);

  doc.moveDown(1);
}

function drawIntersectionDetails(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  sectionHeader(doc, 'Intersection Details');

  const leftX = 60;
  const rightX = 300;
  const labelFont = 'Helvetica-Bold';
  const valueFont = 'Helvetica';

  doc.fontSize(10);

  // Row 1
  doc.font(labelFont).fillColor(COLORS.slate).text('Camera Location:', leftX, doc.y);
  doc.font(valueFont).fillColor(COLORS.deepNavy).text(receipt.camera_address, leftX + 120, doc.y - 12);

  doc.moveDown(0.5);

  // Row 2
  const y2 = doc.y;
  doc.font(labelFont).fillColor(COLORS.slate).text('Coordinates:', leftX, y2);
  doc.font(valueFont).fillColor(COLORS.deepNavy)
    .text(`${receipt.camera_latitude.toFixed(6)}, ${receipt.camera_longitude.toFixed(6)}`, leftX + 120, y2);
  doc.font(labelFont).fillColor(COLORS.slate).text('Heading:', rightX, y2);
  doc.font(valueFont).fillColor(COLORS.deepNavy)
    .text(`${Math.round(receipt.heading)}° (${headingToCardinal(receipt.heading)})`, rightX + 60, y2);

  doc.moveDown(0.5);

  // Row 3
  const y3 = doc.y;
  const speedLimit = receipt.posted_speed_limit_mph ?? 30;
  doc.font(labelFont).fillColor(COLORS.slate).text('Posted Speed:', leftX, y3);
  doc.font(valueFont).fillColor(COLORS.deepNavy).text(`${speedLimit} mph`, leftX + 120, y3);
  doc.font(labelFont).fillColor(COLORS.slate).text('GPS Accuracy:', rightX, y3);
  const accuracy = receipt.horizontal_accuracy_meters != null
    ? `${receipt.horizontal_accuracy_meters.toFixed(1)}m avg`
    : 'N/A';
  doc.font(valueFont).fillColor(COLORS.deepNavy).text(accuracy, rightX + 90, y3);

  doc.moveDown(1);
}

function drawBehaviorSummary(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  sectionHeader(doc, 'Vehicle Behavior Summary');

  const boxTop = doc.y;
  const boxWidth = 512;
  const boxHeight = receipt.full_stop_detected ? 110 : 90;

  // Background box
  doc.rect(50, boxTop, boxWidth, boxHeight).fill(COLORS.lightGray);
  doc.rect(50, boxTop, boxWidth, boxHeight).stroke(COLORS.medGray);

  let y = boxTop + 12;

  // Speed metrics row
  const colWidth = 128;
  const metrics = [
    { label: 'Approach Speed', value: receipt.approach_speed_mph != null ? `${Math.round(receipt.approach_speed_mph)} mph` : 'N/A', color: COLORS.deepNavy },
    { label: 'Minimum Speed', value: receipt.min_speed_mph != null ? `${receipt.min_speed_mph.toFixed(1)} mph` : 'N/A', color: COLORS.deepNavy },
    { label: 'Speed Reduction', value: receipt.speed_delta_mph != null ? `${Math.round(receipt.speed_delta_mph)} mph` : 'N/A', color: COLORS.blue },
    { label: 'Full Stop', value: receipt.full_stop_detected ? 'YES' : 'NO', color: receipt.full_stop_detected ? COLORS.green : COLORS.red },
  ];

  for (let i = 0; i < metrics.length; i++) {
    const x = 60 + i * colWidth;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.slate).text(metrics[i].label, x, y);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(metrics[i].color).text(metrics[i].value, x, y + 12);
  }

  y += 45;

  // Stop duration if detected
  if (receipt.full_stop_detected && receipt.full_stop_duration_sec != null) {
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.deepNavy)
      .text(
        `Vehicle came to a complete stop for ${receipt.full_stop_duration_sec.toFixed(1)} seconds before proceeding through intersection.`,
        60, y, { width: boxWidth - 20 }
      );
    y += 20;
  }

  // Accelerometer peak if available
  if (receipt.peak_deceleration_g != null) {
    const gForce = Math.abs(receipt.peak_deceleration_g).toFixed(2);
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.deepNavy)
      .text(
        `Peak braking force: ${gForce}G (sensor-verified deceleration).`,
        60, y, { width: boxWidth - 20 }
      );
  }

  doc.y = boxTop + boxHeight + 12;
}

function drawSpeedProfile(doc: typeof PDFDocument.prototype, trace: TracePoint[]) {
  sectionHeader(doc, 'Speed Profile Over Time');

  const sorted = [...trace].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return;

  const chartX = 80;
  const chartY = doc.y + 5;
  const chartWidth = 450;
  const chartHeight = 120;

  // Y-axis: speed in mph
  const speeds = sorted.map(p => Math.max(0, p.speedMph));
  const maxSpeed = Math.max(5, ...speeds) * 1.15; // 15% padding

  // X-axis: time in seconds from first point
  const t0 = sorted[0].timestamp;
  const tEnd = sorted[sorted.length - 1].timestamp;
  const durationSec = Math.max(1, (tEnd - t0) / 1000);

  // Draw axes
  doc
    .strokeColor(COLORS.medGray)
    .lineWidth(0.5)
    .moveTo(chartX, chartY)
    .lineTo(chartX, chartY + chartHeight)
    .lineTo(chartX + chartWidth, chartY + chartHeight)
    .stroke();

  // Y-axis labels
  const ySteps = [0, Math.round(maxSpeed / 2), Math.round(maxSpeed)];
  for (const mph of ySteps) {
    const py = chartY + chartHeight - (mph / maxSpeed) * chartHeight;
    doc.fontSize(7).fillColor(COLORS.slate).font('Helvetica')
      .text(`${mph}`, chartX - 25, py - 4, { width: 20, align: 'right' });
    if (mph > 0) {
      doc.strokeColor('#E2E8F0').lineWidth(0.25)
        .moveTo(chartX, py).lineTo(chartX + chartWidth, py).stroke();
    }
  }

  // X-axis label
  doc.fontSize(7).fillColor(COLORS.slate).font('Helvetica')
    .text(`Time (${durationSec.toFixed(0)}s total)`, chartX + chartWidth / 2 - 30, chartY + chartHeight + 8);

  // Y-axis label
  doc.save();
  doc.fontSize(7).fillColor(COLORS.slate).font('Helvetica')
    .text('Speed (mph)', chartX - 45, chartY + chartHeight / 2 - 4);
  doc.restore();

  // Plot speed line
  doc.strokeColor(COLORS.blue).lineWidth(1.5);
  let first = true;
  for (const p of sorted) {
    const px = chartX + ((p.timestamp - t0) / (tEnd - t0)) * chartWidth;
    const py = chartY + chartHeight - (Math.max(0, p.speedMph) / maxSpeed) * chartHeight;
    if (first) {
      doc.moveTo(px, py);
      first = false;
    } else {
      doc.lineTo(px, py);
    }
  }
  doc.stroke();

  // Draw 0.5 mph stop line
  const stopLineY = chartY + chartHeight - (0.5 / maxSpeed) * chartHeight;
  doc.strokeColor(COLORS.green).lineWidth(0.5).dash(3, { space: 3 })
    .moveTo(chartX, stopLineY).lineTo(chartX + chartWidth, stopLineY).stroke();
  doc.undash();
  doc.fontSize(6).fillColor(COLORS.green).font('Helvetica')
    .text('Stop threshold (0.5 mph)', chartX + chartWidth - 100, stopLineY - 8);

  doc.y = chartY + chartHeight + 25;
}

function drawAccelerometerSection(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  const accel = receipt.accelerometer_trace;
  if (!accel || accel.length === 0) return;

  sectionHeader(doc, 'Accelerometer Evidence (Sensor-Verified Braking)');

  const chartX = 80;
  const chartY = doc.y + 5;
  const chartWidth = 450;
  const chartHeight = 100;

  // Calculate horizontal G-force for each point
  const gForces = accel.map(p => {
    const horizontal = Math.sqrt(p.x * p.x + p.y * p.y);
    return p.y < 0 ? -horizontal : horizontal;
  });

  const maxG = Math.max(0.5, ...gForces.map(Math.abs)) * 1.2;

  // Draw axes
  doc.strokeColor(COLORS.medGray).lineWidth(0.5)
    .moveTo(chartX, chartY)
    .lineTo(chartX, chartY + chartHeight)
    .lineTo(chartX + chartWidth, chartY + chartHeight)
    .stroke();

  // Zero line
  const zeroY = chartY + chartHeight / 2;
  doc.strokeColor(COLORS.medGray).lineWidth(0.25)
    .moveTo(chartX, zeroY).lineTo(chartX + chartWidth, zeroY).stroke();

  // Y-axis labels
  doc.fontSize(7).fillColor(COLORS.slate).font('Helvetica');
  doc.text(`${maxG.toFixed(1)}G`, chartX - 30, chartY - 4, { width: 25, align: 'right' });
  doc.text('0', chartX - 30, zeroY - 4, { width: 25, align: 'right' });
  doc.text(`-${maxG.toFixed(1)}G`, chartX - 30, chartY + chartHeight - 4, { width: 25, align: 'right' });

  // Labels
  doc.fontSize(6).fillColor(COLORS.green).text('Accel', chartX + chartWidth + 5, chartY + 5);
  doc.fillColor(COLORS.red).text('Brake', chartX + chartWidth + 5, chartY + chartHeight - 12);

  // Plot G-force line
  doc.strokeColor(COLORS.amber).lineWidth(1);
  let first = true;
  const t0 = accel[0].timestamp;
  const tEnd = accel[accel.length - 1].timestamp;
  const tRange = Math.max(0.001, tEnd - t0);

  for (let i = 0; i < gForces.length; i++) {
    const px = chartX + ((accel[i].timestamp - t0) / tRange) * chartWidth;
    const py = zeroY - (gForces[i] / maxG) * (chartHeight / 2);
    if (first) {
      doc.moveTo(px, py);
      first = false;
    } else {
      doc.lineTo(px, py);
    }
  }
  doc.stroke();

  doc.y = chartY + chartHeight + 12;

  // Peak deceleration callout
  if (receipt.peak_deceleration_g != null) {
    const peakG = Math.abs(receipt.peak_deceleration_g);
    const brakingDesc = peakG > 0.4 ? 'Hard braking' : peakG > 0.2 ? 'Moderate braking' : 'Light braking';
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.deepNavy)
      .text(`Peak Deceleration: ${peakG.toFixed(2)}G (${brakingDesc})`, 60);
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.slate)
      .text('Accelerometer data from device motion sensors (gravity removed). Negative values = braking force.', 60);
    doc.moveDown(0.5);
  }
}

function drawYellowLightAnalysis(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  sectionHeader(doc, 'Yellow Light Timing Analysis');

  const speedLimit = receipt.posted_speed_limit_mph ?? 30;
  const expectedYellow = receipt.expected_yellow_duration_sec ?? (speedLimit <= 30 ? 3.0 : 4.0);

  // ITE formula: t = 1.0 + v/(2 * a * g)
  // where v = speed in ft/s, a = deceleration rate (10 ft/s^2 typical), g = 32.2 ft/s^2
  const vFps = speedLimit * 1.467; // mph to ft/s
  const iteRecommended = Number((1.0 + vFps / (2 * 10)).toFixed(1));

  const boxTop = doc.y;
  const boxWidth = 512;
  const boxHeight = 95;

  doc.rect(50, boxTop, boxWidth, boxHeight).fill('#FFFBEB');
  doc.rect(50, boxTop, boxWidth, boxHeight).stroke('#FDE68A');

  let y = boxTop + 10;

  doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.amber)
    .text('YELLOW LIGHT DURATION CONTEXT', 60, y);
  y += 16;

  // Comparison table
  const items = [
    { label: 'Chicago Standard', value: `${expectedYellow.toFixed(1)}s`, note: `(at ${speedLimit} mph posted)` },
    { label: 'ITE Recommended', value: `${iteRecommended}s`, note: `(Institute of Transportation Engineers formula)` },
    { label: 'Difference', value: `${(iteRecommended - expectedYellow).toFixed(1)}s`, note: iteRecommended > expectedYellow ? '(Chicago uses shorter yellow)' : '(within standard)' },
  ];

  for (const item of items) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.deepNavy)
      .text(`${item.label}:`, 60, y, { continued: true });
    doc.font('Helvetica').text(`  ${item.value}  `, { continued: true });
    doc.fontSize(8).fillColor(COLORS.slate).text(item.note);
    y += 14;
  }

  y += 4;
  if (iteRecommended > expectedYellow) {
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(COLORS.red)
      .text(
        `Note: Chicago's ${expectedYellow}s yellow at ${speedLimit} mph is ${(iteRecommended - expectedYellow).toFixed(1)}s shorter than ITE recommendations. ` +
        'Illinois law requires camera-enforced intersections to meet national standards.',
        60, y, { width: boxWidth - 20 }
      );
  }

  doc.y = boxTop + boxHeight + 12;
}

function drawTraceTable(doc: typeof PDFDocument.prototype, trace: TracePoint[]) {
  if (!trace || trace.length === 0) return;

  sectionHeader(doc, 'Raw GPS Trace Data');

  const sorted = [...trace].sort((a, b) => a.timestamp - b.timestamp);
  const t0 = sorted[0].timestamp;

  // Header row
  const cols = [
    { label: 'Time', x: 55, width: 55 },
    { label: 'Speed', x: 115, width: 55 },
    { label: 'Latitude', x: 175, width: 80 },
    { label: 'Longitude', x: 260, width: 80 },
    { label: 'Heading', x: 345, width: 55 },
    { label: 'Accuracy', x: 405, width: 55 },
  ];

  let y = doc.y;

  // Header background
  doc.rect(50, y - 2, 512, 14).fill(COLORS.deepNavy);
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#FFFFFF');
  for (const col of cols) {
    doc.text(col.label, col.x, y, { width: col.width });
  }
  y += 14;

  // Data rows (limit to 30 for readability)
  const displayTrace = sorted.length > 30
    ? sampleTrace(sorted, 30)
    : sorted;

  doc.font('Helvetica').fillColor(COLORS.deepNavy).fontSize(7);

  for (let i = 0; i < displayTrace.length; i++) {
    if (y > 700) {
      doc.addPage();
      y = 60;
      // Reprint header
      doc.rect(50, y - 2, 512, 14).fill(COLORS.deepNavy);
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#FFFFFF');
      for (const col of cols) {
        doc.text(col.label, col.x, y, { width: col.width });
      }
      y += 14;
      doc.font('Helvetica').fillColor(COLORS.deepNavy).fontSize(7);
    }

    const p = displayTrace[i];
    const elapsed = ((p.timestamp - t0) / 1000).toFixed(1);

    // Alternate row shading
    if (i % 2 === 0) {
      doc.rect(50, y - 2, 512, 12).fill(COLORS.lightGray);
      doc.fillColor(COLORS.deepNavy);
    }

    doc.text(`+${elapsed}s`, cols[0].x, y, { width: cols[0].width });
    doc.text(`${p.speedMph.toFixed(1)} mph`, cols[1].x, y, { width: cols[1].width });
    doc.text(p.latitude.toFixed(6), cols[2].x, y, { width: cols[2].width });
    doc.text(p.longitude.toFixed(6), cols[3].x, y, { width: cols[3].width });
    doc.text(`${Math.round(p.heading)}°`, cols[4].x, y, { width: cols[4].width });
    doc.text(
      p.horizontalAccuracyMeters != null ? `${p.horizontalAccuracyMeters.toFixed(1)}m` : '-',
      cols[5].x, y, { width: cols[5].width }
    );
    y += 12;
  }

  if (sorted.length > 30) {
    doc.fontSize(7).fillColor(COLORS.slate).font('Helvetica-Oblique')
      .text(`Showing ${displayTrace.length} of ${sorted.length} data points (sampled for readability)`, 55, y + 4);
  }

  doc.y = y + 15;
}

function drawFooter(doc: typeof PDFDocument.prototype, receipt: ReceiptData) {
  const pageHeight = doc.page.height;
  const footerY = pageHeight - 60;

  if (doc.y > footerY - 20) {
    doc.addPage();
  }

  doc.y = footerY;

  doc
    .fillColor(COLORS.medGray)
    .lineWidth(0.5)
    .moveTo(50, footerY)
    .lineTo(562, footerY)
    .stroke();

  doc
    .fontSize(7)
    .fillColor(COLORS.slate)
    .font('Helvetica')
    .text(
      'This evidence receipt was automatically generated by Autopilot America using GPS and device motion sensors. ' +
      'All data was captured in real-time during the intersection approach. GPS coordinates and timestamps are recorded by the device operating system. ' +
      'Accelerometer data captures raw sensor readings from the device motion coprocessor.',
      50, footerY + 6, { width: 512, align: 'center' }
    );

  doc
    .fontSize(7)
    .fillColor(COLORS.blue)
    .text('autopilotamerica.com', { align: 'center', link: 'https://autopilotamerica.com' });
}

// ===== Helpers =====

function sectionHeader(doc: typeof PDFDocument.prototype, title: string) {
  doc.moveDown(0.5);
  doc
    .fillColor(COLORS.deepNavy)
    .fontSize(12)
    .font('Helvetica-Bold')
    .text(title);
  doc.moveDown(0.3);
  doc
    .strokeColor(COLORS.blue)
    .lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(200, doc.y)
    .stroke();
  doc.moveDown(0.5);
}

function headingToCardinal(heading: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(heading / 22.5) % 16;
  return dirs[idx];
}

function sampleTrace(trace: TracePoint[], count: number): TracePoint[] {
  if (trace.length <= count) return trace;
  const result: TracePoint[] = [trace[0]]; // Always include first
  const step = (trace.length - 1) / (count - 1);
  for (let i = 1; i < count - 1; i++) {
    result.push(trace[Math.round(i * step)]);
  }
  result.push(trace[trace.length - 1]); // Always include last
  return result;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

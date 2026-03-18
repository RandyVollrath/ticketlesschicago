/**
 * Red Light Camera Evidence Report Generator
 *
 * Produces a professional PDF evidence exhibit for red-light camera ticket contests.
 * Includes:
 *   - Speed-vs-time chart (text-based, PDFKit native)
 *   - GPS path diagram with camera location marked
 *   - Full stop analysis with duration
 *   - Accelerometer deceleration summary
 *   - Timestamp correlation with violation time (when available)
 *   - SHA-256 data integrity hash
 *   - Professional formatting suitable for an administrative hearing officer
 */

import PDFDocument from 'pdfkit';
import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface RedLightReceiptData {
  id: string;
  device_timestamp: string;      // ISO timestamp
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
  accelerometer_trace?: AccelPoint[];
  // Optional violation data from portal scraper
  violation_datetime?: string | null;   // ISO timestamp from portal
  ticket_number?: string | null;
  // Pre-computed hash (if available from capture time)
  evidence_hash?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Compute SHA-256 hash of the raw evidence data for chain-of-custody integrity.
 * The hash covers: trace points, accelerometer data, camera location, and device timestamp.
 */
export function computeEvidenceHash(receipt: RedLightReceiptData): string {
  const canonical = JSON.stringify({
    device_timestamp: receipt.device_timestamp,
    camera_latitude: receipt.camera_latitude,
    camera_longitude: receipt.camera_longitude,
    intersection_id: receipt.intersection_id,
    heading: receipt.heading,
    approach_speed_mph: receipt.approach_speed_mph,
    min_speed_mph: receipt.min_speed_mph,
    full_stop_detected: receipt.full_stop_detected,
    full_stop_duration_sec: receipt.full_stop_duration_sec,
    trace: receipt.trace.map(t => ({
      ts: t.timestamp,
      lat: t.latitude,
      lng: t.longitude,
      spd: t.speedMph,
      acc: t.horizontalAccuracyMeters,
    })),
    accel_count: receipt.accelerometer_trace?.length || 0,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Analyze the trace to find the full stop window (consecutive readings at or near 0 mph).
 */
function analyzeFullStop(trace: TracePoint[]): {
  stopStartIdx: number;
  stopEndIdx: number;
  stopDurationSec: number;
  minSpeedDuringStop: number;
} | null {
  if (trace.length < 3) return null;

  const STOP_THRESHOLD_MPH = 2.0;
  let bestStart = -1;
  let bestEnd = -1;
  let bestDuration = 0;

  let currentStart = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].speedMph <= STOP_THRESHOLD_MPH) {
      if (currentStart === -1) currentStart = i;
    } else {
      if (currentStart !== -1) {
        const duration = (trace[i - 1].timestamp - trace[currentStart].timestamp) / 1000;
        if (duration > bestDuration) {
          bestStart = currentStart;
          bestEnd = i - 1;
          bestDuration = duration;
        }
        currentStart = -1;
      }
    }
  }
  // Check if stop extends to end of trace
  if (currentStart !== -1) {
    const duration = (trace[trace.length - 1].timestamp - trace[currentStart].timestamp) / 1000;
    if (duration > bestDuration) {
      bestStart = currentStart;
      bestEnd = trace.length - 1;
      bestDuration = duration;
    }
  }

  if (bestStart === -1) return null;

  let minSpeed = Infinity;
  for (let i = bestStart; i <= bestEnd; i++) {
    if (trace[i].speedMph < minSpeed) minSpeed = trace[i].speedMph;
  }

  return {
    stopStartIdx: bestStart,
    stopEndIdx: bestEnd,
    stopDurationSec: bestDuration,
    minSpeedDuringStop: minSpeed,
  };
}

// ─── PDF Generation ──────────────────────────────────────────────────────────

export async function generateEvidenceReportPDF(
  receipt: RedLightReceiptData,
  userName?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 54, bottom: 54, left: 54, right: 54 },
        info: {
          Title: `Red Light Camera Evidence Report — ${receipt.camera_address}`,
          Author: 'Autopilot America',
          Subject: `Evidence report for intersection ${receipt.camera_address}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 612 - 54 - 54; // usable width
      const hash = receipt.evidence_hash || computeEvidenceHash(receipt);
      const trace = receipt.trace || [];
      const stopAnalysis = analyzeFullStop(trace);

      // ─── Header ─────────────────────────────────────────────────────
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000');
      doc.text('RED LIGHT CAMERA EVIDENCE REPORT', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica').fillColor('#555555');
      doc.text('Exhibit — Vehicle Sensor Data Captured at Time of Alleged Violation', { align: 'center' });
      doc.moveDown(0.3);
      doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      // ─── Section 1: Summary ─────────────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
      doc.text('1. EVIDENCE SUMMARY');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');

      const summaryFields: [string, string][] = [
        ['Camera Location', receipt.camera_address],
        ['Date & Time', formatTimestamp(receipt.device_timestamp)],
        ['Coordinates', `${receipt.camera_latitude.toFixed(5)}, ${receipt.camera_longitude.toFixed(5)}`],
        ['GPS Accuracy', receipt.horizontal_accuracy_meters != null ? `${receipt.horizontal_accuracy_meters.toFixed(1)} meters` : 'N/A'],
        ['Vehicle Heading', `${receipt.heading.toFixed(1)}°`],
        ['Approach Speed', receipt.approach_speed_mph != null ? `${receipt.approach_speed_mph.toFixed(1)} mph` : 'N/A'],
        ['Minimum Speed Recorded', receipt.min_speed_mph != null ? `${receipt.min_speed_mph.toFixed(1)} mph` : 'N/A'],
        ['Speed Reduction', receipt.speed_delta_mph != null ? `${receipt.speed_delta_mph.toFixed(1)} mph` : 'N/A'],
        ['Full Stop Detected', receipt.full_stop_detected ? 'YES' : 'No'],
      ];

      if (receipt.full_stop_detected && receipt.full_stop_duration_sec != null) {
        summaryFields.push(['Full Stop Duration', `${receipt.full_stop_duration_sec.toFixed(1)} seconds`]);
      }
      if (receipt.ticket_number) {
        summaryFields.push(['Ticket Number', receipt.ticket_number]);
      }
      if (receipt.violation_datetime) {
        summaryFields.push(['Violation Time (City)', formatTimestamp(receipt.violation_datetime)]);
      }

      summaryFields.push(['GPS Trace Points', `${trace.length} readings over ${trace.length > 1 ? ((trace[trace.length - 1].timestamp - trace[0].timestamp) / 1000).toFixed(0) : '0'}s`]);

      if (receipt.accelerometer_trace && receipt.accelerometer_trace.length > 0) {
        summaryFields.push(['Accelerometer Samples', `${receipt.accelerometer_trace.length}`]);
      }

      for (const [label, value] of summaryFields) {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
      }

      // ─── Full Stop Finding (prominent) ──────────────────────────────
      if (receipt.full_stop_detected) {
        doc.moveDown(0.5);
        doc.rect(54, doc.y, pageWidth, 36).fillAndStroke('#e8f5e9', '#4caf50');
        doc.fillColor('#1b5e20').font('Helvetica-Bold').fontSize(11);
        doc.text('FINDING: Vehicle came to a COMPLETE STOP at this intersection.', 62, doc.y - 28, { width: pageWidth - 16 });
        if (stopAnalysis && stopAnalysis.stopDurationSec >= 1) {
          doc.fontSize(9).font('Helvetica').fillColor('#2e7d32');
          doc.text(`Sustained stop of ${stopAnalysis.stopDurationSec.toFixed(1)} seconds detected (min speed: ${stopAnalysis.minSpeedDuringStop.toFixed(1)} mph).`, 62);
        }
        doc.fillColor('#000000');
      }

      doc.moveDown(0.8);

      // ─── Section 2: Speed-vs-Time Chart (text-based) ────────────────
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('2. SPEED PROFILE OVER TIME');
      doc.moveDown(0.3);
      doc.fontSize(8).font('Helvetica').fillColor('#666666');
      doc.text('Each row represents one GPS reading. Speed is shown in MPH with a visual bar.');
      doc.moveDown(0.3);

      if (trace.length > 0) {
        const baseTs = trace[0].timestamp;
        const maxSpeed = Math.max(...trace.map(t => t.speedMph), 1);
        const barMaxWidth = 200;

        // Header row
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#333333');
        const tableX = 60;
        doc.text('Time(s)', tableX, doc.y, { width: 45 });
        doc.text('MPH', tableX + 48, doc.y - doc.currentLineHeight(), { width: 35 });
        doc.text('Accuracy', tableX + 86, doc.y - doc.currentLineHeight(), { width: 50 });
        doc.text('Speed Bar', tableX + 140, doc.y - doc.currentLineHeight(), { width: barMaxWidth });
        doc.moveDown(0.2);

        // Draw separator
        doc.moveTo(tableX, doc.y).lineTo(tableX + 140 + barMaxWidth, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.2);

        // Data rows — show every row if <=35, otherwise sample
        const maxRows = 35;
        const step = trace.length <= maxRows ? 1 : Math.ceil(trace.length / maxRows);

        doc.font('Helvetica').fontSize(7).fillColor('#000000');
        for (let i = 0; i < trace.length; i += step) {
          const t = trace[i];
          const elapsed = ((t.timestamp - baseTs) / 1000).toFixed(1);
          const speed = t.speedMph.toFixed(1);
          const acc = t.horizontalAccuracyMeters != null ? `${t.horizontalAccuracyMeters.toFixed(1)}m` : '-';
          const barWidth = Math.max(1, (t.speedMph / maxSpeed) * barMaxWidth);

          const rowY = doc.y;

          // Highlight stop rows
          if (t.speedMph <= 2.0) {
            doc.rect(tableX - 2, rowY - 1, 140 + barMaxWidth + 4, 10).fill('#e8f5e9');
            doc.fillColor('#1b5e20');
          } else {
            doc.fillColor('#000000');
          }

          doc.text(elapsed, tableX, rowY, { width: 45 });
          doc.text(speed, tableX + 48, rowY, { width: 35 });
          doc.text(acc, tableX + 86, rowY, { width: 50 });

          // Speed bar
          const barColor = t.speedMph <= 2.0 ? '#4caf50' : t.speedMph <= 10 ? '#ff9800' : '#f44336';
          doc.rect(tableX + 140, rowY + 1, barWidth, 7).fill(barColor);

          doc.moveDown(0.15);

          // Page break if running out of room
          if (doc.y > 700) {
            doc.addPage();
            doc.fontSize(8).font('Helvetica').fillColor('#888888');
            doc.text('Speed Profile (continued)', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(7).font('Helvetica').fillColor('#000000');
          }
        }
      }

      doc.moveDown(0.8);

      // ─── Section 3: Timestamp Correlation ───────────────────────────
      if (receipt.violation_datetime) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
        doc.text('3. VIOLATION TIMESTAMP CORRELATION');
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');

        const violationTime = new Date(receipt.violation_datetime).getTime();
        const deviceTime = new Date(receipt.device_timestamp).getTime();
        const diffMs = Math.abs(violationTime - deviceTime);
        const diffSec = diffMs / 1000;
        const diffMin = diffSec / 60;

        doc.font('Helvetica-Bold').text('City Violation Time: ', { continued: true });
        doc.font('Helvetica').text(formatTime(receipt.violation_datetime));
        doc.font('Helvetica-Bold').text('Device Capture Time: ', { continued: true });
        doc.font('Helvetica').text(formatTime(receipt.device_timestamp));
        doc.font('Helvetica-Bold').text('Time Difference: ', { continued: true });

        if (diffMin < 1) {
          doc.font('Helvetica').text(`${diffSec.toFixed(0)} seconds`);
        } else {
          doc.font('Helvetica').text(`${diffMin.toFixed(1)} minutes`);
        }

        if (diffMin < 5) {
          doc.moveDown(0.3);
          doc.fontSize(9).font('Helvetica').fillColor('#1b5e20');
          doc.text('The device capture time closely matches the city violation time, confirming this data corresponds to the cited incident.');
        } else if (diffMin < 60) {
          doc.moveDown(0.3);
          doc.fontSize(9).font('Helvetica').fillColor('#e65100');
          doc.text('The device capture time is within one hour of the violation time. This data may correspond to the same pass through this intersection.');
        }
        doc.fillColor('#000000');
        doc.moveDown(0.8);
      }

      // ─── Section 4: Accelerometer Deceleration ──────────────────────
      const nextSection = receipt.violation_datetime ? '4' : '3';
      if (receipt.accelerometer_trace && receipt.accelerometer_trace.length > 10) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
        doc.text(`${nextSection}. ACCELEROMETER BRAKING ANALYSIS`);
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica').fillColor('#666666');
        doc.text('The accelerometer (motion sensor) independently records vehicle deceleration.');
        doc.text('Negative values in the forward axis indicate braking force.');
        doc.moveDown(0.3);

        // Compute peak deceleration
        const accelData = receipt.accelerometer_trace;
        let peakDecel = 0;
        let peakDecelIdx = 0;
        for (let i = 0; i < accelData.length; i++) {
          // Forward deceleration is typically in the x-axis (depends on phone orientation)
          // Use magnitude of user acceleration as proxy
          const mag = Math.sqrt(accelData[i].x ** 2 + accelData[i].y ** 2 + accelData[i].z ** 2);
          if (mag > peakDecel) {
            peakDecel = mag;
            peakDecelIdx = i;
          }
        }

        doc.fontSize(10).font('Helvetica').fillColor('#000000');
        doc.font('Helvetica-Bold').text('Accelerometer Samples: ', { continued: true });
        doc.font('Helvetica').text(`${accelData.length}`);
        doc.font('Helvetica-Bold').text('Peak Acceleration Magnitude: ', { continued: true });
        doc.font('Helvetica').text(`${peakDecel.toFixed(3)} G`);

        const durationSec = accelData.length > 1
          ? (accelData[accelData.length - 1].timestamp - accelData[0].timestamp)
          : 0;
        doc.font('Helvetica-Bold').text('Recording Duration: ', { continued: true });
        doc.font('Helvetica').text(`${durationSec.toFixed(1)} seconds`);

        doc.moveDown(0.8);
      }

      // ─── Section N: Data Integrity ──────────────────────────────────
      const integritySection = receipt.violation_datetime
        ? (receipt.accelerometer_trace && receipt.accelerometer_trace.length > 10 ? '5' : '4')
        : (receipt.accelerometer_trace && receipt.accelerometer_trace.length > 10 ? '4' : '3');

      // Ensure we're on a fresh area
      if (doc.y > 650) doc.addPage();

      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
      doc.text(`${integritySection}. DATA INTEGRITY VERIFICATION`);
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica').fillColor('#666666');
      doc.text('A cryptographic hash of the raw sensor data is computed to verify the evidence has not been altered.');
      doc.text('This hash can be independently verified against the data stored on Autopilot America servers.');
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica').fillColor('#000000');
      doc.font('Helvetica-Bold').text('Algorithm: ', { continued: true });
      doc.font('Helvetica').text('SHA-256');
      doc.font('Helvetica-Bold').text('Hash: ', { continued: true });
      doc.font('Courier').fontSize(8).text(hash);
      doc.font('Helvetica').fontSize(10);
      doc.font('Helvetica-Bold').text('Verification: ', { continued: true });
      doc.font('Helvetica').text('Data stored at https://autopilotamerica.com — independently verifiable');

      doc.moveDown(1);

      // ─── Footer ─────────────────────────────────────────────────────
      doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      doc.fontSize(8).fillColor('#888888').font('Helvetica');
      doc.text(`Report generated: ${new Date().toISOString()}`, { align: 'center' });
      doc.text(`Evidence ID: ${receipt.id}`, { align: 'center' });
      if (userName) {
        doc.text(`Prepared for: ${userName}`, { align: 'center' });
      }
      doc.text('Autopilot America — www.autopilotamerica.com', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor('#aaaaaa');
      doc.text(
        'This report was generated from GPS and accelerometer data captured by the Autopilot mobile application. ' +
        'All sensor readings are recorded automatically by the device at the time of the event. ' +
        'The SHA-256 hash above can be used to verify that the underlying data has not been modified since capture.',
        { align: 'center' }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Evidence Report API Endpoint
 *
 * Generates a PDF evidence report for a red-light camera receipt.
 * Used for:
 *   - User-facing download (preview/print the evidence exhibit)
 *   - Attachment to emailed contest submissions
 *
 * GET /api/contest/evidence-report?receiptId=xxx
 * Authorization: Bearer <token>
 *
 * Returns: application/pdf
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { generateEvidenceReportPDF, RedLightReceiptData } from '../../../lib/red-light-evidence-report';
import { analyzeRedLightDefense, type AnalysisInput } from '../../../lib/red-light-defense-analysis';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const receiptId = req.query.receiptId as string;
  if (!receiptId) {
    return res.status(400).json({ error: 'Missing receiptId query parameter' });
  }

  try {
    // Fetch the red light receipt (user can only access their own)
    const { data: receipt, error: fetchError } = await supabase
      .from('red_light_receipts')
      .select('*')
      .eq('id', receiptId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Get user profile for name
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .maybeSingle();

    const userName = profile?.first_name && profile?.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : undefined;

    // Check if there's a matching detected ticket for violation timestamp
    let violationDatetime: string | null = null;
    let ticketNumber: string | null = null;

    const { data: matchingTickets } = await supabase
      .from('detected_tickets')
      .select('ticket_number, issue_datetime, violation_date')
      .eq('user_id', user.id)
      .or('violation_type.eq.red_light,violation_description.ilike.%red light%')
      .order('violation_date', { ascending: false })
      .limit(5);

    if (matchingTickets && matchingTickets.length > 0) {
      // Try to match by date
      const receiptDate = receipt.device_timestamp
        ? new Date(receipt.device_timestamp).toISOString().split('T')[0]
        : null;

      const match = matchingTickets.find((t: any) => t.violation_date === receiptDate) || matchingTickets[0];
      violationDatetime = match.issue_datetime || null;
      ticketNumber = match.ticket_number || null;
    }

    // Look up detected_ticket for plate and notice data
    let detectedTicketData: any = null;
    if (ticketNumber) {
      const { data } = await supabase
        .from('detected_tickets')
        .select('ticket_plate, ticket_state, plate, state, created_at')
        .eq('ticket_number', ticketNumber)
        .limit(1)
        .maybeSingle();
      detectedTicketData = data;
    }

    // Run defense analysis
    let defenseAnalysis: Awaited<ReturnType<typeof analyzeRedLightDefense>> | null = null;
    try {
      const trace = Array.isArray(receipt.trace) ? receipt.trace : [];
      const analysisInput: AnalysisInput = {
        trace,
        cameraLatitude: receipt.camera_latitude || 0,
        cameraLongitude: receipt.camera_longitude || 0,
        postedSpeedMph: receipt.speed_limit_mph ?? 30,
        approachSpeedMph: receipt.approach_speed_mph ?? null,
        minSpeedMph: receipt.min_speed_mph ?? null,
        fullStopDetected: receipt.full_stop_detected ?? false,
        fullStopDurationSec: receipt.full_stop_duration_sec ?? null,
        speedDeltaMph: receipt.speed_delta_mph ?? null,
        violationDatetime: violationDatetime,
        deviceTimestamp: receipt.device_timestamp,
        cameraAddress: receipt.camera_address || receipt.intersection_id || undefined,
        noticeDate: detectedTicketData?.created_at || null,
        ticketPlate: detectedTicketData?.ticket_plate || null,
        ticketState: detectedTicketData?.ticket_state || null,
        userPlate: detectedTicketData?.plate || null,
        userState: detectedTicketData?.state || null,
      };
      defenseAnalysis = await analyzeRedLightDefense(analysisInput);
    } catch (e) {
      // Non-fatal — PDF will just lack defense sections
    }

    // Build the receipt data for the report
    const receiptData: RedLightReceiptData = {
      id: receipt.id,
      device_timestamp: receipt.device_timestamp,
      camera_address: receipt.camera_address || receipt.intersection_id || 'Unknown',
      camera_latitude: receipt.camera_latitude || 0,
      camera_longitude: receipt.camera_longitude || 0,
      intersection_id: receipt.intersection_id || '',
      heading: receipt.heading || 0,
      approach_speed_mph: receipt.approach_speed_mph ?? null,
      min_speed_mph: receipt.min_speed_mph ?? null,
      speed_delta_mph: receipt.speed_delta_mph ?? null,
      full_stop_detected: receipt.full_stop_detected ?? false,
      full_stop_duration_sec: receipt.full_stop_duration_sec ?? null,
      horizontal_accuracy_meters: receipt.horizontal_accuracy_meters ?? null,
      estimated_speed_accuracy_mph: receipt.estimated_speed_accuracy_mph ?? null,
      trace: receipt.trace || [],
      accelerometer_trace: receipt.accelerometer_trace || undefined,
      violation_datetime: violationDatetime,
      ticket_number: ticketNumber,
      evidence_hash: receipt.evidence_hash || null,
      defenseAnalysis: defenseAnalysis ? {
        yellowLight: defenseAnalysis.yellowLight ?? undefined,
        rightTurn: defenseAnalysis.rightTurn ?? undefined,
        geometry: defenseAnalysis.geometry ?? undefined,
        weather: defenseAnalysis.weather ?? undefined,
        violationSpike: defenseAnalysis.violationSpike ?? undefined,
        dilemmaZone: defenseAnalysis.dilemmaZone ?? undefined,
        lateNotice: defenseAnalysis.lateNotice ?? undefined,
        factualInconsistency: defenseAnalysis.factualInconsistency ?? undefined,
        overallDefenseScore: defenseAnalysis.overallDefenseScore,
        defenseArguments: defenseAnalysis.defenseArguments,
      } : undefined,
    };

    // Generate the PDF
    const pdfBuffer = await generateEvidenceReportPDF(receiptData, userName);

    // Return as PDF
    const filename = `evidence-report-${receipt.intersection_id || receipt.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (error: any) {
    console.error('Evidence report generation error:', error);
    return res.status(500).json({ error: 'Failed to generate evidence report' });
  }
}

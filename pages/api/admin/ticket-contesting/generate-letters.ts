/**
 * Admin API: Generate Contest Letters from VA Findings
 *
 * Processes tickets from va_ticket_findings and generates AI-powered
 * contest letters using Claude Sonnet 4.5, then creates PDFs.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { generateBatchLettersPDF, LetterData } from '../../../../lib/pdf-letter-generator';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!anthropic) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const { batch_id, ticket_ids, mode } = req.body;

    // Build query
    let query = supabase
      .from('va_ticket_findings')
      .select('*')
      .not('ticket_number', 'is', null);

    if (batch_id) {
      query = query.eq('upload_batch_id', batch_id);
    } else if (ticket_ids && Array.isArray(ticket_ids)) {
      query = query.in('id', ticket_ids);
    } else if (mode === 'all_pending') {
      query = query.eq('processing_status', 'pending');
    } else {
      return res.status(400).json({ error: 'Must provide batch_id, ticket_ids, or mode: "all_pending"' });
    }

    const { data: tickets, error: ticketsError } = await query.limit(50);

    if (ticketsError) throw ticketsError;

    if (!tickets || tickets.length === 0) {
      return res.status(200).json({ success: true, message: 'No tickets to process', processed: 0 });
    }

    // Get user profiles for matched tickets
    const userIds = [...new Set(tickets.filter(t => t.user_id).map(t => t.user_id))];
    const userProfiles = new Map();

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, name, address, city, state, zip, email')
        .in('user_id', userIds);
      profiles?.forEach(p => userProfiles.set(p.user_id, p));
    }

    const results: { ticketId: string; ticketNumber: string; success: boolean; error?: string }[] = [];
    const letterDataArray: LetterData[] = [];

    for (const ticket of tickets) {
      try {
        const profile = ticket.user_id ? userProfiles.get(ticket.user_id) : null;

        // Fetch FOIA statistics
        let foiaStats = null;
        if (ticket.violation_code) {
          const { data: records } = await supabase
            .from('contested_tickets_foia')
            .select('disposition, reason')
            .eq('violation_code', ticket.violation_code)
            .limit(5000);

          if (records && records.length > 0) {
            const wins = records.filter(r => r.disposition === 'Not Liable');
            const total = records.length;
            const winRate = Math.round((wins.length / total) * 100);

            const reasonCounts: Record<string, number> = {};
            wins.forEach(r => {
              if (r.reason) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
            });

            const topReasons = Object.entries(reasonCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([reason, count]) => ({ reason, count, percentage: Math.round((count / wins.length) * 100) }));

            foiaStats = { total_contests: total, wins: wins.length, win_rate_percent: winRate, top_dismissal_reasons: topReasons };
          }
        }

        const foiaContext = foiaStats
          ? `
HISTORICAL DATA FROM 1.2M+ CHICAGO PARKING TICKET CONTESTS (FOIA):
- This violation code (${ticket.violation_code}) has been contested ${foiaStats.total_contests} times
- Win rate: ${foiaStats.win_rate_percent}% of contests result in dismissal
- Top reasons tickets are dismissed for this violation:
${foiaStats.top_dismissal_reasons?.map((r: any, i: number) => `  ${i + 1}. "${r.reason}" (${r.percentage}% of wins)`).join('\n') || '  - No specific reason data available'}
`
          : '';

        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // Generate letter using Claude Sonnet 4.5
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `You are a legal writing expert specializing in Chicago parking ticket contests. Generate a professional, persuasive contest letter.

TICKET DETAILS:
- Violation Code: ${ticket.violation_code || 'Unknown'}
- Violation Description: ${ticket.violation_description || 'Not provided'}
- Ticket Number: ${ticket.ticket_number}
- Ticket Date: ${ticket.issue_date || 'Not provided'}
- Ticket Amount: $${ticket.amount || 'Unknown'}
- Location: ${ticket.violation_location || 'Not provided'}
- License Plate: ${ticket.license_plate} (${ticket.license_state})

RESPONDENT INFO:
- Name: ${profile?.name || '[VEHICLE OWNER NAME]'}
- Address: ${profile?.address || '[ADDRESS]'}
- City, State ZIP: ${profile?.city || '[CITY]'}, ${profile?.state || 'IL'} ${profile?.zip || '[ZIP]'}

${foiaContext}

TODAY'S DATE: ${today}

INSTRUCTIONS:
1. Write a formal contest letter to City of Chicago Department of Administrative Hearings
2. Use FOIA data to inform arguments - reference successful dismissal reasons
3. Be respectful but assertive
4. Include specific legal grounds based on historical data
5. Request dismissal of the ticket
6. Keep to one page (~400 words)
7. DO NOT make up facts

Generate the letter:`
          }]
        });

        const letterContent = message.content[0];
        if (letterContent.type !== 'text') throw new Error('Failed to generate letter');

        const letterData: LetterData = {
          ticketNumber: ticket.ticket_number,
          issueDate: ticket.issue_date || 'Unknown',
          violationCode: ticket.violation_code || 'Unknown',
          violationDescription: ticket.violation_description || 'Not specified',
          location: ticket.violation_location || 'Not specified',
          amount: ticket.amount || 0,
          userName: profile?.name || '[VEHICLE OWNER NAME]',
          userAddress: profile?.address || '[ADDRESS]',
          userCity: profile?.city || '[CITY]',
          userState: profile?.state || 'IL',
          userZip: profile?.zip || '[ZIP]',
          licensePlate: ticket.license_plate,
          licenseState: ticket.license_state,
          letterBody: letterContent.text,
          foiaStats: foiaStats ? { totalContests: foiaStats.total_contests, winRate: foiaStats.win_rate_percent } : undefined,
        };

        letterDataArray.push(letterData);

        await supabase
          .from('va_ticket_findings')
          .update({
            processing_status: 'contested',
            contested_at: new Date().toISOString(),
            admin_notes: `Letter generated on ${today}`,
          })
          .eq('id', ticket.id);

        results.push({ ticketId: ticket.id, ticketNumber: ticket.ticket_number, success: true });
      } catch (error: any) {
        console.error(`Error processing ticket ${ticket.id}:`, error);
        results.push({ ticketId: ticket.id, ticketNumber: ticket.ticket_number, success: false, error: error.message });
      }
    }

    // Generate PDF
    let pdfBase64 = null;
    if (letterDataArray.length > 0) {
      try {
        const pdfBuffer = await generateBatchLettersPDF(letterDataArray);
        pdfBase64 = pdfBuffer.toString('base64');
      } catch (error: any) {
        console.error('Error generating PDF:', error);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return res.status(200).json({
      success: true,
      message: `Generated ${successCount} letters${failCount > 0 ? `, ${failCount} failed` : ''}`,
      processed: successCount,
      failed: failCount,
      results,
      pdf: pdfBase64,
      pdfFilename: `contest-letters-${new Date().toISOString().split('T')[0]}.pdf`,
    });
  } catch (error: any) {
    console.error('Generate letters error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate letters' });
  }
}

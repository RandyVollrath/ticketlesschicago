/**
 * Admin endpoint to upload VA findings CSV
 *
 * Accepts the CSV format exported by the cron job:
 * last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_description, violation_date, amount, location
 *
 * Only processes rows where ticket_number is filled in (indicating VA found a ticket)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false, // We'll handle file parsing ourselves
  },
};

interface ParsedTicket {
  last_name: string;
  first_name: string;
  plate: string;
  state: string;
  user_id: string;
  ticket_number: string;
  violation_code: string;
  violation_type: string;
  violation_description: string;
  violation_date: string;
  amount: string;
  location: string;
}

function parseCSV(content: string): ParsedTicket[] {
  const lines = content.split('\n');
  const tickets: ParsedTicket[] = [];

  // Find the header line (skip comment lines starting with #)
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      headerIndex = i;
      break;
    }
  }

  const headerLine = lines[headerIndex];
  if (!headerLine) return tickets;

  // Parse header to get column indices
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

  // Map expected columns
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    colIndex[h] = i;
  });

  // Process data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Parse CSV line (handle quoted values)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim()); // Last value

    // Extract values by column name
    const getValue = (key: string): string => {
      const idx = colIndex[key];
      if (idx === undefined) return '';
      return (values[idx] || '').replace(/^"|"$/g, '').trim();
    };

    const ticket: ParsedTicket = {
      last_name: getValue('last_name'),
      first_name: getValue('first_name'),
      plate: getValue('plate'),
      state: getValue('state'),
      user_id: getValue('user_id'),
      ticket_number: getValue('ticket_number'),
      violation_code: getValue('violation_code'),
      violation_type: getValue('violation_type'),
      violation_description: getValue('violation_description'),
      violation_date: getValue('violation_date'),
      amount: getValue('amount'),
      location: getValue('location'),
    };

    // Only include rows where ticket_number is filled in
    if (ticket.ticket_number && ticket.plate) {
      tickets.push(ticket);
    }
  }

  return tickets;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the uploaded file
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB limit

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read file content
    const content = fs.readFileSync(file.filepath, 'utf-8');

    // Parse CSV
    const tickets = parseCSV(content);

    if (tickets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No tickets with ticket_number found in CSV. Make sure the VA filled in ticket data.'
      });
    }

    console.log(`📥 Processing ${tickets.length} ticket findings from VA upload`);

    const results = {
      success: true,
      processed: tickets.length,
      ticketsCreated: 0,
      lettersGenerated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const ticket of tickets) {
      try {
        // Find the monitored plate
        const { data: plate } = await supabaseAdmin
          .from('monitored_plates')
          .select('id, user_id')
          .eq('plate', ticket.plate.toUpperCase())
          .eq('state', ticket.state.toUpperCase())
          .eq('status', 'active')
          .single();

        if (!plate) {
          console.log(`  Skipping ${ticket.plate}: No active monitored plate found`);
          results.skipped++;
          continue;
        }

        // Check if ticket already exists
        const { data: existingTicket } = await supabaseAdmin
          .from('detected_tickets')
          .select('id')
          .eq('ticket_number', ticket.ticket_number)
          .single();

        if (existingTicket) {
          console.log(`  Skipping ${ticket.ticket_number}: Already exists`);
          results.skipped++;
          continue;
        }

        // Parse amount if provided
        let amount: number | null = null;
        if (ticket.amount) {
          const parsed = parseFloat(ticket.amount.replace(/[^0-9.]/g, ''));
          if (!isNaN(parsed)) amount = parsed;
        }

        // Create ticket record
        const { data: newTicket, error: ticketError } = await supabaseAdmin
          .from('detected_tickets')
          .insert({
            user_id: plate.user_id,
            plate_id: plate.id,
            plate: ticket.plate.toUpperCase(),
            state: ticket.state.toUpperCase(),
            ticket_number: ticket.ticket_number,
            violation_code: ticket.violation_code || null,
            violation_type: ticket.violation_type || 'other_unknown',
            violation_description: ticket.violation_description || null,
            violation_date: ticket.violation_date || null,
            amount: amount,
            location: ticket.location || null,
            status: 'found',
            found_at: new Date().toISOString(),
            source: 'va_upload',
          })
          .select()
          .single();

        if (ticketError || !newTicket) {
          results.errors.push(`Failed to create ticket ${ticket.ticket_number}: ${ticketError?.message}`);
          continue;
        }

        results.ticketsCreated++;
        console.log(`  Created ticket ${ticket.ticket_number} for plate ${ticket.plate}`);

      } catch (err: any) {
        results.errors.push(`Error processing ${ticket.ticket_number}: ${err.message}`);
      }
    }

    // Log the upload
    await supabaseAdmin
      .from('va_uploads')
      .insert({
        original_filename: file.originalFilename || 'upload.csv',
        row_count: tickets.length,
        tickets_created: results.ticketsCreated,
        letters_generated: results.lettersGenerated,
        letters_sent: 0,
        errors: results.errors.length > 0 ? results.errors : null,
        status: results.ticketsCreated > 0 ? 'complete' : 'no_tickets',
        created_at: new Date().toISOString(),
      });

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    console.log(`✅ VA Upload complete:`, results);

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process upload'
    });
  }
}

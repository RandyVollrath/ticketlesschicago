/**
 * Admin API: Upload VA Ticket Findings
 *
 * Accepts a CSV file from the VA containing tickets found for paid users.
 * Uses the same format as the export-plates CSV.
 *
 * Expected CSV columns:
 * - license_plate (required)
 * - license_state (default: IL)
 * - user_name (ignored on upload - just for VA reference)
 * - ticket_number (required for tickets found)
 * - issue_date
 * - violation_code
 * - violation_description
 * - violation_location
 * - amount
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
  },
};

interface TicketRow {
  license_plate: string;
  license_state?: string;
  user_name?: string;
  ticket_number?: string;
  issue_date?: string;
  violation_code?: string;
  violation_description?: string;
  violation_location?: string;
  amount?: string;
  fine_amount?: string;
  late_fees?: string;
  ticket_status?: string;
  due_date?: string;
  va_notes?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({
      maxFileSize: 5 * 1024 * 1024, // 5MB
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read and parse CSV
    const fileContent = fs.readFileSync(file.filepath, 'utf-8');
    const rows = parseCSV(fileContent);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }

    // Create upload batch record
    let batchId: string | null = null;
    try {
      const { data: batch } = await supabase
        .from('va_upload_batches')
        .insert({
          uploaded_by: 'admin',
          filename: file.originalFilename,
          total_records: rows.length,
          processing_status: 'processing',
        })
        .select()
        .single();
      batchId = batch?.id || null;
    } catch (e) {
      console.log('Could not create batch record');
    }

    // Get all paid users for matching
    const { data: paidUsers } = await supabase
      .from('user_profiles')
      .select('user_id, license_plate, license_state')
      .eq('has_contesting', true)
      .not('license_plate', 'is', null);

    // Create a lookup map
    const userMap = new Map<string, { user_id: string; license_state: string }>();
    for (const user of paidUsers || []) {
      if (user.license_plate) {
        const key = `${user.license_plate.toUpperCase()}_${(user.license_state || 'IL').toUpperCase()}`;
        userMap.set(key, { user_id: user.user_id, license_state: user.license_state || 'IL' });
      }
    }

    // Process each row
    const results = {
      total: rows.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      matchedToUser: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      if (!row.license_plate) {
        results.skipped++;
        continue; // Skip rows without license plate (likely empty rows)
      }

      // Skip rows without ticket info (VA didn't find a ticket)
      if (!row.ticket_number) {
        results.skipped++;
        continue;
      }

      const licensePlate = row.license_plate.toUpperCase().trim();
      const licenseState = (row.license_state || 'IL').toUpperCase().trim();
      const lookupKey = `${licensePlate}_${licenseState}`;

      // Try to match to a user
      const matchedUser = userMap.get(lookupKey);

      // Parse date
      const issueDate = parseDate(row.issue_date);

      // Parse amount
      const amount = parseAmount(row.amount) || parseAmount(row.fine_amount);

      // Prepare the record
      const ticketRecord = {
        user_id: matchedUser?.user_id || null,
        license_plate: licensePlate,
        license_state: licenseState,
        ticket_number: row.ticket_number?.trim() || null,
        issue_date: issueDate,
        violation_code: row.violation_code?.trim() || null,
        violation_description: row.violation_description?.trim() || null,
        violation_location: row.violation_location?.trim() || null,
        amount,
        upload_batch_id: batchId,
        uploaded_by: 'admin',
        va_notes: row.va_notes?.trim() || null,
        raw_data: row,
        processing_status: 'pending',
      };

      // Upsert the ticket finding
      const { error: insertError } = await supabase
        .from('va_ticket_findings')
        .upsert(ticketRecord, {
          onConflict: 'license_plate,license_state,ticket_number',
        });

      if (insertError) {
        results.errors.push(`Row ${rowNum}: ${insertError.message}`);
        results.skipped++;
      } else {
        results.inserted++;
        if (matchedUser) {
          results.matchedToUser++;
        }
      }
    }

    // Update batch record
    if (batchId) {
      await supabase
        .from('va_upload_batches')
        .update({
          matched_users: results.matchedToUser,
          new_tickets: results.inserted,
          processing_status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', batchId);
    }

    // Cleanup temp file
    try {
      fs.unlinkSync(file.filepath);
    } catch (e) {}

    return res.status(200).json({
      success: true,
      batchId,
      results,
      message: `Processed ${results.total} rows: ${results.inserted} tickets inserted, ${results.matchedToUser} matched to users, ${results.skipped} skipped`,
    });

  } catch (error: any) {
    console.error('VA upload error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process upload' });
  }
}

function parseCSV(content: string): TicketRow[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h =>
    h.toLowerCase().trim().replace(/\s+/g, '_')
  );

  const rows: TicketRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row as unknown as TicketRow);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseDate(dateStr?: string): string | null {
  if (!dateStr?.trim()) return null;
  const str = dateStr.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // MM/DD/YYYY
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

function parseAmount(amountStr?: string): number | null {
  if (!amountStr?.trim()) return null;
  const cleaned = amountStr.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

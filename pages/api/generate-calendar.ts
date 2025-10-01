import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';
import * as ics from 'ics';

type IcsEventAttributes = any;

type NextDateResponse = {
  nextDate: string; // YYYY-MM-DD
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<string | { message: string } | NextDateResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ward, section, format } = req.query;

  if (!ward || !section || typeof ward !== 'string' || typeof section !== 'string') {
    return res.status(400).json({ message: 'Ward and Section query parameters are required.' });
  }

  // Fetch ALL future cleaning dates for the section
  let cleaningDates: string[] = [];
  try {
    console.log(`Calendar API: Fetching all future dates for Ward ${ward}, Section ${section}`);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', ward)
      .eq('section', section)
      .gte('cleaning_date', todayStr)
      .order('cleaning_date', { ascending: true });

    if (error) {
      throw error;
    }
    if (data) {
      cleaningDates = data.map(d => d.cleaning_date).filter(d => d !== null);
      console.log(`Calendar API: Found ${cleaningDates.length} future dates.`);
      console.log(`Calendar API: Fetched Dates:`, cleaningDates);
    }

  } catch (error: any) {
    console.error("Calendar API: Error fetching schedule dates:", error);
    return res.status(500).json({ message: "Failed to fetch schedule dates." });
  }

  if (cleaningDates.length === 0) {
      return res.status(404).json({ message: `No future cleaning dates found for Ward ${ward}, Section ${section}.` });
  }

  // Handle different formats
  if (format === 'next_iso') {
      // Return only the NEXT date
      console.log(`Calendar API: Returning next ISO date for W${ward} S${section}`);
      const nextDate = cleaningDates[0];
      res.status(200).json({ nextDate: nextDate });
  } else {
      // Generate and Return Full .ics File (Default)
      console.log(`Calendar API: Generating full ICS for W${ward} S${section}`);
      const events: IcsEventAttributes[] = [];
      const summary = `Street Cleaning: Ward ${ward}, Section ${section}`;
      const description = `Move car for street cleaning in Ward ${ward}, Section ${section}.`;

      cleaningDates.forEach(dateStr => {
          try {
              // Dates from Supabase are YYYY-MM-DD
              if (typeof dateStr !== 'string' || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                  console.warn(`Calendar API: Skipping invalid date format: ${dateStr}`);
                  return;
              }
              const [year, month, day] = dateStr.split('-').map(Number);
              // Set times in UTC assuming CDT (UTC-5 offset from Chicago local time)
              // 9:00 AM CDT = 14:00 UTC
              // 2:00 PM CDT = 19:00 UTC
              const startDateArray: ics.DateArray = [year, month, day, 14, 0]; // 14:00 UTC
              const endDateArray: ics.DateArray = [year, month, day, 19, 0]; // 19:00 UTC

              const event: IcsEventAttributes = {
                  title: summary,
                  description: description,
                  start: startDateArray,
                  end: endDateArray,
                  alarms: [
                    {
                      action: 'display',
                      description: 'Reminder',
                      summary: `Street Cleaning TOMORROW (W${ward} S${section})`,
                      trigger: { days: 1, before: true }
                    }
                  ]
              };

              console.log(`Calendar API: Creating event for ${dateStr}:`, {
                title: summary,
                description: description,
                start: startDateArray,
                end: endDateArray
              });

              events.push(event);

          } catch (e) {
              console.error(`Calendar API: Error processing date ${dateStr}:`, e);
          }
      });

      // Create Calendar File Content
      const { error: icsError, value: icsString } = ics.createEvents(events);

      console.log(`Calendar API: ics.createEvents result - Error:`, icsError, `| Has Value:`, !!icsString);

      if (icsError) {
        console.error("Calendar API: Error generating ICS file:", icsError);
        return res.status(500).json({ message: 'Failed to generate calendar file.' });
      }

      if (!icsString) {
        console.error("Calendar API: Generated ICS string is empty.");
        return res.status(500).json({ message: 'Failed to generate calendar file content.' });
      }

      // Send Response
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="street_cleaning_w${ward}_s${section}.ics"`);
      res.status(200).send(icsString);
  }
}

// Ticket monitoring system using Playwright
// Checks Chicago payment portal for new tickets

import { chromium, Browser, Page } from 'playwright';
import { supabaseAdmin } from './supabase';

interface TicketResult {
  ticket_number: string;
  issue_date: string;
  violation_description: string;
  amount: number;
  status: string;
}

interface UserToCheck {
  user_id: string;
  license_plate: string;
  license_state: string;
  last_name: string;
  email: string;
}

/**
 * Look up tickets for a single license plate
 */
export async function lookupTickets(
  plate: string,
  state: string,
  lastName: string
): Promise<{ tickets: TicketResult[]; rawHtml: string }> {
  let browser: Browser | null = null;

  try {
    console.log(`🔍 Looking up tickets for plate ${plate} (${state})`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    // Navigate to payment portal
    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for React/Angular to load
    await page.waitForTimeout(2000);

    // TODO: Fill in actual selectors after running test-ticket-lookup.js
    // These are placeholder selectors - need to be updated based on actual form

    // Try to find and fill license plate field
    const plateSelector = 'input[name="licensePlate"], input[id*="plate"], input[placeholder*="plate" i]';
    await page.waitForSelector(plateSelector, { timeout: 10000 });
    await page.fill(plateSelector, plate);

    // Fill state (if separate field)
    const stateSelector = 'select[name="state"], select[id*="state"]';
    const stateExists = await page.$(stateSelector);
    if (stateExists) {
      await page.selectOption(stateSelector, state);
    }

    // Fill last name
    const lastNameSelector = 'input[name="lastName"], input[id*="lastName"], input[placeholder*="last name" i]';
    const lastNameExists = await page.$(lastNameSelector);
    if (lastNameExists) {
      await page.fill(lastNameSelector, lastName);
    }

    // Click search/submit button
    const submitSelector = 'button[type="submit"], button:has-text("Search"), button:has-text("Find")';
    await page.click(submitSelector);

    // Wait for results
    await page.waitForTimeout(3000);

    // Capture the raw HTML for proof
    const rawHtml = await page.content();

    // Parse tickets from results
    // TODO: Update selectors based on actual results page structure
    const tickets: TicketResult[] = [];
    const ticketRows = await page.$$('.ticket-row, tr[data-ticket], .result-item');

    for (const row of ticketRows) {
      try {
        const ticketNumber = await row.$eval('[data-ticket-number], .ticket-number', el => el.textContent?.trim());
        const issueDate = await row.$eval('[data-issue-date], .issue-date', el => el.textContent?.trim());
        const violation = await row.$eval('[data-violation], .violation', el => el.textContent?.trim());
        const amountText = await row.$eval('[data-amount], .amount', el => el.textContent?.trim());
        const statusText = await row.$eval('[data-status], .status', el => el.textContent?.trim());

        if (ticketNumber) {
          tickets.push({
            ticket_number: ticketNumber,
            issue_date: issueDate || '',
            violation_description: violation || '',
            amount: parseFloat(amountText?.replace(/[$,]/g, '') || '0'),
            status: statusText || 'unknown'
          });
        }
      } catch (err) {
        console.error('Error parsing ticket row:', err);
      }
    }

    console.log(`✅ Found ${tickets.length} tickets`);

    return { tickets, rawHtml };

  } catch (error) {
    console.error('❌ Error looking up tickets:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Check tickets for a single user and store results
 */
export async function checkUserTickets(user: UserToCheck): Promise<void> {
  const { user_id, license_plate, license_state, last_name, email } = user;

  console.log(`\n🚗 Checking tickets for user ${email} (${license_plate})`);

  try {
    // Look up tickets
    const { tickets, rawHtml } = await lookupTickets(license_plate, license_state, last_name);

    // Get existing tickets for this user
    const { data: existingTickets } = await supabaseAdmin
      .from('ticket_snapshots')
      .select('ticket_number')
      .eq('user_id', user_id);

    const existingTicketNumbers = new Set(
      existingTickets?.map(t => t.ticket_number) || []
    );

    let newTicketsCount = 0;

    // Store new tickets
    for (const ticket of tickets) {
      const isNew = !existingTicketNumbers.has(ticket.ticket_number);

      if (isNew) {
        // Insert new ticket
        const { error: insertError } = await supabaseAdmin
          .from('ticket_snapshots')
          .insert({
            user_id,
            license_plate,
            license_state,
            ticket_number: ticket.ticket_number,
            issue_date: ticket.issue_date,
            violation_description: ticket.violation_description,
            amount: ticket.amount,
            status: ticket.status,
            raw_html: rawHtml
          });

        if (!insertError) {
          newTicketsCount++;
          console.log(`  ⚠️  NEW TICKET: ${ticket.ticket_number} - $${ticket.amount}`);

          // TODO: Send alert to user
          // await sendTicketAlert(user_id, ticket);
        }
      } else {
        // Update last_checked_at
        await supabaseAdmin
          .from('ticket_snapshots')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .eq('ticket_number', ticket.ticket_number);
      }
    }

    // Log the check
    await supabaseAdmin
      .from('ticket_check_log')
      .insert({
        user_id,
        license_plate,
        license_state,
        tickets_found: tickets.length,
        new_tickets: newTicketsCount,
        success: true
      });

    console.log(`✅ Done: ${tickets.length} tickets found, ${newTicketsCount} new`);

  } catch (error) {
    console.error(`❌ Error checking user tickets:`, error);

    // Log the failed check
    await supabaseAdmin
      .from('ticket_check_log')
      .insert({
        user_id,
        license_plate,
        license_state,
        success: false,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
  }
}

/**
 * Check tickets for all users who have opted in
 */
export async function checkAllUserTickets(): Promise<void> {
  console.log('🔍 Starting ticket monitoring run...');

  // Get all users with protection tier (or free tier who opted in)
  const { data: users, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, license_plate, license_state, last_name, email')
    .not('license_plate', 'is', null)
    .not('last_name', 'is', null);

  if (error) {
    console.error('Error fetching users:', error);
    return;
  }

  console.log(`📋 Found ${users?.length || 0} users to check`);

  // Check tickets for each user (with rate limiting)
  for (const user of users || []) {
    await checkUserTickets(user as UserToCheck);

    // Rate limit: wait 5 seconds between checks to be polite
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log('✅ Ticket monitoring run complete');
}

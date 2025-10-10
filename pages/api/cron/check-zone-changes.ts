import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * Weekly cron to check if zone boundaries have changed
 * Detects when users move in/out of permit zones due to city rezoning
 * Runs: Weekly on Sundays at 2am
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is a cron job
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    console.log('🔄 Checking for permit zone boundary changes...');

    // Get all Protection users with addresses
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, mailing_address, has_permit_zone, city_sticker_expiry')
      .eq('has_protection', true)
      .not('mailing_address', 'is', null);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} Protection users with addresses`);

    let changesDetected = 0;
    let movedIntoZone = 0;
    let movedOutOfZone = 0;
    const changes: any[] = [];

    for (const user of users || []) {
      try {
        // Check if address is currently in a permit zone
        const zoneCheckResponse = await fetch(
          `${process.env.NEXT_PUBLIC_SITE_URL}/api/check-permit-zone?address=${encodeURIComponent(user.mailing_address)}`
        );

        if (!zoneCheckResponse.ok) {
          console.error(`Failed to check zone for ${user.email}`);
          continue;
        }

        const zoneCheck = await zoneCheckResponse.json();
        const currentlyInZone = zoneCheck.inPermitZone || false;
        const previouslyInZone = user.has_permit_zone || false;

        // Detect change
        if (currentlyInZone !== previouslyInZone) {
          changesDetected++;
          const changeType = currentlyInZone ? 'entered_zone' : 'exited_zone';

          if (currentlyInZone) movedIntoZone++;
          else movedOutOfZone++;

          console.log(`🚨 Zone change detected for ${user.email}: ${changeType}`);

          changes.push({
            email: user.email,
            address: user.mailing_address,
            changeType,
            zones: zoneCheck.zones || []
          });

          // Update database
          await supabaseAdmin
            .from('user_profiles')
            .update({
              has_permit_zone: currentlyInZone,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', user.user_id);

          // Trigger address update flow (which will send emails and create payment links)
          try {
            await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/user/update-address`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: user.user_id,
                newAddress: user.mailing_address
              })
            });
          } catch (updateError) {
            console.error(`Error triggering address update for ${user.email}:`, updateError);
          }
        }
      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
      }

      // Rate limit: wait 100ms between requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send admin summary if changes detected
    if (changesDetected > 0) {
      console.log(`📧 Sending admin summary: ${changesDetected} zone changes`);

      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: 'Ticketless America <noreply@ticketlessamerica.com>',
        to: 'ticketlessamerica@gmail.com',
        subject: `🅿️ Permit Zone Boundary Changes Detected (${changesDetected} users affected)`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Permit Zone Boundary Changes</h2>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-weight: 600; color: #92400e;">
                ${changesDetected} user${changesDetected !== 1 ? 's' : ''} affected by zone boundary changes
              </p>
              <p style="margin: 8px 0 0; color: #78350f;">
                ✅ Moved into zones: ${movedIntoZone}<br>
                ❌ Moved out of zones: ${movedOutOfZone}
              </p>
            </div>

            <h3>Affected Users:</h3>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background: #f3f4f6;">
                  <th style="padding: 12px; text-align: left; border: 1px solid #d1d5db;">Email</th>
                  <th style="padding: 12px; text-align: left; border: 1px solid #d1d5db;">Change</th>
                  <th style="padding: 12px; text-align: left; border: 1px solid #d1d5db;">Address</th>
                </tr>
              </thead>
              <tbody>
                ${changes.map(c => `
                  <tr>
                    <td style="padding: 12px; border: 1px solid #d1d5db;">${c.email}</td>
                    <td style="padding: 12px; border: 1px solid #d1d5db;">
                      ${c.changeType === 'entered_zone'
                        ? '<span style="color: #f59e0b;">➡️ Entered Zone</span>'
                        : '<span style="color: #16a34a;">⬅️ Exited Zone</span>'
                      }
                    </td>
                    <td style="padding: 12px; border: 1px solid #d1d5db; font-size: 12px;">${c.address}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin: 0 0 8px; color: #1e40af;">Automated Actions Taken:</h4>
              <ul style="margin: 8px 0; padding-left: 20px; color: #1e40af;">
                <li>Users who entered zones: Sent payment link for $30 permit fee</li>
                <li>Users who exited zones: Sent refund eligibility notification</li>
                <li>Database updated with new zone status</li>
              </ul>
            </div>
          </div>
        `
      });
    }

    return res.status(200).json({
      success: true,
      message: `Zone boundary check complete`,
      totalChecked: users?.length || 0,
      changesDetected,
      movedIntoZone,
      movedOutOfZone,
      changes
    });

  } catch (error: any) {
    console.error('Zone change check error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

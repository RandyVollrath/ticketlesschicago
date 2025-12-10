import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Remitter One-Click Confirmation
 *
 * Simple GET endpoint that remitters can click from email
 * Shows a form to enter confirmation number
 *
 * GET /api/remitter/confirm?id=renewal_id&type=city_sticker
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id, type, confirmation } = req.query;

  if (!id || !type) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ Invalid Link</h1>
          <p>Missing renewal ID or type.</p>
        </body>
      </html>
    `);
  }

  try {
    // Get renewal details
    const { data: renewal, error } = await supabaseAdmin
      .from('renewal_charges')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !renewal) {
      return res.status(404).send(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>❌ Renewal Not Found</h1>
            <p>ID: ${id}</p>
          </body>
        </html>
      `);
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('email, first_name, last_name, license_plate')
      .eq('user_id', renewal.user_id)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).send(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>❌ User Profile Not Found</h1>
            <p>User ID: ${renewal.user_id}</p>
          </body>
        </html>
      `);
    }

    // Attach user profile to renewal for template compatibility
    const renewalWithProfile = { ...renewal, user_profiles: userProfile };

    // If already confirmed
    if (renewalWithProfile.metadata?.city_payment_status === 'paid') {
      return res.status(200).send(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #10b981;">✅ Already Confirmed</h1>
            <p>This renewal was already marked as submitted.</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-top: 20px;">
              <p><strong>Confirmation #:</strong> ${renewalWithProfile.metadata?.city_confirmation_number || 'N/A'}</p>
              <p><strong>Confirmed:</strong> ${new Date(renewal.updated_at).toLocaleString()}</p>
            </div>
          </body>
        </html>
      `);
    }

    // If confirmation number provided, process it
    if (confirmation) {
      // Update status in metadata
      const { error: updateError } = await supabaseAdmin
        .from('renewal_charges')
        .update({
          metadata: {
            ...renewal.metadata,
            city_payment_status: 'paid',
            city_confirmation_number: confirmation as string,
            remitter_confirmed_at: new Date().toISOString(),
            remitter_confirmed_via: 'email_link'
          }
        })
        .eq('id', id);

      if (updateError) {
        return res.status(500).send(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>❌ Update Failed</h1>
              <p>An error occurred while updating the renewal status.</p>
            </body>
          </html>
        `);
      }

      // Auto-update user's expiry date
      const currentDueDate = new Date(renewal.renewal_due_date);
      const nextYearDueDate = new Date(currentDueDate);
      nextYearDueDate.setFullYear(nextYearDueDate.getFullYear() + 1);
      const nextYearDueDateStr = nextYearDueDate.toISOString().split('T')[0];

      const expiryField =
        renewal.renewal_type === 'city_sticker' ? 'city_sticker_expiry' : 'license_plate_expiry';

      await supabaseAdmin
        .from('user_profiles')
        .update({
          [expiryField]: nextYearDueDateStr
        })
        .eq('user_id', renewal.user_id);

      return res.status(200).send(`
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Confirmation Successful</title>
          </head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #10b981;">✅ Successfully Confirmed!</h1>
            <p style="font-size: 18px; color: #6b7280;">
              ${renewalWithProfile.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'} renewal marked as submitted.
            </p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-top: 20px; text-align: left;">
              <p><strong>User:</strong> ${renewalWithProfile.user_profiles.first_name} ${renewalWithProfile.user_profiles.last_name}</p>
              <p><strong>Plate:</strong> ${renewalWithProfile.user_profiles.license_plate}</p>
              <p><strong>Confirmation #:</strong> ${confirmation}</p>
              <p><strong>Expiry Updated:</strong> ${renewalWithProfile.renewal_due_date} → ${nextYearDueDateStr}</p>
            </div>
            <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
              You can close this window now.
            </p>
          </body>
        </html>
      `);
    }

    // Show confirmation form (userProfile already defined at top)
    return res.status(200).send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Renewal Submission</title>
        </head>
        <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Autopilot America</h1>
            <p style="margin: 8px 0 0;">Remitter Confirmation</p>
          </div>

          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 30px; margin-top: 20px;">
            <h2 style="margin: 0 0 20px; color: #1f2937;">
              ${renewalWithProfile.renewal_type === 'city_sticker' ? '🏙️ City Sticker' : '🚗 License Plate'} Renewal
            </h2>

            <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
              <p style="margin: 0 0 8px;"><strong>User:</strong> ${userProfile.first_name} ${userProfile.last_name}</p>
              <p style="margin: 0 0 8px;"><strong>Email:</strong> ${userProfile.email}</p>
              <p style="margin: 0 0 8px;"><strong>Plate:</strong> ${userProfile.license_plate}</p>
              <p style="margin: 0;"><strong>Due Date:</strong> ${new Date(renewalWithProfile.renewal_due_date).toLocaleDateString()}</p>
            </div>

            <form method="GET" style="margin-top: 30px;">
              <input type="hidden" name="id" value="${id}">
              <input type="hidden" name="type" value="${type}">

              <label for="confirmation" style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151;">
                City Confirmation Number:
              </label>
              <input
                type="text"
                id="confirmation"
                name="confirmation"
                required
                placeholder="CHI-2025-12345"
                style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; box-sizing: border-box;"
              >

              <button
                type="submit"
                style="width: 100%; margin-top: 20px; background: #10b981; color: white; padding: 14px; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer;"
              >
                ✅ Confirm Submission
              </button>
            </form>

            <p style="margin-top: 20px; font-size: 14px; color: #6b7280; text-align: center;">
              This will mark the renewal as paid and update the user's expiry date to next year.
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Error in remitter confirm:', error);
    return res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ Error</h1>
          <p>An unexpected error occurred. Please try again or contact support.</p>
        </body>
      </html>
    `);
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_AUTOPILOT_PLAN } from './autopilot-plans';

export async function requestInitialPortalCheckForUser(
  supabaseAdmin: SupabaseClient,
  userId: string,
  source: string,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await (supabaseAdmin.from('monitored_plates') as any)
      .update({
        last_checked_at: null,
        updated_at: now,
      })
      .eq('user_id', userId)
      .eq('status', 'active');
  } catch (error) {
    console.error(`Failed to prioritize plate checks for user ${userId}:`, error);
  }

  try {
    const { data: existingTrigger } = await (supabaseAdmin.from('autopilot_admin_settings') as any)
      .select('value')
      .eq('key', 'portal_check_trigger')
      .maybeSingle();

    if ((existingTrigger?.value as any)?.status !== 'pending') {
      await (supabaseAdmin.from('autopilot_admin_settings') as any)
        .upsert({
          key: 'portal_check_trigger',
          value: {
            status: 'pending',
            requested_at: now,
            requested_by: `signup:${userId}`,
            source,
          },
          updated_at: now,
        }, { onConflict: 'key' });
    }
  } catch (error) {
    console.error(`Failed to queue portal check trigger for user ${userId}:`, error);
  }

  try {
    await (supabaseAdmin.from('ticket_audit_log') as any)
      .insert({
        ticket_id: null,
        user_id: userId,
        action: 'signup_portal_check_requested',
        details: {
          source,
          requested_at: now,
        },
        performed_by: 'stripe_webhook',
      });
  } catch (error) {
    console.error(`Failed to write portal check audit log for user ${userId}:`, error);
  }
}

export async function ensureAutopilotEnrollment(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    plate?: string | null;
    state?: string | null;
    source: string;
    planCode?: string | null;
    priceCents?: number | null;
  },
): Promise<{
  createdOrUpdatedSubscription: boolean;
  createdOrUpdatedPlate: boolean;
}> {
  const now = new Date().toISOString();
  const plate = params.plate?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const state = (params.state || 'IL').toUpperCase();

  let createdOrUpdatedSubscription = false;
  let createdOrUpdatedPlate = false;

  const subscriptionPayload = {
    user_id: params.userId,
    plan: 'autopilot',
    plan_code: params.planCode || ACTIVE_AUTOPILOT_PLAN.code,
    status: 'active',
    stripe_subscription_id: params.stripeSubscriptionId || null,
    stripe_customer_id: params.stripeCustomerId || null,
    letters_included_remaining: 999,
    price_cents: params.priceCents ?? ACTIVE_AUTOPILOT_PLAN.priceCents,
    price_lock: ACTIVE_AUTOPILOT_PLAN.priceLock,
    price_lock_cents: ACTIVE_AUTOPILOT_PLAN.priceLockCents,
    price_lock_expires_at: null,
    grace_period_days: ACTIVE_AUTOPILOT_PLAN.gracePeriodDays,
    authorized_at: now,
    updated_at: now,
  };

  const { error: subscriptionError } = await (supabaseAdmin.from('autopilot_subscriptions') as any)
    .upsert(subscriptionPayload, { onConflict: 'user_id' });

  if (subscriptionError) {
    throw new Error(`Failed to ensure autopilot_subscriptions for ${params.userId}: ${subscriptionError.message}`);
  }
  createdOrUpdatedSubscription = true;

  if (plate) {
    const { data: existingPlate, error: existingPlateError } = await (supabaseAdmin.from('monitored_plates') as any)
      .select('id')
      .eq('user_id', params.userId)
      .eq('plate', plate)
      .eq('state', state)
      .maybeSingle();

    if (existingPlateError) {
      throw new Error(`Failed to look up monitored_plates for ${params.userId}: ${existingPlateError.message}`);
    }

    if (existingPlate?.id) {
      const { error: plateUpdateError } = await (supabaseAdmin.from('monitored_plates') as any)
        .update({
          status: 'active',
          is_leased_or_company: false,
          updated_at: now,
        })
        .eq('id', existingPlate.id);

      if (plateUpdateError) {
        throw new Error(`Failed to update monitored_plates for ${params.userId}: ${plateUpdateError.message}`);
      }
    } else {
      const { error: plateInsertError } = await (supabaseAdmin.from('monitored_plates') as any)
        .insert({
          user_id: params.userId,
          plate,
          state,
          status: 'active',
          is_leased_or_company: false,
          updated_at: now,
        });

      if (plateInsertError) {
        throw new Error(`Failed to insert monitored_plates for ${params.userId}: ${plateInsertError.message}`);
      }
    }
    createdOrUpdatedPlate = true;
  }

  await requestInitialPortalCheckForUser(supabaseAdmin, params.userId, params.source);

  return {
    createdOrUpdatedSubscription,
    createdOrUpdatedPlate,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

export const CONTEST_LIFECYCLE_STATUSES = [
  'draft',
  'approved',
  'submitted',
  'submission_confirmed',
  'under_review',
  'hearing_scheduled',
  'awaiting_user_action',
  'won',
  'lost',
  'reduced',
  'autopay_pending',
  'paid',
  'payment_failed',
  'closed',
] as const;

export type ContestLifecycleStatus = typeof CONTEST_LIFECYCLE_STATUSES[number];

export type ContestAutopayMode =
  | 'off'
  | 'full_if_lost'
  | 'up_to_cap'
  | 'payment_plan_only'
  | 'ask_first';

export function mapLifecycleStatusToLegacyLetterStatus(status: ContestLifecycleStatus): string {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'approved':
      return 'approved';
    case 'hearing_scheduled':
      return 'hearing_scheduled';
    case 'won':
      return 'won';
    case 'lost':
      return 'lost';
    case 'reduced':
      return 'reduced';
    case 'paid':
      return 'paid';
    case 'payment_failed':
      return 'payment_failed';
    default:
      return 'sent';
  }
}

export function mapLifecycleStatusToTicketStatus(status: ContestLifecycleStatus): string | null {
  switch (status) {
    case 'submission_confirmed':
    case 'submitted':
    case 'under_review':
      return 'contested_online';
    case 'hearing_scheduled':
      return 'hearing_scheduled';
    case 'won':
      return 'won';
    case 'lost':
      return 'lost';
    case 'reduced':
      return 'reduced';
    case 'paid':
      return 'paid';
    default:
      return null;
  }
}

export function normalizeDispositionToLifecycleStatus(input: {
  hearingDisposition?: string | null;
  ticketQueue?: string | null;
  currentAmountDue?: number | null;
  originalAmount?: number | null;
}): ContestLifecycleStatus | null {
  const disposition = (input.hearingDisposition || '').toLowerCase().trim();
  const queue = (input.ticketQueue || '').toLowerCase().trim();
  const currentAmount = input.currentAmountDue ?? null;
  const originalAmount = input.originalAmount ?? null;

  if (disposition === 'not liable' || disposition === 'dismissed' || disposition === 'not guilty') {
    return 'won';
  }

  if (disposition === 'liable' || disposition === 'guilty' || disposition === 'default') {
    if (
      currentAmount !== null &&
      originalAmount !== null &&
      currentAmount > 0 &&
      originalAmount > 0 &&
      currentAmount < originalAmount
    ) {
      return 'reduced';
    }
    return 'lost';
  }

  if (queue.includes('hearing')) {
    return 'hearing_scheduled';
  }

  if (queue || disposition) {
    return 'under_review';
  }

  return null;
}

export async function recordContestStatusEvent(
  supabase: SupabaseClient,
  params: {
    contestLetterId: string;
    ticketId: string;
    userId: string;
    eventType: string;
    source: string;
    normalizedStatus?: string | null;
    rawStatus?: string | null;
    details?: Record<string, unknown> | null;
    observedAt?: string;
  },
): Promise<void> {
  const payload = {
    contest_letter_id: params.contestLetterId,
    ticket_id: params.ticketId,
    user_id: params.userId,
    event_type: params.eventType,
    source: params.source,
    observed_at: params.observedAt || new Date().toISOString(),
    normalized_status: params.normalizedStatus ?? null,
    raw_status: params.rawStatus ?? null,
    details: params.details ?? null,
  };

  const { error } = await (supabase.from('contest_status_events') as any).insert(payload);
  if (error) {
    console.warn(`Failed to record contest_status_events for ${params.contestLetterId}: ${error.message}`);
  }
}

export async function updateContestLifecycle(
  supabase: SupabaseClient,
  params: {
    contestLetterId: string;
    ticketId: string;
    userId: string;
    lifecycleStatus: ContestLifecycleStatus;
    source: string;
    rawStatus?: string | null;
    cityCasePayload?: Record<string, unknown> | null;
    eventType: string;
    eventDetails?: Record<string, unknown> | null;
    contestLetterPatch?: Record<string, unknown>;
    ticketStatusPatch?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const legacyLetterStatus = mapLifecycleStatusToLegacyLetterStatus(params.lifecycleStatus);
  const mappedTicketStatus = mapLifecycleStatusToTicketStatus(params.lifecycleStatus);

  const contestLetterUpdate = {
    lifecycle_status: params.lifecycleStatus,
    lifecycle_status_changed_at: now,
    last_status_source: params.source,
    last_status_check_at: now,
    city_case_status_raw: params.rawStatus ?? null,
    city_case_payload: params.cityCasePayload ?? null,
    status: legacyLetterStatus,
    updated_at: now,
    ...(params.contestLetterPatch || {}),
  };

  const { error: letterError } = await (supabase.from('contest_letters') as any)
    .update(contestLetterUpdate)
    .eq('id', params.contestLetterId);

  if (letterError) {
    throw new Error(`Failed to update contest_letters ${params.contestLetterId}: ${letterError.message}`);
  }

  const ticketUpdate = {
    ...(mappedTicketStatus ? { status: mappedTicketStatus } : {}),
    ...(params.ticketStatusPatch || {}),
  };

  if (Object.keys(ticketUpdate).length > 0) {
    const { error: ticketError } = await (supabase.from('detected_tickets') as any)
      .update(ticketUpdate)
      .eq('id', params.ticketId);
    if (ticketError) {
      console.warn(`Failed to update detected_tickets ${params.ticketId}: ${ticketError.message}`);
    }
  }

  await recordContestStatusEvent(supabase, {
    contestLetterId: params.contestLetterId,
    ticketId: params.ticketId,
    userId: params.userId,
    eventType: params.eventType,
    source: params.source,
    normalizedStatus: params.lifecycleStatus,
    rawStatus: params.rawStatus,
    details: params.eventDetails || params.cityCasePayload || null,
    observedAt: now,
  });
}

export function evaluateAutopayEligibility(params: {
  lifecycleStatus: ContestLifecycleStatus;
  autopayOptIn?: boolean | null;
  autopayMode?: string | null;
  autopayCapAmount?: number | null;
  paymentMethodId?: string | null;
  finalAmount?: number | null;
}): {
  eligible: boolean;
  status: 'not_enabled' | 'eligible' | 'blocked';
  reason: string;
} {
  if (!params.autopayOptIn || !params.autopayMode || params.autopayMode === 'off') {
    return { eligible: false, status: 'not_enabled', reason: 'Autopay not enabled' };
  }

  if (params.lifecycleStatus !== 'lost' && params.lifecycleStatus !== 'reduced') {
    return { eligible: false, status: 'blocked', reason: 'Ticket is not in a payable terminal state' };
  }

  if (!params.paymentMethodId && params.autopayMode !== 'ask_first' && params.autopayMode !== 'payment_plan_only') {
    return { eligible: false, status: 'blocked', reason: 'Missing stored payment method' };
  }

  if (params.autopayMode === 'up_to_cap') {
    if (params.autopayCapAmount == null) {
      return { eligible: false, status: 'blocked', reason: 'Autopay cap amount is missing' };
    }
    if ((params.finalAmount ?? 0) > params.autopayCapAmount) {
      return { eligible: false, status: 'blocked', reason: 'Final amount exceeds autopay cap' };
    }
  }

  if (params.autopayMode === 'ask_first') {
    return { eligible: false, status: 'blocked', reason: 'Autopay requires manual confirmation first' };
  }

  return { eligible: true, status: 'eligible', reason: 'Autopay policy allows payment attempt' };
}

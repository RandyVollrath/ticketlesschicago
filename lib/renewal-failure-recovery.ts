// Tracks per-type renewal failures and trips a circuit breaker when too many
// fail in a row. Once tripped, the cron should skip that renewal type until
// scripts/reset-renewal-circuit-breaker.ts is run.
//
// "Invalid credentials" failures are NOT counted toward the breaker — those
// are a per-user problem (state re-plated them) not a system-wide failure.
// They're already handled by setting il_credentials_invalid_at on the user
// and surfacing the warning banner in Settings UI.

import { supabaseAdmin as typedSupabase } from './supabase';

const supabaseAdmin = typedSupabase as any;

export type RenewalType = 'city_sticker' | 'license_plate';

export const CIRCUIT_BREAKER_THRESHOLD = 3;

export interface CircuitBreakerState {
  renewal_type: RenewalType;
  consecutive_failures: number;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  paused_at: string | null;
  paused_reason: string | null;
  last_success_at: string | null;
}

export class CircuitBreakerTrippedError extends Error {
  constructor(type: RenewalType, reason: string) {
    super(`Circuit breaker tripped for ${type}: ${reason}`);
    this.name = 'CircuitBreakerTrippedError';
  }
}

export async function getCircuitBreaker(type: RenewalType): Promise<CircuitBreakerState | null> {
  const { data, error } = await supabaseAdmin
    .from('renewal_circuit_breakers')
    .select('*')
    .eq('renewal_type', type)
    .maybeSingle();
  if (error) throw new Error(`getCircuitBreaker: ${error.message}`);
  return (data as CircuitBreakerState) ?? null;
}

export async function isCircuitTripped(type: RenewalType): Promise<boolean> {
  const cb = await getCircuitBreaker(type);
  return Boolean(cb?.paused_at);
}

export async function assertCircuitClosed(type: RenewalType): Promise<void> {
  const cb = await getCircuitBreaker(type);
  if (cb?.paused_at) {
    throw new CircuitBreakerTrippedError(type, cb.paused_reason || 'too many consecutive failures');
  }
}

export async function recordRenewalSuccess(type: RenewalType): Promise<void> {
  await supabaseAdmin
    .from('renewal_circuit_breakers')
    .update({
      consecutive_failures: 0,
      last_success_at: new Date().toISOString(),
      paused_at: null,
      paused_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('renewal_type', type);
}

/**
 * Increment the consecutive-failure counter. If we cross the threshold, set
 * paused_at + paused_reason so future calls to assertCircuitClosed() throw.
 *
 * Pass `excludeFromBreaker: true` for failures that are per-user-correctable
 * (e.g. PIN rejected) — we still record the timestamp/reason but do not
 * increment the consecutive-failure count.
 */
export async function recordRenewalFailure(
  type: RenewalType,
  reason: string,
  options: { excludeFromBreaker?: boolean } = {},
): Promise<{ tripped: boolean; consecutive: number }> {
  const cb = await getCircuitBreaker(type);
  const current = cb?.consecutive_failures ?? 0;
  const next = options.excludeFromBreaker ? current : current + 1;
  const willTrip = !options.excludeFromBreaker && next >= CIRCUIT_BREAKER_THRESHOLD && !cb?.paused_at;

  await supabaseAdmin
    .from('renewal_circuit_breakers')
    .update({
      consecutive_failures: next,
      last_failure_at: new Date().toISOString(),
      last_failure_reason: reason.slice(0, 500),
      ...(willTrip
        ? {
            paused_at: new Date().toISOString(),
            paused_reason: `Auto-paused after ${next} consecutive failures. Last reason: ${reason.slice(0, 200)}`,
          }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('renewal_type', type);

  return { tripped: willTrip, consecutive: next };
}

export async function resetCircuitBreaker(type: RenewalType, by: string): Promise<void> {
  await supabaseAdmin
    .from('renewal_circuit_breakers')
    .update({
      consecutive_failures: 0,
      paused_at: null,
      paused_reason: null,
      manually_reset_at: new Date().toISOString(),
      manually_reset_by: by,
      updated_at: new Date().toISOString(),
    })
    .eq('renewal_type', type);
}

/**
 * Inspect a result from purchaseCitySticker / purchasePlateSticker and route
 * it to the right tracker. Invalid-credentials failures bypass the breaker.
 */
export async function reportRenewalResult(
  type: RenewalType,
  result: { success: boolean; error?: string; stoppedAt?: string; invalidCredentialsDetected?: boolean },
): Promise<void> {
  if (result.success) {
    await recordRenewalSuccess(type);
    return;
  }
  const excluded =
    result.invalidCredentialsDetected ||
    result.stoppedAt === 'missing_credentials' ||
    result.stoppedAt === 'invalid_credentials' ||
    result.stoppedAt === 'gate' ||
    result.stoppedAt === 'consent' ||
    result.stoppedAt === 'payment_not_configured';
  await recordRenewalFailure(type, `${result.stoppedAt || 'unknown'}: ${result.error || 'failed'}`, { excludeFromBreaker: excluded });
}

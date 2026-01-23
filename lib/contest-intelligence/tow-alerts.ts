// @ts-nocheck
/**
 * Tow/Boot Alert Integration
 *
 * Monitors for towed/booted vehicles using Chicago's data portals
 * and alerts users before fees accumulate.
 */

import { createClient } from '@supabase/supabase-js';
import {
  TowBootAlert,
  TowAlertType,
  TowAlertStatus,
} from './types';

// Chicago impound lot information
const CHICAGO_IMPOUND_LOTS: Record<string, { name: string; address: string; phone: string }> = {
  '701': {
    name: 'O\'Hare Auto Pound',
    address: '10301 W Zemke Rd, Chicago, IL 60666',
    phone: '312-744-7550',
  },
  '702': {
    name: '103rd Street Auto Pound',
    address: '10300 S Doty Ave, Chicago, IL 60628',
    phone: '312-744-4444',
  },
  '705': {
    name: 'North Auto Pound',
    address: '3353 S Sacramento Ave, Chicago, IL 60623',
    phone: '312-744-1771',
  },
  '706': {
    name: '215 N Sacramento Auto Pound',
    address: '215 N Sacramento Blvd, Chicago, IL 60612',
    phone: '312-744-2584',
  },
  '707': {
    name: 'Foster Auto Pound',
    address: '5231 N Foster Ave, Chicago, IL 60630',
    phone: '312-744-9494',
  },
};

// Current Chicago tow and storage fees (as of 2024)
const CHICAGO_TOW_FEES = {
  tow_fee: 150,
  boot_fee: 100,
  daily_storage: 25,
  administrative_fee: 60,
  release_fee: 25,
};

/**
 * Create a new tow/boot alert
 */
export async function createTowAlert(
  supabase: ReturnType<typeof createClient>,
  alert: Omit<TowBootAlert, 'id' | 'status' | 'user_notified' | 'created_at'>
): Promise<TowBootAlert | null> {
  const { data, error } = await supabase
    .from('tow_boot_alerts')
    .insert({
      user_id: alert.user_id,
      vehicle_id: alert.vehicle_id,
      alert_type: alert.alert_type,
      plate: alert.plate.toUpperCase(),
      state: alert.state.toUpperCase(),
      tow_location: alert.tow_location,
      impound_location: alert.impound_location,
      impound_address: alert.impound_address,
      impound_phone: alert.impound_phone,
      tow_date: alert.tow_date,
      discovered_at: alert.discovered_at || new Date().toISOString(),
      related_ticket_ids: alert.related_ticket_ids,
      total_ticket_amount: alert.total_ticket_amount,
      tow_fee: alert.tow_fee || CHICAGO_TOW_FEES.tow_fee,
      daily_storage_fee: alert.daily_storage_fee || CHICAGO_TOW_FEES.daily_storage,
      boot_fee: alert.alert_type === 'boot' ? CHICAGO_TOW_FEES.boot_fee : undefined,
      total_fees: alert.total_fees,
      status: 'active',
      contesting_tow: alert.contesting_tow || false,
      user_notified: false,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error creating tow alert:', error);
    return null;
  }

  return mapToTowAlert(data);
}

/**
 * Get active alerts for a user
 */
export async function getUserActiveAlerts(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<TowBootAlert[]> {
  const { data, error } = await supabase
    .from('tow_boot_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('discovered_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map(mapToTowAlert);
}

/**
 * Get all alerts for a user
 */
export async function getUserAlerts(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  options?: {
    status?: TowAlertStatus;
    limit?: number;
    offset?: number;
  }
): Promise<TowBootAlert[]> {
  let query = supabase
    .from('tow_boot_alerts')
    .select('*')
    .eq('user_id', userId)
    .order('discovered_at', { ascending: false });

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map(mapToTowAlert);
}

/**
 * Get alert by ID
 */
export async function getAlert(
  supabase: ReturnType<typeof createClient>,
  alertId: string
): Promise<TowBootAlert | null> {
  const { data, error } = await supabase
    .from('tow_boot_alerts')
    .select('*')
    .eq('id', alertId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapToTowAlert(data);
}

/**
 * Check for towed vehicles by plate (to be called by cron job)
 */
export async function checkForTowedVehicle(
  supabase: ReturnType<typeof createClient>,
  plate: string,
  state: string
): Promise<{
  found: boolean;
  towData?: {
    tow_date: string;
    tow_location: string;
    impound_location: string;
    impound_address: string;
    impound_phone: string;
  };
}> {
  // This would integrate with Chicago's towed vehicle API
  // https://data.cityofchicago.org/resource/ygr5-vcbg.json
  // For now, return structure for integration

  // NOTE: Real implementation would call:
  // const response = await fetch(
  //   `https://data.cityofchicago.org/resource/ygr5-vcbg.json?plate=${plate}&state=${state}`
  // );

  return { found: false };
}

/**
 * Mark alert as notified
 */
export async function markAlertNotified(
  supabase: ReturnType<typeof createClient>,
  alertId: string,
  notificationMethod: string
): Promise<boolean> {
  const { error } = await supabase
    .from('tow_boot_alerts')
    .update({
      user_notified: true,
      notified_at: new Date().toISOString(),
      notification_method: notificationMethod,
    })
    .eq('id', alertId);

  return !error;
}

/**
 * Update alert status
 */
export async function updateAlertStatus(
  supabase: ReturnType<typeof createClient>,
  alertId: string,
  status: TowAlertStatus,
  details?: {
    resolved_at?: string;
    amount_paid?: number;
    amount_waived?: number;
  }
): Promise<boolean> {
  const updates: any = { status };

  if (status === 'resolved' || status === 'vehicle_retrieved') {
    updates.resolved_at = details?.resolved_at || new Date().toISOString();
    if (details?.amount_paid !== undefined) updates.amount_paid = details.amount_paid;
    if (details?.amount_waived !== undefined) updates.amount_waived = details.amount_waived;
  }

  const { error } = await supabase
    .from('tow_boot_alerts')
    .update(updates)
    .eq('id', alertId);

  return !error;
}

/**
 * Mark that user is contesting the tow
 */
export async function markTowContested(
  supabase: ReturnType<typeof createClient>,
  alertId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('tow_boot_alerts')
    .update({
      contesting_tow: true,
      tow_contest_filed_at: new Date().toISOString(),
      status: 'contested',
    })
    .eq('id', alertId);

  return !error;
}

/**
 * Record tow contest outcome
 */
export async function recordTowContestOutcome(
  supabase: ReturnType<typeof createClient>,
  alertId: string,
  outcome: string,
  amountWaived?: number
): Promise<boolean> {
  const { error } = await supabase
    .from('tow_boot_alerts')
    .update({
      tow_contest_outcome: outcome,
      amount_waived: amountWaived,
      status: outcome.toLowerCase().includes('won') || outcome.toLowerCase().includes('waived')
        ? 'resolved'
        : 'active',
    })
    .eq('id', alertId);

  return !error;
}

/**
 * Calculate current total fees for an active alert
 */
export function calculateCurrentFees(alert: TowBootAlert): {
  tow_fee: number;
  boot_fee: number;
  storage_fees: number;
  administrative_fees: number;
  total: number;
  days_stored: number;
} {
  const towDate = alert.tow_date ? new Date(alert.tow_date) : new Date(alert.discovered_at);
  const now = new Date();
  const daysStored = Math.max(1, Math.ceil((now.getTime() - towDate.getTime()) / (1000 * 60 * 60 * 24)));

  const towFee = alert.alert_type === 'tow' || alert.alert_type === 'impound'
    ? (alert.tow_fee || CHICAGO_TOW_FEES.tow_fee)
    : 0;

  const bootFee = alert.alert_type === 'boot'
    ? (alert.boot_fee || CHICAGO_TOW_FEES.boot_fee)
    : 0;

  const dailyStorageFee = alert.daily_storage_fee || CHICAGO_TOW_FEES.daily_storage;
  const storageFees = alert.alert_type === 'tow' || alert.alert_type === 'impound'
    ? dailyStorageFee * daysStored
    : 0;

  const administrativeFees = CHICAGO_TOW_FEES.administrative_fee + CHICAGO_TOW_FEES.release_fee;

  return {
    tow_fee: towFee,
    boot_fee: bootFee,
    storage_fees: storageFees,
    administrative_fees: administrativeFees,
    total: towFee + bootFee + storageFees + administrativeFees + (alert.total_ticket_amount || 0),
    days_stored: daysStored,
  };
}

/**
 * Get impound lot info by ID
 */
export function getImpoundLotInfo(lotId: string): { name: string; address: string; phone: string } | null {
  return CHICAGO_IMPOUND_LOTS[lotId] || null;
}

/**
 * Get all impound lot information
 */
export function getAllImpoundLots(): Array<{ id: string; name: string; address: string; phone: string }> {
  return Object.entries(CHICAGO_IMPOUND_LOTS).map(([id, info]) => ({
    id,
    ...info,
  }));
}

/**
 * Generate retrieval instructions for user
 */
export function generateRetrievalInstructions(alert: TowBootAlert): string[] {
  const instructions: string[] = [];

  if (alert.alert_type === 'boot') {
    instructions.push('Your vehicle has been booted. You must pay all outstanding tickets to have the boot removed.');
    instructions.push('Call 312-744-7275 to request boot removal after payment.');
    instructions.push('Payment can be made online at www.cityofchicago.org/parking or at a payment center.');
    instructions.push('Have your plate number and vehicle information ready.');
    instructions.push('Boot removal typically occurs within 4-6 hours of payment.');
  } else {
    instructions.push(`Your vehicle is at: ${alert.impound_address || 'an impound lot'}`);

    if (alert.impound_phone) {
      instructions.push(`Call ${alert.impound_phone} to confirm your vehicle is there.`);
    }

    instructions.push('Required documents to retrieve your vehicle:');
    instructions.push('  - Valid driver\'s license');
    instructions.push('  - Proof of vehicle ownership (title or registration)');
    instructions.push('  - Payment for all outstanding tickets and tow/storage fees');

    instructions.push('Payment methods accepted: Cash, credit/debit card, money order');

    instructions.push('Important: Storage fees increase daily. Retrieve your vehicle as soon as possible.');

    if (alert.total_ticket_amount && alert.total_ticket_amount > 0) {
      instructions.push(`Outstanding ticket amount: $${alert.total_ticket_amount.toFixed(2)}`);
    }

    const fees = calculateCurrentFees(alert);
    instructions.push(`Estimated current total (including ${fees.days_stored} days storage): $${fees.total.toFixed(2)}`);
  }

  return instructions;
}

/**
 * Check if alert qualifies for contest (wrongful tow)
 */
export function evaluateTowContestEligibility(
  alert: TowBootAlert,
  relatedTicketStatuses?: Array<{ ticket_id: string; status: string; contested: boolean }>
): {
  eligible: boolean;
  reasons: string[];
  recommendations: string[];
} {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let eligible = false;

  // Check if any related tickets are being contested
  if (relatedTicketStatuses) {
    const contestedTickets = relatedTicketStatuses.filter(t => t.contested);
    if (contestedTickets.length > 0) {
      eligible = true;
      reasons.push(`${contestedTickets.length} related ticket(s) are being contested.`);
      recommendations.push('If your ticket contest is successful, you may be entitled to tow fee reimbursement.');
    }

    const dismissedTickets = relatedTicketStatuses.filter(t =>
      t.status === 'dismissed' || t.status === 'not_liable'
    );
    if (dismissedTickets.length > 0) {
      eligible = true;
      reasons.push(`${dismissedTickets.length} related ticket(s) have been dismissed.`);
      recommendations.push('You may be eligible for a refund of tow fees if the underlying ticket was wrongfully issued.');
    }
  }

  // General eligibility considerations
  if (alert.alert_type === 'tow' || alert.alert_type === 'impound') {
    recommendations.push('You can contest a tow if:');
    recommendations.push('  - The underlying ticket was invalid');
    recommendations.push('  - Proper signage was not posted');
    recommendations.push('  - The tow was conducted improperly');
    recommendations.push('  - You were not the owner/driver at time of violation');
  }

  if (alert.alert_type === 'boot') {
    recommendations.push('You can contest a boot if:');
    recommendations.push('  - You believe your tickets were issued in error');
    recommendations.push('  - You have paid tickets that are incorrectly showing unpaid');
    recommendations.push('  - The boot was placed incorrectly or damaged your vehicle');
  }

  return { eligible, reasons, recommendations };
}

/**
 * Map database row to TowBootAlert
 */
function mapToTowAlert(data: any): TowBootAlert {
  return {
    id: data.id,
    user_id: data.user_id,
    vehicle_id: data.vehicle_id,
    alert_type: data.alert_type,
    plate: data.plate,
    state: data.state,
    tow_location: data.tow_location,
    impound_location: data.impound_location,
    impound_address: data.impound_address,
    impound_phone: data.impound_phone,
    tow_date: data.tow_date,
    discovered_at: data.discovered_at,
    related_ticket_ids: data.related_ticket_ids || [],
    total_ticket_amount: data.total_ticket_amount,
    tow_fee: data.tow_fee,
    daily_storage_fee: data.daily_storage_fee,
    boot_fee: data.boot_fee,
    total_fees: data.total_fees,
    status: data.status,
    contesting_tow: data.contesting_tow || false,
    tow_contest_filed_at: data.tow_contest_filed_at,
    tow_contest_outcome: data.tow_contest_outcome,
    user_notified: data.user_notified || false,
    notified_at: data.notified_at,
    notification_method: data.notification_method,
    resolved_at: data.resolved_at,
    amount_paid: data.amount_paid,
    amount_waived: data.amount_waived,
    created_at: data.created_at,
  };
}

/**
 * Format alert type for display
 */
export function formatAlertType(type: TowAlertType): string {
  const formats: Record<TowAlertType, string> = {
    tow: 'Towed Vehicle',
    boot: 'Booted Vehicle',
    impound: 'Impounded Vehicle',
  };
  return formats[type] || type;
}

/**
 * Format alert status for display
 */
export function formatAlertStatus(status: TowAlertStatus): string {
  const formats: Record<TowAlertStatus, string> = {
    active: 'Active',
    resolved: 'Resolved',
    vehicle_retrieved: 'Vehicle Retrieved',
    contested: 'Under Contest',
  };
  return formats[status] || status;
}

export { CHICAGO_IMPOUND_LOTS, CHICAGO_TOW_FEES };

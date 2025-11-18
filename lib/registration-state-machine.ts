import { supabaseAdmin } from './supabase';

/**
 * Registration State Machine
 *
 * Manages the lifecycle of vehicle registration requests
 * Ensures valid state transitions and logs all changes
 */

export type RegistrationState =
  | 'idle'
  | 'started'
  | 'needs_info'
  | 'info_complete'
  | 'awaiting_submission'
  | 'submitted'
  | 'processing'
  | 'delayed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RegistrationStateTransition {
  registrationId: string;
  toState: RegistrationState;
  changedBy: string; // user_id, 'system', 'remitter', or 'admin'
  reason?: string;
}

/**
 * Valid state transitions
 * Maps current state → allowed next states
 */
const VALID_TRANSITIONS: Record<RegistrationState, RegistrationState[]> = {
  idle: ['started'],
  started: ['needs_info', 'info_complete', 'cancelled'],
  needs_info: ['info_complete', 'cancelled'],
  info_complete: ['awaiting_submission', 'needs_info', 'cancelled'],
  awaiting_submission: ['submitted', 'needs_info', 'cancelled'],
  submitted: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'delayed', 'failed'],
  delayed: ['processing', 'failed', 'cancelled'],
  completed: [], // Terminal state
  failed: ['started'], // Can retry
  cancelled: ['started'] // Can restart
};

/**
 * Transition a registration to a new state
 * Validates the transition is allowed and logs the change
 */
export async function transitionRegistrationState(
  params: RegistrationStateTransition
): Promise<{ success: boolean; error?: string; oldState?: RegistrationState }> {
  try {
    const { registrationId, toState, changedBy, reason } = params;

    // Get current registration
    const { data: registration, error: fetchError } = await supabaseAdmin
      .from('registrations')
      .select('state')
      .eq('id', registrationId)
      .single();

    if (fetchError || !registration) {
      return {
        success: false,
        error: 'Registration not found'
      };
    }

    const currentState = registration.state as RegistrationState;

    // Check if transition is valid
    const allowedTransitions = VALID_TRANSITIONS[currentState];
    if (!allowedTransitions.includes(toState)) {
      return {
        success: false,
        error: `Invalid transition: ${currentState} → ${toState}. Allowed: ${allowedTransitions.join(', ')}`,
        oldState: currentState
      };
    }

    // Perform the transition
    const { error: updateError } = await supabaseAdmin
      .from('registrations')
      .update({
        state: toState,
        state_changed_by: changedBy,
        state_notes: reason || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', registrationId);

    if (updateError) {
      return {
        success: false,
        error: `Failed to update state: ${updateError.message}`,
        oldState: currentState
      };
    }

    console.log(`✅ Registration ${registrationId}: ${currentState} → ${toState}`);

    return {
      success: true,
      oldState: currentState
    };
  } catch (error: any) {
    console.error('Error transitioning registration state:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get current state of a registration
 */
export async function getRegistrationState(
  registrationId: string
): Promise<RegistrationState | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('registrations')
      .select('state')
      .eq('id', registrationId)
      .single();

    if (error || !data) {
      console.error('Error fetching registration state:', error);
      return null;
    }

    return data.state as RegistrationState;
  } catch (error) {
    console.error('Error fetching registration state:', error);
    return null;
  }
}

/**
 * Get all registrations in a specific state
 */
export async function getRegistrationsByState(
  state: RegistrationState
): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('registrations')
      .select('*')
      .eq('state', state)
      .order('state_changed_at', { ascending: false });

    if (error) {
      console.error('Error fetching registrations by state:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching registrations by state:', error);
    return [];
  }
}

/**
 * Get state transition history for a registration
 */
export async function getRegistrationStateHistory(
  registrationId: string
): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('registration_state_history')
      .select('*')
      .eq('registration_id', registrationId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching state history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching state history:', error);
    return [];
  }
}

/**
 * Check if a state transition is valid
 */
export function isValidTransition(
  fromState: RegistrationState,
  toState: RegistrationState
): boolean {
  const allowedTransitions = VALID_TRANSITIONS[fromState];
  return allowedTransitions.includes(toState);
}

/**
 * Get allowed next states for current state
 */
export function getAllowedTransitions(
  currentState: RegistrationState
): RegistrationState[] {
  return VALID_TRANSITIONS[currentState];
}

/**
 * Helper: Start a new registration
 */
export async function startRegistration(
  userId: string,
  vehicleInfo: { vin?: string; plate?: string; plate_state?: string }
): Promise<{ success: boolean; registrationId?: string; error?: string }> {
  try {
    // Create new registration in 'started' state
    const { data, error } = await supabaseAdmin
      .from('registrations')
      .insert({
        user_id: userId,
        vin: vehicleInfo.vin || null,
        plate: vehicleInfo.plate || null,
        plate_state: vehicleInfo.plate_state || 'IL',
        state: 'started',
        state_changed_by: userId,
        state_notes: 'User initiated registration'
      })
      .select()
      .single();

    if (error) {
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      registrationId: data.id
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Helper: Mark registration as needing info
 */
export async function markNeedsInfo(
  registrationId: string,
  missingFields: string[]
): Promise<{ success: boolean; error?: string }> {
  return transitionRegistrationState({
    registrationId,
    toState: 'needs_info',
    changedBy: 'system',
    reason: `Missing: ${missingFields.join(', ')}`
  });
}

/**
 * Helper: Mark all info complete
 */
export async function markInfoComplete(
  registrationId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  return transitionRegistrationState({
    registrationId,
    toState: 'info_complete',
    changedBy: userId,
    reason: 'All required information provided'
  });
}

/**
 * Helper: Submit to remitter queue
 */
export async function queueForSubmission(
  registrationId: string
): Promise<{ success: boolean; error?: string }> {
  return transitionRegistrationState({
    registrationId,
    toState: 'awaiting_submission',
    changedBy: 'system',
    reason: 'Queued for remitter submission'
  });
}

/**
 * Helper: Mark as submitted to state
 */
export async function markSubmitted(
  registrationId: string,
  remitterId: string,
  confirmationNumber?: string
): Promise<{ success: boolean; error?: string }> {
  const result = await transitionRegistrationState({
    registrationId,
    toState: 'submitted',
    changedBy: remitterId,
    reason: confirmationNumber
      ? `Submitted to Illinois SOS. Confirmation: ${confirmationNumber}`
      : 'Submitted to Illinois SOS'
  });

  // Update submitted_at timestamp
  if (result.success) {
    await supabaseAdmin
      .from('registrations')
      .update({
        submitted_at: new Date().toISOString(),
        city_confirmation_number: confirmationNumber || null
      })
      .eq('id', registrationId);
  }

  return result;
}

/**
 * Helper: Mark as completed
 */
export async function markCompleted(
  registrationId: string,
  changedBy: string = 'system'
): Promise<{ success: boolean; error?: string }> {
  const result = await transitionRegistrationState({
    registrationId,
    toState: 'completed',
    changedBy,
    reason: 'Registration complete - plates issued'
  });

  // Update completed_at timestamp
  if (result.success) {
    await supabaseAdmin
      .from('registrations')
      .update({
        completed_at: new Date().toISOString()
      })
      .eq('id', registrationId);
  }

  return result;
}

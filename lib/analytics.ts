import { capture, posthog } from './posthog';

/**
 * Centralized analytics tracking for PostHog
 * All custom events should be tracked through this module
 *
 * Uses the safe `capture` function that waits for PostHog to initialize
 */

// ============================================
// SIGNUP FUNNEL EVENTS
// ============================================

export const trackSignupPageViewed = (source?: string, hasPrefillToken?: boolean) => {
  capture('signup_page_viewed', {
    source: source || 'direct',
    has_prefilled_data: hasPrefillToken || false
  });
};

export const trackSignupFormStarted = () => {
  capture('signup_form_started');
};

export const trackSignupFormError = (errorType: string, failedFields: string[]) => {
  capture('signup_form_error', {
    error_type: errorType,
    failed_fields: failedFields
  });
};

export const trackSignupSubmitted = (data: {
  authMethod: 'email' | 'google';
  city: string;
  hasCitySticker: boolean;
  hasVehicleInfo: boolean;
}) => {
  capture('signup_submitted', {
    auth_method: data.authMethod,
    city: data.city,
    has_city_sticker: data.hasCitySticker,
    has_vehicle_info: data.hasVehicleInfo
  });
};

// ============================================
// PROTECTION/CHECKOUT FUNNEL EVENTS
// ============================================

export const trackProtectionPageViewed = (isLoggedIn: boolean, source?: string) => {
  capture('protection_page_viewed', {
    is_logged_in: isLoggedIn,
    source: source || 'direct'
  });
};

export const trackBillingPlanSelected = (plan: 'monthly' | 'annual') => {
  capture('billing_plan_selected', { plan });
};

export const trackCheckoutInitiated = (data: {
  plan: 'monthly' | 'annual';
  needsCitySticker: boolean;
  needsLicensePlate: boolean;
  hasPermitZone: boolean;
  hasVanityPlate: boolean;
}) => {
  capture('checkout_initiated', {
    plan: data.plan,
    needs_city_sticker: data.needsCitySticker,
    needs_license_plate: data.needsLicensePlate,
    has_permit_zone: data.hasPermitZone,
    has_vanity_plate: data.hasVanityPlate
  });
};

export const trackCheckoutCompleted = (data: {
  plan: 'monthly' | 'annual';
  revenue: number;
  currency?: string;
}) => {
  capture('checkout_completed', {
    plan: data.plan,
    revenue: data.revenue,
    currency: data.currency || 'USD'
  });
};

// ============================================
// USER IDENTIFICATION
// ============================================

export const identifyUser = (userId: string, traits: {
  email?: string;
  planType?: 'free' | 'protection';
  signupDate?: string;
  city?: string;
  hasCitySticker?: boolean;
  hasPermitZone?: boolean;
  vehicleCount?: number;
}) => {
  posthog?.identify(userId, {
    email: traits.email,
    plan_type: traits.planType,
    signup_date: traits.signupDate,
    city: traits.city,
    has_city_sticker: traits.hasCitySticker,
    has_permit_zone: traits.hasPermitZone,
    vehicle_count: traits.vehicleCount
  });
};

export const setUserProperties = (properties: {
  planType?: 'free' | 'protection';
  hasCitySticker?: boolean;
  hasPermitZone?: boolean;
  vehicleCount?: number;
  hasLicenseUploaded?: boolean;
  hasResidencyProof?: boolean;
}) => {
  posthog?.people?.set({
    plan_type: properties.planType,
    has_city_sticker: properties.hasCitySticker,
    has_permit_zone: properties.hasPermitZone,
    vehicle_count: properties.vehicleCount,
    has_license_uploaded: properties.hasLicenseUploaded,
    has_residency_proof: properties.hasResidencyProof
  });
};

// ============================================
// DOCUMENT UPLOAD EVENTS
// ============================================

export const trackLicenseUploaded = (data: {
  side: 'front' | 'back';
  hasOcrSuccess: boolean;
  autofilledExpiry?: boolean;
}) => {
  capture('license_uploaded', {
    side: data.side,
    has_ocr_success: data.hasOcrSuccess,
    autofilled_expiry: data.autofilledExpiry || false
  });
};

export const trackResidencyProofUploaded = (documentType: string) => {
  capture('residency_proof_uploaded', {
    document_type: documentType
  });
};

// ============================================
// TICKET EVENTS
// ============================================

export const trackTicketSubmitted = (data: {
  ticketType?: string;
  amount?: number;
}) => {
  capture('ticket_submitted', {
    ticket_type: data.ticketType,
    amount: data.amount
  });
};

export const trackTicketContestStarted = () => {
  capture('ticket_contest_started');
};

export const trackTicketContestCompleted = (data: {
  ticketType?: string;
  hasEvidence: boolean;
}) => {
  capture('ticket_contest_completed', {
    ticket_type: data.ticketType,
    has_evidence: data.hasEvidence
  });
};

// ============================================
// TICKET CONTESTER FUNNEL EVENTS
// ============================================

export const trackContestPageViewed = () => {
  capture('contest_page_viewed');
};

export const trackContestPhotoUploaded = () => {
  capture('contest_photo_uploaded');
};

export const trackContestDataExtracted = (data: {
  hasTicketNumber: boolean;
  hasViolationCode: boolean;
  hasAmount: boolean;
  extractionSuccess: boolean;
}) => {
  capture('contest_data_extracted', {
    has_ticket_number: data.hasTicketNumber,
    has_violation_code: data.hasViolationCode,
    has_amount: data.hasAmount,
    extraction_success: data.extractionSuccess
  });
};

export const trackContestDataEdited = (fieldsEdited: string[]) => {
  capture('contest_data_edited', {
    fields_edited: fieldsEdited,
    field_count: fieldsEdited.length
  });
};

export const trackContestGroundsSelected = (data: {
  grounds: string[];
  winProbability?: number;
}) => {
  capture('contest_grounds_selected', {
    grounds: data.grounds,
    ground_count: data.grounds.length,
    win_probability: data.winProbability
  });
};

export const trackContestLetterGenerated = (data: {
  violationCode?: string;
  groundCount: number;
  winProbability?: number;
}) => {
  capture('contest_letter_generated', {
    violation_code: data.violationCode,
    ground_count: data.groundCount,
    win_probability: data.winProbability
  });
};

export const trackContestLetterCopied = () => {
  capture('contest_letter_copied');
};

export const trackContestLetterDownloaded = () => {
  capture('contest_letter_downloaded');
};

export const trackContestMailingStarted = () => {
  capture('contest_mailing_started');
};

export const trackContestSignatureAdded = () => {
  capture('contest_signature_added');
};

export const trackContestMailingPaid = (data: {
  violationCode?: string;
  ticketAmount?: number;
}) => {
  capture('contest_mailing_paid', {
    violation_code: data.violationCode,
    ticket_amount: data.ticketAmount,
    revenue: 5
  });
};

// ============================================
// SETTINGS & ENGAGEMENT EVENTS
// ============================================

export const trackSettingsViewed = (section?: string) => {
  capture('settings_viewed', {
    section: section || 'main'
  });
};

export const trackProfileUpdated = (fieldsUpdated: string[]) => {
  capture('profile_updated', {
    fields_updated: fieldsUpdated
  });
};

export const trackNotificationPreferencesUpdated = (preferences: {
  smsEnabled: boolean;
  emailEnabled: boolean;
  phoneEnabled: boolean;
}) => {
  capture('notification_preferences_updated', {
    sms_enabled: preferences.smsEnabled,
    email_enabled: preferences.emailEnabled,
    phone_enabled: preferences.phoneEnabled
  });
};

export const trackVehicleAdded = () => {
  capture('vehicle_added');
};

// ============================================
// MAP & SEARCH EVENTS
// ============================================

export const trackMapViewed = (mapType: 'street_cleaning' | 'parking' | 'permit_zone') => {
  capture('map_viewed', { map_type: mapType });
};

export const trackAddressSearched = (data: {
  foundSchedule: boolean;
  hasPermitZone: boolean;
  city?: string;
}) => {
  capture('address_searched', {
    found_schedule: data.foundSchedule,
    has_permit_zone: data.hasPermitZone,
    city: data.city || 'chicago'
  });
};

// ============================================
// AUTH EVENTS
// ============================================

export const trackLoginStarted = (method: 'email' | 'google') => {
  capture('login_started', { method });
};

export const trackLoginCompleted = (method: 'email' | 'google', isNewUser: boolean) => {
  capture('login_completed', {
    method,
    is_new_user: isNewUser
  });
};

export const trackGoogleAuthStarted = (flow: 'signup' | 'login' | 'protection') => {
  capture('google_auth_started', { flow });
};

// ============================================
// REVENUE TRACKING (for server-side use)
// ============================================

export const trackRevenue = (data: {
  amount: number;
  currency?: string;
  plan?: string;
  userId?: string;
}) => {
  // This is primarily for client-side tracking
  // Server-side revenue tracking should use PostHog Node SDK
  capture('revenue', {
    $revenue: data.amount,
    currency: data.currency || 'USD',
    plan: data.plan,
    user_id: data.userId
  });
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

export const resetUser = () => {
  posthog?.reset();
};

// Export all analytics functions as a single object for convenience
export const analytics = {
  // Signup
  signupPageViewed: trackSignupPageViewed,
  signupFormStarted: trackSignupFormStarted,
  signupFormError: trackSignupFormError,
  signupSubmitted: trackSignupSubmitted,

  // Protection/Checkout
  protectionPageViewed: trackProtectionPageViewed,
  billingPlanSelected: trackBillingPlanSelected,
  checkoutInitiated: trackCheckoutInitiated,
  checkoutCompleted: trackCheckoutCompleted,

  // User
  identifyUser,
  setUserProperties,
  resetUser,

  // Documents
  licenseUploaded: trackLicenseUploaded,
  residencyProofUploaded: trackResidencyProofUploaded,

  // Tickets
  ticketSubmitted: trackTicketSubmitted,
  ticketContestStarted: trackTicketContestStarted,
  ticketContestCompleted: trackTicketContestCompleted,

  // Ticket Contester Funnel
  contestPageViewed: trackContestPageViewed,
  contestPhotoUploaded: trackContestPhotoUploaded,
  contestDataExtracted: trackContestDataExtracted,
  contestDataEdited: trackContestDataEdited,
  contestGroundsSelected: trackContestGroundsSelected,
  contestLetterGenerated: trackContestLetterGenerated,
  contestLetterCopied: trackContestLetterCopied,
  contestLetterDownloaded: trackContestLetterDownloaded,
  contestMailingStarted: trackContestMailingStarted,
  contestSignatureAdded: trackContestSignatureAdded,
  contestMailingPaid: trackContestMailingPaid,

  // Settings
  settingsViewed: trackSettingsViewed,
  profileUpdated: trackProfileUpdated,
  notificationPreferencesUpdated: trackNotificationPreferencesUpdated,
  vehicleAdded: trackVehicleAdded,

  // Maps
  mapViewed: trackMapViewed,
  addressSearched: trackAddressSearched,

  // Auth
  loginStarted: trackLoginStarted,
  loginCompleted: trackLoginCompleted,
  googleAuthStarted: trackGoogleAuthStarted,

  // Revenue
  revenue: trackRevenue
};

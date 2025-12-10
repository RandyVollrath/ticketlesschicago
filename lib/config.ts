/**
 * Central configuration for Autopilot America
 *
 * This file consolidates all domain, email, and URL constants
 * to make it easy to update when expanding to new cities or rebranding.
 */

// Base URLs
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';
export const LEGACY_URL = 'https://ticketlesschicago.com'; // For backwards compatibility

// Domain for cookies (works for www and non-www)
export const COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.autopilotamerica.com' : undefined;

// Passkey/WebAuthn configuration
export const PASSKEY_RP_ID = 'autopilotamerica.com';
export const PASSKEY_RP_NAME = 'Autopilot America';

// Email addresses
export const EMAIL = {
  // From addresses
  FROM_DEFAULT: process.env.RESEND_FROM || 'Autopilot America <hello@autopilotamerica.com>',
  FROM_ALERTS: 'Autopilot America <alerts@autopilotamerica.com>',
  FROM_NOREPLY: 'Autopilot America <noreply@autopilotamerica.com>',

  // Functional addresses
  SUPPORT: 'support@autopilotamerica.com',
  DOCUMENTS: 'documents@autopilotamerica.com',

  // Reply-to
  REPLY_TO: 'support@autopilotamerica.com',
} as const;

// Common URLs
export const URLS = {
  // User-facing pages
  DASHBOARD: `${BASE_URL}/dashboard`,
  SETTINGS: `${BASE_URL}/settings`,
  PROTECTION: `${BASE_URL}/protection`,
  UNSUBSCRIBE: `${BASE_URL}/unsubscribe`,
  HELP: `${BASE_URL}/help`,

  // Specific features
  PERMIT_ZONE_DOCS: `${BASE_URL}/permit-zone-documents`,
  RESIDENCY_PROOF: `${BASE_URL}/settings#residency-proof`,
  LICENSE_UPLOAD: `${BASE_URL}/settings#license-upload`,
  REMITTER_PORTAL: `${BASE_URL}/remitter-portal`,

  // Admin pages
  ADMIN_MESSAGE_AUDIT: `${BASE_URL}/admin/message-audit`,

  // External links
  EMISSIONS_LOCATOR: 'https://airteam.app/forms/locator.cfm',
  CITY_STICKER_RENEWAL: 'https://chicityclerk.com',
  LICENSE_PLATE_RENEWAL: 'https://cyberdriveillinois.com',
} as const;

// SMS/Voice message prefix
export const SMS_PREFIX = 'Autopilot:';

// Brand name
export const BRAND = {
  NAME: 'Autopilot America',
  SHORT_NAME: 'Autopilot',
  TAGLINE: 'Your Vehicle Compliance Partner',
  TRUSTED_TAGLINE: 'Your trusted vehicle compliance partner',
} as const;

// ICS calendar UID domain
export const ICS_UID_DOMAIN = 'autopilotamerica.com';

// Helper function to build URLs with query params
export function buildUrl(base: string, params?: Record<string, string>): string {
  if (!params) return base;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

// Helper for check-your-street URLs
export function getCheckStreetUrl(address: string, mode: 'snow' | 'street-cleaning' = 'snow'): string {
  return buildUrl(`${BASE_URL}/check-your-street`, { address, mode });
}

import { z } from 'zod';

// Helper to sanitize strings - remove potential SQL/XSS injection characters
export function sanitizeString(str: string | undefined | null): string | null {
  if (!str) return null;
  // Remove null bytes and control characters
  return str
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 1000); // Limit string length
}

// Email validation
const emailSchema = z.string().email().max(255).nullable().optional();

// Phone number validation (flexible, will be normalized later)
const phoneSchema = z.string()
  .regex(/^[\d\s\-\+\(\)\.]+$/, 'Invalid phone format')
  .min(7)
  .max(20)
  .nullable()
  .optional();

// Date string validation (YYYY-MM-DD or MM/DD/YYYY formats)
const dateStringSchema = z.string()
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/, 'Invalid date format')
  .nullable()
  .optional();

// Address validation
const addressSchema = z.string().min(5).max(500).nullable().optional();

// Boolean string validation
const booleanStringSchema = z.enum(['true', 'false']).optional();

// Permit zones validation (JSON array string)
const permitZonesSchema = z.string().max(2000).optional();

// Client reference ID validation (for Rewardful/affiliate tracking)
export const clientReferenceIdSchema = z.string()
  .regex(/^[a-zA-Z0-9_\-]+$/, 'Invalid client reference ID format')
  .max(200)
  .nullable()
  .optional();

// Permit zone schema
const permitZoneSchema = z.object({
  zone: z.string().max(20).optional(),
  name: z.string().max(100).optional(),
});

export const permitZonesArraySchema = z.array(permitZoneSchema).max(10);

// Ticket protection metadata schema
export const ticketProtectionMetadataSchema = z.object({
  product: z.literal('ticket_protection'),
  userId: z.string().uuid().optional(),
  email: emailSchema,
  plan: z.enum(['basic', 'standard', 'premium', 'max']).optional(),
  citySticker: dateStringSchema,
  licensePlate: dateStringSchema,
  phone: phoneSchema,
  streetAddress: addressSchema,
  firstName: z.string().max(100).nullable().optional(),
  vehicleType: z.string().max(10).optional(),
  hasPermitZone: booleanStringSchema,
  permitRequested: booleanStringSchema,
  permitZones: permitZonesSchema,
  isVanityPlate: booleanStringSchema,
  rewardful_referral_id: clientReferenceIdSchema,
}).passthrough(); // Allow additional fields

// Renewal metadata schema (parsed JSON objects)
export const vehicleInfoSchema = z.object({
  licensePlate: z.string().max(20).optional(),
  make: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  year: z.union([z.string(), z.number()]).optional(),
  color: z.string().max(30).optional(),
  vehicleType: z.string().max(20).optional(),
}).passthrough();

export const renewalDatesSchema = z.object({
  citySticker: dateStringSchema,
  licensePlate: dateStringSchema,
}).passthrough();

export const contactInfoSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
}).passthrough();

export const preferencesSchema = z.object({
  notifications: z.boolean().optional(),
  emailReminders: z.boolean().optional(),
  smsReminders: z.boolean().optional(),
}).passthrough();

export const streetCleaningSchema = z.object({
  wardSection: z.string().max(50).optional(),
  schedule: z.string().max(200).optional(),
}).passthrough();

// Mailing address schema (for contest letters)
export const mailingAddressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
}).passthrough();

/**
 * Safely parse JSON with validation
 */
export function safeParseJson<T>(
  jsonString: string | undefined | null,
  schema: z.ZodSchema<T>,
  defaultValue: T
): T {
  if (!jsonString) return defaultValue;

  try {
    const parsed = JSON.parse(jsonString);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn('JSON validation failed:', result.error.issues);
    return defaultValue;
  } catch (e) {
    console.warn('JSON parse failed:', e);
    return defaultValue;
  }
}

/**
 * Validate ticket protection webhook metadata
 */
export function validateTicketProtectionMetadata(metadata: Record<string, string>) {
  const result = ticketProtectionMetadataSchema.safeParse(metadata);

  if (!result.success) {
    console.warn('Metadata validation issues:', result.error.issues);
    // Return sanitized version even if validation fails (for backward compatibility)
    return {
      isValid: false,
      data: sanitizeMetadata(metadata),
      errors: result.error.issues,
    };
  }

  return {
    isValid: true,
    data: result.data,
    errors: [],
  };
}

/**
 * Sanitize all metadata fields
 */
export function sanitizeMetadata(metadata: Record<string, string>): Record<string, string | null> {
  const sanitized: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = sanitizeString(value);
  }

  return sanitized;
}

/**
 * Validate and sanitize client reference ID
 */
export function validateClientReferenceId(referralId: string | undefined | null): string | null {
  if (!referralId) return null;

  const result = clientReferenceIdSchema.safeParse(referralId);
  if (result.success) {
    return result.data ?? null;
  }

  console.warn('Invalid client reference ID:', referralId);
  return null;
}

/**
 * Check if a value is valid (not empty/null/undefined)
 */
export function hasValidValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * Safely extract the first permit zone number from JSON string
 */
export function extractFirstPermitZone(permitZonesJson: string | undefined | null): string | null {
  if (!permitZonesJson) return null;

  const zones = safeParseJson(permitZonesJson, permitZonesArraySchema, []);
  if (zones.length > 0 && zones[0].zone) {
    return zones[0].zone;
  }
  return null;
}

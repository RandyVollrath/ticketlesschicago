/**
 * Input Validation Utilities
 *
 * Provides Zod schemas and validation helpers for API endpoints
 */

import { z } from 'zod';
import { NextApiRequest, NextApiResponse } from 'next';

// ============================================
// Common Field Schemas
// ============================================

export const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(255, 'Email too long')
  .transform(val => val.toLowerCase().trim());

export const phoneSchema = z
  .string()
  .regex(/^[\+\d\s\-\(\)]{7,20}$/, 'Invalid phone number format')
  .transform(val => val.replace(/[\s\-\(\)]/g, ''));

export const licensePlateSchema = z
  .string()
  .min(2, 'License plate too short')
  .max(10, 'License plate too long')
  .regex(/^[A-Z0-9\-\s]+$/i, 'Invalid license plate format')
  .transform(val => val.toUpperCase().trim());

export const addressSchema = z
  .string()
  .min(5, 'Address too short')
  .max(500, 'Address too long')
  .trim();

export const uuidSchema = z
  .string()
  .uuid('Invalid ID format');

export const positiveIntSchema = z
  .number()
  .int()
  .positive();

export const currencyAmountSchema = z
  .number()
  .int()
  .min(0, 'Amount cannot be negative')
  .max(100000000, 'Amount too large'); // Max $1M in cents

// ============================================
// API Request Schemas
// ============================================

// Protection/Checkout
export const checkoutRequestSchema = z.object({
  email: emailSchema,
  vehicles: z.array(z.object({
    licensePlate: licensePlateSchema,
    state: z.string().length(2, 'State must be 2 characters').toUpperCase(),
    nickname: z.string().max(50).optional(),
  })).min(1, 'At least one vehicle required').max(10, 'Maximum 10 vehicles'),
  address: addressSchema,
  billingInterval: z.enum(['month', 'year']).optional().default('month'),
  promoCode: z.string().max(50).optional(),
});

// User Profile Update
export const profileUpdateSchema = z.object({
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  phone: phoneSchema.optional(),
  phone_number: phoneSchema.optional(),
  street_address: addressSchema.optional(),
  home_address_full: addressSchema.optional(),
  license_plate: licensePlateSchema.optional(),
  city_sticker_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
  license_plate_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
  notify_email: z.boolean().optional(),
  notify_sms: z.boolean().optional(),
  notify_push: z.boolean().optional(),
}).strict();

// Alert Signup
export const alertSignupSchema = z.object({
  email: emailSchema,
  licensePlate: licensePlateSchema,
  address: addressSchema.optional(),
  phone: phoneSchema.optional(),
});

// Renewal Order
export const renewalOrderSchema = z.object({
  partnerId: uuidSchema,
  customerName: z.string().min(2).max(200),
  customerEmail: emailSchema,
  customerPhone: phoneSchema,
  licensePlate: licensePlateSchema,
  licenseState: z.string().length(2).toUpperCase(),
  streetAddress: addressSchema,
  city: z.string().max(100),
  state: z.string().length(2).toUpperCase(),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  stickerType: z.enum(['standard', 'large']),
});

// Magic Link Request
export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});

// Contact/Support Form
export const contactFormSchema = z.object({
  email: emailSchema,
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
});

// ============================================
// Validation Helper Functions
// ============================================

/**
 * Validate request body against a Zod schema
 * Returns parsed data or sends error response
 */
export function validateBody<T extends z.ZodSchema>(
  schema: T,
  body: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: z.ZodError['errors'] } {
  const result = schema.safeParse(body);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error.errors };
}

/**
 * Middleware-style validator that sends error response automatically
 */
export function withValidation<T extends z.ZodSchema>(
  schema: T,
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    data: z.infer<T>
  ) => Promise<void | NextApiResponse>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      console.warn('Validation failed:', errors);

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    return handler(req, res, result.data);
  };
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends z.ZodSchema>(
  schema: T,
  query: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: z.ZodError['errors'] } {
  const result = schema.safeParse(query);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error.errors };
}

/**
 * Sanitize string to prevent XSS (basic)
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

/**
 * Type guard to check if value is a valid enum member
 */
export function isValidEnum<T extends Record<string, string>>(
  enumObj: T,
  value: unknown
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

/**
 * Error handling utilities for safe error responses
 *
 * Prevents internal error details from being exposed to users
 */

// Patterns that indicate internal/sensitive error details
const SENSITIVE_PATTERNS = [
  /PGRST\d+/i,           // PostgREST errors
  /relation.*does not exist/i,
  /column.*does not exist/i,
  /duplicate key/i,
  /foreign key constraint/i,
  /syntax error/i,
  /permission denied/i,
  /authentication failed/i,
  /invalid api key/i,
  /rate limit/i,
  /timeout/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /at\s+\w+\s+\(/i,      // Stack traces
  /node_modules/i,
  /\.ts:\d+:\d+/i,       // TypeScript file references
  /\.js:\d+:\d+/i,       // JavaScript file references
];

// User-friendly error messages for common issues
const FRIENDLY_ERRORS: Record<string, string> = {
  'not found': 'The requested resource was not found',
  'unauthorized': 'You are not authorized to perform this action',
  'forbidden': 'Access denied',
  'invalid request': 'Invalid request data',
  'already exists': 'This item already exists',
  'validation failed': 'Please check your input and try again',
  'rate limit': 'Too many requests. Please wait a moment and try again',
  'timeout': 'The request timed out. Please try again',
};

/**
 * Sanitizes an error message for safe display to users
 * Removes technical details that could expose system internals
 */
export function sanitizeErrorMessage(error: unknown): string {
  // Get the error message
  let message = 'An unexpected error occurred';

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message);
  }

  // Check if message contains sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      // Log the real error for debugging (server-side only)
      console.error('[Sanitized Error]', message);
      return 'An error occurred. Please try again or contact support.';
    }
  }

  // Map to friendly messages if possible
  const lowerMessage = message.toLowerCase();
  for (const [key, friendly] of Object.entries(FRIENDLY_ERRORS)) {
    if (lowerMessage.includes(key)) {
      return friendly;
    }
  }

  // If message is very long, truncate it (long messages often contain stack traces)
  if (message.length > 200) {
    console.error('[Truncated Error]', message);
    return 'An error occurred. Please try again.';
  }

  return message;
}

/**
 * Creates a safe error response object for API endpoints
 */
export function createErrorResponse(error: unknown, requestId?: string): {
  error: string;
  requestId?: string;
} {
  const response: { error: string; requestId?: string } = {
    error: sanitizeErrorMessage(error),
  };

  if (requestId) {
    response.requestId = requestId;
  }

  return response;
}

/**
 * Validates and sanitizes pagination parameters
 */
export function validatePagination(
  limit: string | string[] | undefined,
  offset: string | string[] | undefined,
  maxLimit = 100
): { limit: number; offset: number } {
  const limitStr = Array.isArray(limit) ? limit[0] : limit;
  const offsetStr = Array.isArray(offset) ? offset[0] : offset;

  let parsedLimit = parseInt(limitStr || '20', 10);
  let parsedOffset = parseInt(offsetStr || '0', 10);

  // Validate limit
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20;
  } else if (parsedLimit > maxLimit) {
    parsedLimit = maxLimit;
  }

  // Validate offset
  if (isNaN(parsedOffset) || parsedOffset < 0) {
    parsedOffset = 0;
  }

  return { limit: parsedLimit, offset: parsedOffset };
}

/**
 * Type guard to check if an error has a message property
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

/**
 * Validates and normalizes a US phone number
 * Returns normalized E.164 format (+1XXXXXXXXXX) or null if invalid
 */
export function validateAndNormalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Check for valid US number (10 digits, or 11 starting with 1)
  if (digits.length === 10) {
    // Validate area code (first digit can't be 0 or 1)
    if (digits[0] === '0' || digits[0] === '1') {
      return null;
    }
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits[0] === '1') {
    // Validate area code (second digit can't be 0 or 1)
    if (digits[1] === '0' || digits[1] === '1') {
      return null;
    }
    return `+${digits}`;
  }

  // Invalid length
  return null;
}

/**
 * Validates phone number format (looser validation for Zod)
 * Use validateAndNormalizePhone for strict validation and normalization
 */
export function isValidUSPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return digits[0] !== '0' && digits[0] !== '1';
  }

  if (digits.length === 11 && digits[0] === '1') {
    return digits[1] !== '0' && digits[1] !== '1';
  }

  return false;
}

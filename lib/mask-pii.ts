/**
 * Utility functions to mask PII (Personally Identifiable Information) in logs
 * Prevents sensitive data from appearing in production logs
 */

/**
 * Mask an email address for logging
 * e.g., "john.doe@example.com" -> "j***e@e***.com"
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '[no email]';

  const parts = email.split('@');
  if (parts.length !== 2) return '[invalid email]';

  const [local, domain] = parts;
  const domainParts = domain.split('.');

  const maskedLocal = local.length <= 2
    ? '*'.repeat(local.length)
    : local[0] + '*'.repeat(Math.min(local.length - 2, 3)) + local[local.length - 1];

  const maskedDomain = domainParts[0].length <= 2
    ? '*'.repeat(domainParts[0].length)
    : domainParts[0][0] + '*'.repeat(Math.min(domainParts[0].length - 1, 3));

  return `${maskedLocal}@${maskedDomain}.${domainParts.slice(1).join('.')}`;
}

/**
 * Mask a phone number for logging
 * e.g., "+1234567890" -> "+1***890"
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '[no phone]';

  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.length < 4) return '*'.repeat(cleaned.length);

  const hasPlus = cleaned.startsWith('+');
  const digits = hasPlus ? cleaned.slice(1) : cleaned;

  if (digits.length <= 4) return (hasPlus ? '+' : '') + '*'.repeat(digits.length);

  const prefix = hasPlus ? '+' : '';
  const visible = digits.length > 6 ? 3 : 2;

  return prefix + digits.slice(0, visible) + '*'.repeat(digits.length - visible - 3) + digits.slice(-3);
}

/**
 * Mask a street address for logging
 * e.g., "123 Main Street, Chicago, IL" -> "1** M*** Street, Chicago, IL"
 */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return '[no address]';

  // Only mask the first part (street number and name)
  const parts = address.split(',');
  if (parts.length === 0) return '[address]';

  const streetPart = parts[0].trim();
  const words = streetPart.split(' ');

  const maskedWords = words.map((word, i) => {
    // Keep first character, mask rest (for first 2 words only)
    if (i < 2 && word.length > 1) {
      return word[0] + '*'.repeat(Math.min(word.length - 1, 3));
    }
    return word;
  });

  return [maskedWords.join(' '), ...parts.slice(1)].join(',');
}

/**
 * Mask a license plate for logging
 * e.g., "ABC1234" -> "A***34"
 */
export function maskLicensePlate(plate: string | null | undefined): string {
  if (!plate) return '[no plate]';

  if (plate.length <= 3) return '*'.repeat(plate.length);

  return plate[0] + '*'.repeat(plate.length - 3) + plate.slice(-2);
}

/**
 * Mask a user ID for logging (show first and last 4 chars)
 * e.g., "abc123-def456-ghi789" -> "abc1...i789"
 */
export function maskUserId(userId: string | null | undefined): string {
  if (!userId) return '[no userId]';

  if (userId.length <= 8) return userId;

  return userId.slice(0, 4) + '...' + userId.slice(-4);
}

/**
 * Create a safe log object from user data
 * Automatically masks common PII fields
 */
export function safeLogUser(user: {
  email?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  address?: string | null;
  home_address_full?: string | null;
  street_address?: string | null;
  license_plate?: string | null;
  user_id?: string | null;
  id?: string | null;
  [key: string]: any;
}): Record<string, any> {
  const safe: Record<string, any> = {};

  for (const [key, value] of Object.entries(user)) {
    if (value === null || value === undefined) {
      continue;
    }

    switch (key) {
      case 'email':
        safe.email = maskEmail(value as string);
        break;
      case 'phone':
      case 'phone_number':
        safe[key] = maskPhone(value as string);
        break;
      case 'address':
      case 'home_address_full':
      case 'street_address':
        safe[key] = maskAddress(value as string);
        break;
      case 'license_plate':
        safe[key] = maskLicensePlate(value as string);
        break;
      case 'user_id':
      case 'id':
        safe[key] = maskUserId(value as string);
        break;
      default:
        // Pass through non-PII fields as-is
        if (typeof value !== 'object') {
          safe[key] = value;
        }
    }
  }

  return safe;
}

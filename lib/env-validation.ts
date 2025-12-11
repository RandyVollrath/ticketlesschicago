/**
 * Environment Variable Validation
 *
 * Validates that required environment variables are set.
 * Import this module early in your application to catch missing env vars at startup.
 *
 * Usage:
 * - Import at top of _app.tsx or key API routes
 * - Call validateEnv() to check all required vars
 * - Call validateEnvGroup('database') to check specific groups
 */

// Define required environment variables by category
const ENV_REQUIREMENTS = {
  // Database - Required for all operations
  database: {
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    recommended: ['SUPABASE_SERVICE_ROLE_KEY'],
    description: 'Database connectivity',
  },

  // Authentication - Required for user sessions
  auth: {
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    recommended: ['CRON_SECRET'],
    description: 'User authentication',
  },

  // Email - Required for notifications
  email: {
    required: ['RESEND_API_KEY'],
    recommended: ['ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL'],
    description: 'Email notifications',
  },

  // SMS - Required for text notifications
  sms: {
    required: ['CLICKSEND_API_KEY', 'CLICKSEND_USERNAME'],
    recommended: ['CLICKSEND_SENDER_ID'],
    description: 'SMS notifications',
  },

  // Payments - Required for Stripe operations
  payments: {
    required: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    recommended: ['STRIPE_WEBHOOK_SECRET'],
    description: 'Payment processing',
  },

  // External APIs - For specific features
  external_apis: {
    required: [],
    recommended: [
      'GOOGLE_CLOUD_VISION_CREDENTIALS',
      'POSTHOG_API_KEY',
      'OPENAI_API_KEY',
    ],
    description: 'External API integrations',
  },

  // Webhooks - For incoming webhooks
  webhooks: {
    required: [],
    recommended: [
      'RESEND_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET',
      'CRON_SECRET',
    ],
    description: 'Webhook verification',
  },
} as const;

export type EnvGroup = keyof typeof ENV_REQUIREMENTS;

interface ValidationResult {
  valid: boolean;
  missing: string[];
  missingRecommended: string[];
  group: string;
  description: string;
}

/**
 * Check if an environment variable is set (and not empty)
 */
function isEnvSet(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== 'undefined';
}

/**
 * Validate a specific group of environment variables
 */
export function validateEnvGroup(group: EnvGroup): ValidationResult {
  const config = ENV_REQUIREMENTS[group];
  const missing = config.required.filter((name) => !isEnvSet(name));
  const missingRecommended = config.recommended.filter((name) => !isEnvSet(name));

  return {
    valid: missing.length === 0,
    missing,
    missingRecommended,
    group,
    description: config.description,
  };
}

/**
 * Validate all environment variable groups
 * Returns detailed results for each group
 */
export function validateAllEnvGroups(): Map<EnvGroup, ValidationResult> {
  const results = new Map<EnvGroup, ValidationResult>();

  for (const group of Object.keys(ENV_REQUIREMENTS) as EnvGroup[]) {
    results.set(group, validateEnvGroup(group));
  }

  return results;
}

/**
 * Validate environment and log warnings/errors
 * Call this at application startup
 *
 * @param failOnMissing - If true, throws error for missing required vars
 * @returns true if all required vars are set
 */
export function validateEnv(failOnMissing = false): boolean {
  // Skip validation in test environment
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  const results = validateAllEnvGroups();
  let allValid = true;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [group, result] of results) {
    if (!result.valid) {
      allValid = false;
      errors.push(
        `[${group}] Missing required env vars for ${result.description}: ${result.missing.join(', ')}`
      );
    }

    if (result.missingRecommended.length > 0) {
      warnings.push(
        `[${group}] Missing recommended env vars for ${result.description}: ${result.missingRecommended.join(', ')}`
      );
    }
  }

  // Log warnings
  if (warnings.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  Environment variable warnings:');
    warnings.forEach((w) => console.warn(`   ${w}`));
  }

  // Log errors
  if (errors.length > 0) {
    console.error('❌ Missing required environment variables:');
    errors.forEach((e) => console.error(`   ${e}`));

    if (failOnMissing) {
      throw new Error(
        `Missing required environment variables:\n${errors.join('\n')}`
      );
    }
  }

  if (allValid && process.env.NODE_ENV !== 'production') {
    console.log('✅ All required environment variables are set');
  }

  return allValid;
}

/**
 * Assert that specific env vars are set, throw if not
 * Use this at the top of API routes that require specific vars
 *
 * @example
 * assertEnvVars(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
 */
export function assertEnvVars(varNames: string[]): void {
  const missing = varNames.filter((name) => !isEnvSet(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

/**
 * Get environment variable with fallback
 * Logs warning if using fallback in production
 */
export function getEnvWithFallback(
  name: string,
  fallback: string,
  warnInProd = true
): string {
  const value = process.env[name];

  if (!isEnvSet(name)) {
    if (warnInProd && process.env.NODE_ENV === 'production') {
      console.warn(
        `⚠️  Using fallback value for ${name} in production - this may not be intended`
      );
    }
    return fallback;
  }

  return value!;
}

/**
 * Mask sensitive value for logging (show first/last 4 chars)
 */
export function maskEnvValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Get sanitized env var info for debugging (masks sensitive values)
 */
export function getEnvDebugInfo(): Record<string, string> {
  const sensitivePatterns = ['KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL'];

  const allVars = new Set<string>();
  for (const group of Object.values(ENV_REQUIREMENTS)) {
    group.required.forEach((v) => allVars.add(v));
    group.recommended.forEach((v) => allVars.add(v));
  }

  const info: Record<string, string> = {};
  for (const name of allVars) {
    const value = process.env[name];
    const isSensitive = sensitivePatterns.some((p) => name.includes(p));

    if (!value) {
      info[name] = '(not set)';
    } else if (isSensitive) {
      info[name] = maskEnvValue(value);
    } else {
      info[name] = value.length > 50 ? `${value.slice(0, 50)}...` : value;
    }
  }

  return info;
}

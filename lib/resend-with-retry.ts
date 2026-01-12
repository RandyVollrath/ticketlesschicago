import { Resend } from 'resend';

/**
 * Resend API with automatic retry logic for rate limits
 *
 * Resend has a rate limit of 2 requests per second.
 * This utility wraps API calls with exponential backoff retry logic.
 */

export interface SendEmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  success: boolean;
  data?: { id: string };
  error?: string;
  retries?: number;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1000; // 1 second

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;

  // Check error message
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  if (message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  // Check for 429 status code
  if (error.statusCode === 429 || error.status === 429) {
    return true;
  }

  // Check Resend-specific error structure
  if (error.statusCode && error.message?.includes('rate limit')) {
    return true;
  }

  return false;
}

/**
 * Send email with automatic retry on rate limit errors
 */
export async function sendEmailWithRetry(
  resend: Resend,
  options: SendEmailOptions,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS
): Promise<SendEmailResult> {
  let lastError: any = null;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await resend.emails.send({
        from: options.from,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo,
        headers: options.headers,
      });

      if (error) {
        // Check if it's a rate limit error
        if (isRateLimitError(error)) {
          lastError = error;
          retries = attempt;

          if (attempt < maxRetries) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            const delay = baseDelayMs * Math.pow(2, attempt);
            console.log(`⏳ Rate limited by Resend. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
            await sleep(delay);
            continue;
          }
        }

        // Non-rate-limit error, or exhausted retries
        return {
          success: false,
          error: error.message || 'Unknown error',
          retries,
        };
      }

      // Success
      if (retries > 0) {
        console.log(`✅ Email sent successfully after ${retries} retries`);
      }

      return {
        success: true,
        data: data ? { id: data.id } : undefined,
        retries,
      };

    } catch (err: any) {
      lastError = err;
      retries = attempt;

      // Check if it's a rate limit error
      if (isRateLimitError(err)) {
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.log(`⏳ Rate limited by Resend (exception). Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
          await sleep(delay);
          continue;
        }
      }

      // Non-rate-limit error, or exhausted retries
      return {
        success: false,
        error: err.message || 'Unknown exception',
        retries,
      };
    }
  }

  // Exhausted all retries
  return {
    success: false,
    error: lastError?.message || 'Max retries exceeded due to rate limiting',
    retries,
  };
}

/**
 * Create a Resend client with retry-enabled send method
 */
export function createResendWithRetry(apiKey: string, maxRetries?: number, baseDelayMs?: number) {
  const resend = new Resend(apiKey);

  return {
    emails: {
      send: (options: SendEmailOptions) => sendEmailWithRetry(resend, options, maxRetries, baseDelayMs),
    },
    // Expose the original client for other operations
    client: resend,
  };
}

/**
 * Batch send emails with rate limit awareness
 * Automatically spaces out emails to avoid hitting rate limits
 */
export async function sendEmailsBatch(
  resend: Resend,
  emails: SendEmailOptions[],
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    delayBetweenEmails?: number; // Delay between each email to avoid rate limits
  }
): Promise<{
  results: SendEmailResult[];
  successCount: number;
  failureCount: number;
}> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const delayBetweenEmails = options?.delayBetweenEmails ?? 600; // Default 600ms (just under 2/sec)

  const results: SendEmailResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    // Add delay between emails (except for the first one)
    if (i > 0 && delayBetweenEmails > 0) {
      await sleep(delayBetweenEmails);
    }

    const result = await sendEmailWithRetry(resend, email, maxRetries, baseDelayMs);
    results.push(result);

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
      console.error(`❌ Failed to send email to ${Array.isArray(email.to) ? email.to.join(', ') : email.to}: ${result.error}`);
    }
  }

  return {
    results,
    successCount,
    failureCount,
  };
}

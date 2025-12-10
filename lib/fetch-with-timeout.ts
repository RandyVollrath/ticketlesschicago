/**
 * Fetch with Timeout Utility
 *
 * Wraps the native fetch API with configurable timeouts to prevent
 * hung requests when external services are slow or unresponsive.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number; // Timeout in milliseconds
}

export class FetchTimeoutError extends Error {
  constructor(url: string, timeout: number) {
    super(`Request to ${url} timed out after ${timeout}ms`);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Default timeouts for different service types (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
  /** Email services (Resend) */
  email: 10000, // 10 seconds

  /** SMS services (ClickSend) */
  sms: 10000, // 10 seconds

  /** Payment services (Stripe) */
  payment: 30000, // 30 seconds

  /** Webhook callbacks */
  webhook: 15000, // 15 seconds

  /** General API calls */
  default: 15000, // 15 seconds

  /** Long-running operations */
  long: 60000, // 60 seconds
} as const;

/**
 * Fetch with timeout support
 *
 * @param url - The URL to fetch
 * @param options - Fetch options including optional timeout
 * @returns Promise resolving to the Response
 * @throws FetchTimeoutError if the request times out
 *
 * @example
 * ```typescript
 * // Basic usage with default timeout
 * const response = await fetchWithTimeout('https://api.example.com/data');
 *
 * // With custom timeout
 * const response = await fetchWithTimeout('https://api.stripe.com/v1/charges', {
 *   method: 'POST',
 *   timeout: 30000, // 30 seconds
 *   headers: { 'Authorization': 'Bearer sk_...' },
 *   body: JSON.stringify(data)
 * });
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUTS.default, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeout);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Send email via Resend with timeout
 */
export async function sendResendEmail(
  emailData: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    replyTo?: string;
  },
  timeout: number = DEFAULT_TIMEOUTS.email
): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeout,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', data);
      return { success: false, error: data.message || 'Email send failed' };
    }

    return { success: true, id: data.id };
  } catch (error: any) {
    if (error instanceof FetchTimeoutError) {
      console.error('Resend request timed out');
      return { success: false, error: 'Email service timeout' };
    }
    console.error('Resend request failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send SMS via ClickSend with timeout
 */
export async function sendClickSendSMS(
  to: string,
  body: string,
  from?: string,
  timeout: number = DEFAULT_TIMEOUTS.sms
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  const senderId = from || process.env.CLICKSEND_SENDER_ID || 'Autopilot';

  if (!username || !apiKey) {
    console.warn('ClickSend credentials not configured');
    return { success: false, error: 'SMS service not configured' };
  }

  try {
    const response = await fetchWithTimeout('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      timeout,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            to,
            body,
            from: senderId,
            source: 'autopilot-api',
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok || data.response_code !== 'SUCCESS') {
      console.error('ClickSend API error:', data);
      return { success: false, error: data.response_msg || 'SMS send failed' };
    }

    const messageId = data.data?.messages?.[0]?.message_id;
    return { success: true, messageId };
  } catch (error: any) {
    if (error instanceof FetchTimeoutError) {
      console.error('ClickSend request timed out');
      return { success: false, error: 'SMS service timeout' };
    }
    console.error('ClickSend request failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper to detect if an error is a timeout
 */
export function isTimeoutError(error: unknown): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}

/**
 * Retry a fetch operation with exponential backoff
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithTimeoutOptions & { maxRetries?: number; retryDelay?: number } = {}
): Promise<Response> {
  const { maxRetries = 3, retryDelay = 1000, ...fetchOptions } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, fetchOptions);
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff
      const delay = retryDelay * Math.pow(2, attempt);
      console.warn(`Fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

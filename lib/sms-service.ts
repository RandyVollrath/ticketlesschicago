import { circuitBreakers, CircuitOpenError } from './circuit-breaker';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second between retries

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Direct ClickSend API implementation with retry logic and circuit breaker
export async function sendClickSendSMS(
  to: string,
  message: string,
  options: { maxRetries?: number; bypassCircuitBreaker?: boolean } = {}
): Promise<{success: boolean, error?: string, attempts?: number, messageId?: string, circuitOpen?: boolean}> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;

  // Check circuit breaker first (unless bypassed for testing)
  if (!options.bypassCircuitBreaker) {
    try {
      // Wrap the entire retry loop in circuit breaker
      return await circuitBreakers.sms.execute(
        () => sendClickSendSMSWithRetries(to, message, maxRetries),
        { to, messageLength: message.length }
      );
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        console.warn(`🚫 SMS circuit OPEN - not attempting send to ${to}`);
        return {
          success: false,
          error: `SMS service temporarily unavailable. Retry in ${Math.ceil(error.retryAfterMs / 1000)}s.`,
          circuitOpen: true
        };
      }
      throw error;
    }
  }

  // Bypass circuit breaker - direct call
  return sendClickSendSMSWithRetries(to, message, maxRetries);
}

// Internal: SMS with retries (called by circuit breaker)
async function sendClickSendSMSWithRetries(
  to: string,
  message: string,
  maxRetries: number
): Promise<{success: boolean, error?: string, attempts?: number, messageId?: string}> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendClickSendSMSOnce(to, message);

    if (result.success) {
      return { ...result, attempts: attempt };
    }

    // Don't retry on credential errors or invalid number
    if (result.error?.includes('No credentials') ||
        result.error?.includes('INVALID_RECIPIENT')) {
      console.log(`❌ SMS failed (not retrying): ${result.error}`);
      return { ...result, attempts: attempt };
    }

    if (attempt < maxRetries) {
      console.log(`⚠️ SMS attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
    }
  }

  console.error(`❌ SMS failed after ${maxRetries} attempts`);
  // Throw error so circuit breaker records the failure
  throw new Error(`SMS failed after ${maxRetries} attempts`);
}

// Single attempt (internal)
async function sendClickSendSMSOnce(to: string, message: string): Promise<{success: boolean, error?: string}> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  
  if (!username || !apiKey) {
    console.log('📱 MOCK: No ClickSend credentials configured');
    return { success: false, error: 'No credentials' };
  }

  try {
    const response = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64')
      },
      body: JSON.stringify({
        messages: [
          {
            to: to.replace(/\D/g, ''), // Remove non-digits
            body: message,
            from: 'TicketLess',
            source: 'nodejs'
          }
        ]
      })
    });

    const result = await response.json();

    // Log the full response for debugging
    console.log('📱 ClickSend response:', JSON.stringify(result, null, 2));

    // Check for success - ClickSend returns status in messages array
    const messageStatus = result.data?.messages?.[0]?.status;
    if (response.ok && messageStatus === 'SUCCESS') {
      console.log('✅ SMS sent successfully via ClickSend to', to);
      return { success: true };
    } else {
      // Extract the actual error from ClickSend's response structure
      // ClickSend errors can be in: response_msg, data.messages[0].status, or http_code
      const errorMsg = result.response_msg
        || result.data?.messages?.[0]?.status
        || result.data?.messages?.[0]?._api_message
        || (result.http_code ? `HTTP ${result.http_code}` : null)
        || `Unknown error (HTTP ${response.status})`;

      console.error('❌ ClickSend SMS failed:', {
        httpStatus: response.status,
        responseCode: result.response_code,
        responseMsg: result.response_msg,
        httpCode: result.http_code,
        messageStatus: messageStatus,
        fullResponse: result
      });
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ Error sending SMS via ClickSend:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}

// Voice call implementation with retry logic and circuit breaker
export async function sendClickSendVoiceCall(
  to: string,
  message: string,
  options: { maxRetries?: number; bypassCircuitBreaker?: boolean } = {}
): Promise<{success: boolean, error?: string, attempts?: number, messageId?: string, circuitOpen?: boolean}> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;

  // Check circuit breaker first (unless bypassed for testing)
  if (!options.bypassCircuitBreaker) {
    try {
      return await circuitBreakers.voice.execute(
        () => sendClickSendVoiceCallWithRetries(to, message, maxRetries),
        { to, messageLength: message.length }
      );
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        console.warn(`🚫 Voice circuit OPEN - not attempting call to ${to}`);
        return {
          success: false,
          error: `Voice service temporarily unavailable. Retry in ${Math.ceil(error.retryAfterMs / 1000)}s.`,
          circuitOpen: true
        };
      }
      throw error;
    }
  }

  return sendClickSendVoiceCallWithRetries(to, message, maxRetries);
}

// Internal: Voice calls with retries (called by circuit breaker)
async function sendClickSendVoiceCallWithRetries(
  to: string,
  message: string,
  maxRetries: number
): Promise<{success: boolean, error?: string, attempts?: number, messageId?: string}> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendClickSendVoiceCallOnce(to, message);

    if (result.success) {
      return { ...result, attempts: attempt };
    }

    // Don't retry on credential errors or invalid number
    if (result.error?.includes('No credentials') ||
        result.error?.includes('INVALID_RECIPIENT')) {
      console.log(`❌ Voice call failed (not retrying): ${result.error}`);
      return { ...result, attempts: attempt };
    }

    if (attempt < maxRetries) {
      console.log(`⚠️ Voice call attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  console.error(`❌ Voice call failed after ${maxRetries} attempts`);
  throw new Error(`Voice call failed after ${maxRetries} attempts`);
}

// Single voice call attempt (internal)
async function sendClickSendVoiceCallOnce(to: string, message: string): Promise<{success: boolean, error?: string}> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  
  if (!username || !apiKey) {
    console.log('📞 MOCK: No ClickSend credentials configured for voice');
    return { success: false, error: 'No credentials' };
  }

  try {
    const response = await fetch('https://rest.clicksend.com/v3/voice/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64')
      },
      body: JSON.stringify({
        messages: [
          {
            to: to.replace(/\D/g, ''), // Remove non-digits
            body: message,
            voice: 'female', // or 'male'
            custom_string: 'ticketless-reminder',
            source: 'nodejs'
          }
        ]
      })
    });

    const result = await response.json();

    // Log the full response for debugging
    console.log('📞 ClickSend voice response:', JSON.stringify(result, null, 2));

    // Check for success - ClickSend returns status in messages array
    const messageStatus = result.data?.messages?.[0]?.status;
    if (response.ok && messageStatus === 'SUCCESS') {
      console.log('✅ Voice call sent successfully via ClickSend to', to);
      return { success: true };
    } else {
      // Extract the actual error from ClickSend's response structure
      const errorMsg = result.response_msg
        || result.data?.messages?.[0]?.status
        || result.data?.messages?.[0]?._api_message
        || (result.http_code ? `HTTP ${result.http_code}` : null)
        || `Unknown error (HTTP ${response.status})`;

      console.error('❌ ClickSend voice call failed:', {
        httpStatus: response.status,
        responseCode: result.response_code,
        responseMsg: result.response_msg,
        httpCode: result.http_code,
        messageStatus: messageStatus,
        fullResponse: result
      });
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ Error sending voice call via ClickSend:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}
interface SendSMSResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Send an SMS message via ClickSend API
 * @param to - Phone number to send to (E.164 format, e.g., +1312XXXXXXX)
 * @param message - The SMS message content
 */
export async function sendSMS(to: string, message: string): Promise<SendSMSResult> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;

  if (!username || !apiKey) {
    console.error("ClickSend credentials missing:", { username: !!username, apiKey: !!apiKey });
    return { success: false, error: "SMS service not configured" };
  }

  const auth = Buffer.from(`${username}:${apiKey}`).toString("base64");

  try {
    const response = await fetch("https://rest.clicksend.com/v3/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        messages: [
          {
            to: to,
            body: message,
            source: "snowsos",
          },
        ],
      }),
    });

    const data = await response.json();

    if (response.ok && data.response_code === "SUCCESS") {
      return { success: true, message: "SMS sent successfully" };
    } else {
      console.error("ClickSend error:", data);
      return { success: false, error: data.response_msg || "Failed to send SMS" };
    }
  } catch (error) {
    console.error("SMS send error:", error);
    return { success: false, error: "Network error sending SMS" };
  }
}

/**
 * Broadcast SMS to multiple recipients
 * @param recipients - Array of phone numbers
 * @param message - The SMS message content
 */
export async function broadcastSMS(
  recipients: string[],
  message: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Send to all recipients in parallel
  const results = await Promise.all(
    recipients.map((phone) => sendSMS(phone, message))
  );

  results.forEach((result) => {
    if (result.success) {
      success++;
    } else {
      failed++;
    }
  });

  return { success, failed };
}

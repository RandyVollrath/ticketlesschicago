/**
 * Webhook Signature Verification
 *
 * Verifies webhook requests are authentic and not from attackers
 */

import crypto from 'crypto';
import { NextApiRequest } from 'next';

/**
 * Verify Resend webhook signature
 *
 * Resend uses Svix for webhook signing
 * Docs: https://resend.com/docs/dashboard/webhooks/verify-event
 */
export function verifyResendWebhook(
  req: NextApiRequest,
  secret: string
): boolean {
  try {
    const signature = req.headers['svix-signature'] as string;
    const timestamp = req.headers['svix-timestamp'] as string;
    const id = req.headers['svix-id'] as string;

    if (!signature || !timestamp || !id) {
      console.error('Missing Resend webhook headers');
      return false;
    }

    // Resend/Svix signature format: "v1,signature1 v1,signature2"
    const signatures = signature.split(' ').map(s => {
      const [version, sig] = s.split(',');
      return { version, signature: sig };
    });

    const payload = JSON.stringify(req.body);
    const signedPayload = `${id}.${timestamp}.${payload}`;

    // Verify at least one signature matches
    for (const { version, signature: sig } of signatures) {
      if (version !== 'v1') continue;

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('base64');

      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))) {
        // Check timestamp is recent (within 5 minutes)
        const webhookTimestamp = parseInt(timestamp, 10);
        const now = Math.floor(Date.now() / 1000);

        if (Math.abs(now - webhookTimestamp) > 300) {
          console.error('Resend webhook timestamp too old');
          return false;
        }

        return true;
      }
    }

    console.error('Resend webhook signature verification failed');
    return false;
  } catch (error) {
    console.error('Error verifying Resend webhook:', error);
    return false;
  }
}

/**
 * Verify ClickSend webhook signature
 *
 * ClickSend doesn't have built-in signature verification,
 * but we can verify the request came from ClickSend's IP ranges
 * and add a secret token
 */
export function verifyClickSendWebhook(
  req: NextApiRequest,
  secret?: string
): boolean {
  try {
    // Option 1: Secret token in query parameter or header
    if (secret) {
      const token = req.query.token || req.headers['x-clicksend-token'];

      if (token !== secret) {
        console.error('ClickSend webhook secret token mismatch');
        return false;
      }
    }

    // Option 2: Verify IP address is from ClickSend
    // ClickSend's webhook IPs (you'll need to add these to env or config)
    const clicksendIPs = [
      // Add ClickSend's IP ranges here if they provide them
      // For now, we'll rely on the secret token
    ];

    const forwardedFor = req.headers['x-forwarded-for'] as string;
    const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket?.remoteAddress;

    // If we have IP whitelist and IP doesn't match, reject
    if (clicksendIPs.length > 0 && clientIP && !clicksendIPs.includes(clientIP)) {
      console.error('ClickSend webhook from unauthorized IP:', clientIP);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error verifying ClickSend webhook:', error);
    return false;
  }
}

/**
 * Generic webhook verification wrapper
 */
export function verifyWebhook(
  provider: 'resend' | 'resend-evidence' | 'clicksend',
  req: NextApiRequest
): boolean {
  switch (provider) {
    case 'resend': {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        console.warn('RESEND_WEBHOOK_SECRET not set - webhook verification disabled');
        return true; // Allow in development, but log warning
      }
      return verifyResendWebhook(req, secret);
    }

    case 'resend-evidence': {
      const secret = process.env.RESEND_EVIDENCE_WEBHOOK_SECRET;
      if (!secret) {
        console.warn('RESEND_EVIDENCE_WEBHOOK_SECRET not set - webhook verification disabled');
        return true; // Allow in development, but log warning
      }
      return verifyResendWebhook(req, secret);
    }

    case 'clicksend': {
      const secret = process.env.CLICKSEND_WEBHOOK_SECRET;
      // ClickSend verification is optional (uses secret token)
      return verifyClickSendWebhook(req, secret);
    }

    default:
      console.error('Unknown webhook provider:', provider);
      return false;
  }
}

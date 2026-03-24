/**
 * Webhook Signature Verification
 *
 * Verifies webhook requests are authentic and not from attackers
 */

import crypto from 'crypto';
import { NextApiRequest } from 'next';

/**
 * Read the raw request body as a Buffer.
 * Call this BEFORE any body parsing middleware.
 */
export async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Verify Resend webhook signature
 *
 * Resend uses Svix for webhook signing.
 * Svix secret format: "whsec_<base64-encoded-key>"
 *   → strip the "whsec_" prefix, base64-decode the remainder, use as HMAC key
 * Signed payload: "${svix-id}.${svix-timestamp}.${raw_body}"
 *   → HMAC-SHA256 with decoded key, then base64 the digest
 *
 * Docs: https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
export function verifyResendWebhook(
  req: NextApiRequest,
  secret: string,
  rawBody?: string,
): boolean {
  try {
    const signature = req.headers['svix-signature'] as string;
    const timestamp = req.headers['svix-timestamp'] as string;
    const id = req.headers['svix-id'] as string;

    if (!signature || !timestamp || !id) {
      console.error('Missing Resend webhook headers (svix-signature, svix-timestamp, svix-id)');
      return false;
    }

    // Resend/Svix signature format: "v1,signature1 v1,signature2"
    const signatures = signature.split(' ').map(s => {
      const [version, sig] = s.split(',');
      return { version, signature: sig };
    });

    // Use raw body if provided (preferred), otherwise fall back to JSON.stringify
    const payload = rawBody ?? JSON.stringify(req.body);
    const signedPayload = `${id}.${timestamp}.${payload}`;

    // Svix secrets start with "whsec_" — strip prefix and base64-decode the key
    let secretKey: Buffer;
    if (secret.startsWith('whsec_')) {
      secretKey = Buffer.from(secret.substring(6), 'base64');
    } else {
      // Fallback: use raw secret bytes (shouldn't happen with Resend/Svix)
      secretKey = Buffer.from(secret);
    }

    // Verify at least one signature matches
    for (const { version, signature: sig } of signatures) {
      if (version !== 'v1') continue;

      const expectedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(signedPayload)
        .digest('base64');

      // Use timing-safe comparison to prevent timing attacks
      const sigBuf = Buffer.from(sig, 'base64');
      const expectedBuf = Buffer.from(expectedSignature, 'base64');

      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
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

    console.error('Resend webhook signature verification failed — no matching signature');
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
    // Verify secret token via header only (never query params — they get logged)
    if (secret) {
      const token = req.headers['x-clicksend-token'] || req.headers.authorization?.replace('Bearer ', '');

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
 *
 * @param rawBody — For Resend/Svix webhooks, pass the raw request body string.
 *   Svix signs the raw bytes, NOT JSON.stringify(req.body). If omitted, falls
 *   back to JSON.stringify(req.body) which may work if Next.js parsed identically.
 */
export function verifyWebhook(
  provider: 'resend' | 'resend-evidence' | 'clicksend',
  req: NextApiRequest,
  rawBody?: string,
): boolean {
  switch (provider) {
    case 'resend': {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        // SECURITY: Fail closed. Previously returned true when secret was missing,
        // meaning any unverified request would be accepted in production if the
        // env var was accidentally removed.
        console.error('RESEND_WEBHOOK_SECRET not set - rejecting webhook (fail closed)');
        return false;
      }
      return verifyResendWebhook(req, secret, rawBody);
    }

    case 'resend-evidence': {
      const secret = process.env.RESEND_EVIDENCE_WEBHOOK_SECRET;
      if (!secret) {
        console.error('RESEND_EVIDENCE_WEBHOOK_SECRET not set - rejecting webhook (fail closed)');
        return false;
      }
      return verifyResendWebhook(req, secret, rawBody);
    }

    case 'clicksend': {
      const secret = process.env.CLICKSEND_WEBHOOK_SECRET;
      if (!secret) {
        console.error('CLICKSEND_WEBHOOK_SECRET not set - rejecting webhook (fail closed)');
        return false;
      }
      return verifyClickSendWebhook(req, secret);
    }

    default:
      console.error('Unknown webhook provider:', provider);
      return false;
  }
}

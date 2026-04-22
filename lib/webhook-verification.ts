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
 * Verify ClickSend webhook signature.
 *
 * ClickSend's inbound SMS rule UI (as of 2026-04) does NOT allow custom
 * request headers — the only way to authenticate the webhook is to put the
 * secret directly in the URL. So this function accepts the secret from any
 * of:
 *   - header `x-clicksend-token`
 *   - header `Authorization: Bearer <token>`
 *   - query string `?token=<secret>`
 *
 * URL-query secrets get logged by every proxy, CDN, and Vercel's access
 * log — so the operator must rotate the secret on a regular cadence.
 * Comparison is timing-safe.
 */
export function verifyClickSendWebhook(
  req: NextApiRequest,
  secret?: string
): boolean {
  try {
    if (secret) {
      const headerToken =
        (req.headers['x-clicksend-token'] as string | undefined) ||
        (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : undefined);

      const queryTokenRaw = req.query.token;
      const queryToken = Array.isArray(queryTokenRaw) ? queryTokenRaw[0] : queryTokenRaw;

      const tokenA = headerToken || queryToken;
      if (!tokenA) {
        console.error('ClickSend webhook: no token header or query param');
        return false;
      }

      // Timing-safe compare.
      const a = Buffer.from(String(tokenA));
      const b = Buffer.from(secret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.error('ClickSend webhook secret token mismatch');
        return false;
      }

      if (!headerToken && queryToken) {
        console.warn('ClickSend webhook auth via ?token= query param — this is logged by every proxy. Rotate the secret regularly.');
      }
    }

    // ClickSend IP whitelist (none configured — we rely on the secret token).
    const clicksendIPs: string[] = [];
    const forwardedFor = req.headers['x-forwarded-for'] as string;
    const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket?.remoteAddress;
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
  provider: 'resend' | 'resend-evidence' | 'resend-receipts' | 'clicksend',
  req: NextApiRequest,
  rawBody?: string,
): boolean {
  switch (provider) {
    case 'resend': {
      // Each Resend webhook endpoint has its own signing secret. This one is
      // for /api/webhooks/resend-incoming-email. receipt-forwarding has its
      // own secret (see 'resend-receipts' below) because Resend generates a
      // separate secret per webhook.
      //
      // As a compatibility fallback, if RESEND_WEBHOOK_SECRET fails but
      // RESEND_RECEIPTS_WEBHOOK_SECRET is set, try that too — some operators
      // set them backwards after they're created.
      const primary = process.env.RESEND_WEBHOOK_SECRET;
      if (!primary) {
        console.error('RESEND_WEBHOOK_SECRET not set - rejecting webhook (fail closed)');
        return false;
      }
      if (verifyResendWebhook(req, primary, rawBody)) return true;

      const fallback = process.env.RESEND_RECEIPTS_WEBHOOK_SECRET;
      if (fallback && verifyResendWebhook(req, fallback, rawBody)) {
        console.warn('Resend webhook authed via fallback RESEND_RECEIPTS_WEBHOOK_SECRET — the env vars may be set backwards.');
        return true;
      }
      return false;
    }

    case 'resend-receipts': {
      // Secret for /api/webhooks/receipt-forwarding. Try the dedicated var
      // first; fall back to RESEND_WEBHOOK_SECRET if only that is set.
      const primary = process.env.RESEND_RECEIPTS_WEBHOOK_SECRET;
      const fallback = process.env.RESEND_WEBHOOK_SECRET;
      if (!primary && !fallback) {
        console.error('RESEND_RECEIPTS_WEBHOOK_SECRET / RESEND_WEBHOOK_SECRET not set - rejecting webhook (fail closed)');
        return false;
      }
      if (primary && verifyResendWebhook(req, primary, rawBody)) return true;
      if (fallback && verifyResendWebhook(req, fallback, rawBody)) {
        if (primary) {
          console.warn('Receipts webhook authed via fallback RESEND_WEBHOOK_SECRET — env vars may be set backwards.');
        }
        return true;
      }
      return false;
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

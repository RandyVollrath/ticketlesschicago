import crypto from 'crypto';

/**
 * Verify Lob webhook signature.
 *
 * Per Lob spec (https://docs.lob.com/#webhooks-section), each request carries:
 *   lob-signature           HMAC-SHA256 hex digest
 *   lob-signature-timestamp Unix epoch seconds
 * The signed payload is "${timestamp}.${rawBody}". Signing the raw body alone
 * silently rejects every real Lob delivery (which is why historical letters
 * had delivery_status = null until 2026-05-06 when this was fixed).
 *
 * The 5-minute timestamp window guards against replay of an old captured event.
 *
 * Lives in its own file so it can be imported without pulling Supabase
 * client initialization at module load (the smoke test depends on this).
 */
export function verifyLobSignature(
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined,
): boolean {
  const webhookSecret = process.env.LOB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('LOB_WEBHOOK_SECRET not configured — rejecting webhook (fail closed)');
    return false;
  }
  if (!signature || !timestamp) {
    return false;
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) {
    console.error(`Lob webhook timestamp out of window: age=${ageSec.toFixed(0)}s`);
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

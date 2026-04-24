import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const APP_BUNDLE_ID = 'fyi.ticketless.app';
const VALID_PRODUCT_IDS = ['autopilot_annual', 'autopilot_annual_v2', 'autopilot_monthly_v2'];

/**
 * Decode a StoreKit 2 JWS (signed transaction) and extract claims.
 * The JWS is a standard JWT with three base64url-encoded segments.
 * We decode the payload to get transaction details.
 */
function decodeJWSPayload(jws: string): Record<string, any> | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second segment)
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Validate a StoreKit 2 JWS signed transaction.
 * Decodes the JWS payload and verifies the claims match our app.
 */
function validateJWSTransaction(jws: string): {
  valid: boolean;
  productId?: string;
  transactionId?: string;
  environment?: string;
  bundleId?: string;
  error?: string;
} {
  const payload = decodeJWSPayload(jws);
  if (!payload) {
    return { valid: false, error: 'Could not decode JWS payload' };
  }

  // Verify bundle ID
  if (payload.bundleId && payload.bundleId !== APP_BUNDLE_ID) {
    return { valid: false, error: `Bundle ID mismatch: ${payload.bundleId}` };
  }

  // Verify product ID
  if (payload.productId && !VALID_PRODUCT_IDS.includes(payload.productId)) {
    return { valid: false, error: `Product ID mismatch: ${payload.productId}` };
  }

  return {
    valid: true,
    productId: payload.productId,
    transactionId: payload.transactionId || payload.originalTransactionId,
    environment: payload.environment,
    bundleId: payload.bundleId,
  };
}

/**
 * Fallback: validate via Apple's legacy /verifyReceipt endpoint.
 * Tries production first; if Apple returns 21007, retries on sandbox.
 */
async function validateLegacyReceipt(receipt: string): Promise<{
  valid: boolean;
  productId?: string;
  transactionId?: string;
  environment?: string;
  error?: string;
}> {
  const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET || '';
  const body = JSON.stringify({
    'receipt-data': receipt,
    password: sharedSecret,
    'exclude-old-transactions': true,
  });

  let response = await fetch('https://buy.itunes.apple.com/verifyReceipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  let result = await response.json();

  // 21007 = sandbox receipt sent to production
  if (result.status === 21007) {
    response = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    result = await response.json();
  }

  if (result.status !== 0) {
    return { valid: false, error: `Apple receipt status: ${result.status}` };
  }

  const inApp = result.receipt?.in_app || [];
  const matching = inApp.find((item: any) => VALID_PRODUCT_IDS.includes(item.product_id));

  if (!matching) {
    return { valid: false, error: 'Product not found in receipt' };
  }

  if (result.receipt?.bundle_id !== APP_BUNDLE_ID) {
    return { valid: false, error: `Bundle ID mismatch: ${result.receipt?.bundle_id}` };
  }

  return {
    valid: true,
    productId: matching.product_id,
    transactionId: matching.transaction_id,
    environment: result.environment,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate the user
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { purchaseToken, receipt, productId, transactionId } = req.body;

  if (!purchaseToken && !receipt) {
    return res.status(400).json({ error: 'Purchase token or receipt is required' });
  }

  console.log(`[IAP] Verifying purchase for user ${user.id}, product: ${productId}, txn: ${transactionId}`);

  try {
    let validation: {
      valid: boolean;
      productId?: string;
      transactionId?: string;
      environment?: string;
      error?: string;
    };

    // StoreKit 2: purchaseToken is a JWS signed transaction
    if (purchaseToken) {
      validation = validateJWSTransaction(purchaseToken);
      // If JWS validation fails, try as legacy receipt
      if (!validation.valid && receipt) {
        console.log('[IAP] JWS validation failed, trying legacy receipt');
        validation = await validateLegacyReceipt(receipt);
      }
    } else {
      // Legacy receipt validation
      validation = await validateLegacyReceipt(receipt);
    }

    if (!validation.valid) {
      console.error(`[IAP] Validation failed for user ${user.id}:`, validation.error);
      return res.status(400).json({ error: 'Invalid purchase', detail: validation.error });
    }

    const finalTransactionId = validation.transactionId || transactionId;
    console.log(`[IAP] Valid — product: ${validation.productId}, env: ${validation.environment}, txn: ${finalTransactionId}`);

    // Idempotency: check for duplicate transaction
    if (finalTransactionId) {
      const { data: existing } = await supabaseAdmin
        .from('iap_transactions')
        .select('id')
        .eq('transaction_id', finalTransactionId)
        .maybeSingle();

      if (existing) {
        console.log(`[IAP] Duplicate transaction ${finalTransactionId}`);
        return res.status(200).json({ activated: true, duplicate: true });
      }
    }

    // Record the transaction with correct amounts per product
    const finalProductId = validation.productId || productId;
    const isMonthly =
      finalProductId === 'autopilot_monthly' ||
      finalProductId === 'autopilot_monthly_v2' ||
      finalProductId === 'autopilot_monthly_v3';
    const isLegacyV2 = finalProductId === 'autopilot_monthly_v2' || finalProductId === 'autopilot_annual_v2';
    // v2 grandfathered at old prices ($14.99/mo, $119.99/yr); v3 new tier ($9/mo, $79/yr)
    const amountCents = isLegacyV2
      ? (isMonthly ? 1499 : 11999)
      : (isMonthly ? 900 : 7900);
    const appleFeeCents = Math.round(amountCents * 0.15); // 15% Small Business Program
    const netCents = amountCents - appleFeeCents;
    const netDollars = (netCents / 100).toFixed(2);
    const grossDollars = (amountCents / 100).toFixed(2);
    const planLabel = isLegacyV2
      ? (isMonthly ? 'Monthly ($14.99/mo)' : 'Annual ($119.99/yr)')
      : (isMonthly ? 'Monthly ($9/mo)' : 'Annual ($79/yr)');

    await supabaseAdmin
      .from('iap_transactions')
      .insert({
        user_id: user.id,
        product_id: finalProductId,
        transaction_id: finalTransactionId || `unknown_${Date.now()}`,
        receipt_data: (purchaseToken || receipt || '').substring(0, 500),
        environment: validation.environment || 'unknown',
        amount_cents: amountCents,
        apple_fee_cents: appleFeeCents,
        net_cents: netCents,
      });

    // Activate the user's account
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert(
        {
          user_id: user.id,
          email: user.email,
          has_contesting: true,
          is_paid: true,
          payment_source: isMonthly ? 'apple_iap_monthly' : 'apple_iap',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (profileError) {
      console.error(`[IAP] CRITICAL: Profile update failed for ${user.id}:`, profileError);

      try {
        await resend.emails.send({
          from: 'Alerts <alerts@autopilotamerica.com>',
          to: 'randyvollrath@gmail.com',
          subject: '[IAP] CRITICAL: Apple IAP paid but account not activated',
          text: `User paid via Apple IAP but has_contesting was NOT set!\n\nUser ID: ${user.id}\nEmail: ${user.email}\nTransaction: ${finalTransactionId}\n\nManual fix: UPDATE user_profiles SET has_contesting=true, is_paid=true WHERE user_id='${user.id}';`,
        });
      } catch (e) {
        console.error('[IAP] Failed to send alert email:', e);
      }

      return res.status(500).json({ error: 'Account activation failed — please contact support' });
    }

    console.log(`[IAP] Account activated for user ${user.id} via Apple IAP`);

    // Send confirmation + notification emails (non-blocking)
    try {
      await Promise.all([
        resend.emails.send({
          from: 'Autopilot America <hello@autopilotamerica.com>',
          to: user.email!,
          subject: 'Welcome to Autopilot America!',
          text: `Hi there!\n\nYour Autopilot America account is now active. You're all set to start using the app.\n\nIf you have any questions, just reply to this email.\n\nBest,\nThe Autopilot America Team`,
        }),
        resend.emails.send({
          from: 'Alerts <alerts@autopilotamerica.com>',
          to: 'randyvollrath@gmail.com',
          subject: `New iOS IAP signup (${planLabel}): ${user.email}`,
          text: `New user signed up via Apple IAP!\n\nEmail: ${user.email}\nUser ID: ${user.id}\nPlan: ${planLabel}\nProduct ID: ${finalProductId}\nTransaction: ${finalTransactionId}\nEnvironment: ${validation.environment}\nGross: $${grossDollars}\nApple fee (15%): $${(appleFeeCents / 100).toFixed(2)}\nNet revenue: $${netDollars}`,
        }),
      ]);
    } catch (e) {
      console.error('[IAP] Email send failed (non-fatal):', e);
    }

    return res.status(200).json({ activated: true });
  } catch (error: any) {
    console.error(`[IAP] Error for user ${user.id}:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Audit Stripe ↔ Supabase paid-user parity.
 *
 * Why: from May 3–11 2026 the Stripe webhook silently 400'd on every event
 * (STRIPE_WEBHOOK_SECRET mismatch). Real customers paid but our DB never
 * flipped is_paid=true. After fixing the secret + replaying events, we need
 * to confirm every paying customer ended up with access — and flag any
 * refunded users we should turn OFF.
 *
 * Usage: tsx scripts/audit-stripe-supabase-parity.ts
 *
 * Loads env from /tmp/prod.env (pulled via `vercel env pull`).
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// .env.local has live-mode keys already (Vercel env pull strips sensitive vars to empty).
loadEnv({ path: path.join(process.cwd(), '.env.local') });

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!stripeKey || !supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required env. Need STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion });
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Look back 60 days to cover the broken-webhook window + buffer.
const LOOKBACK_DAYS = 60;
const sinceTs = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60;

const TEST_EMAILS = new Set([
  // Add Randy's known test accounts here if you want them filtered out.
  // Keep loose — the report prints everything; we just star likely tests.
]);

function isLikelyTest(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return (
    TEST_EMAILS.has(e) ||
    e.includes('+test') ||
    e.startsWith('qa-bot@') ||
    e.includes('@autopilotamerica.com')
  );
}

async function listAllPaidSessions(): Promise<Stripe.Checkout.Session[]> {
  const all: Stripe.Checkout.Session[] = [];
  for await (const s of stripe.checkout.sessions.list({
    limit: 100,
    created: { gte: sinceTs },
  })) {
    // Filter on the JS side because the SDK doesn't support status filters in list params here.
    if (s.payment_status === 'paid' && s.status === 'complete') {
      all.push(s);
    }
  }
  return all;
}

async function main() {
  console.log(`Auditing Stripe ↔ Supabase parity over last ${LOOKBACK_DAYS} days...\n`);

  const sessions = await listAllPaidSessions();
  console.log(`Found ${sessions.length} completed+paid checkout sessions in window.\n`);

  type Mismatch = {
    sessionId: string;
    email: string;
    amount: number;
    plan: string;
    supabaseUserId: string | null;
    createdAt: string;
    dbState: string;
    refunded: boolean;
  };

  const paidInStripeNotInDb: Mismatch[] = [];
  const paidInDbButRefunded: Mismatch[] = [];
  const okCount: { value: number } = { value: 0 };
  const unknown: Mismatch[] = []; // no supabase_user_id metadata

  for (const session of sessions) {
    const email = session.customer_details?.email || session.customer_email || '';
    const supabaseUserId = session.metadata?.supabase_user_id || null;
    const plan = session.metadata?.plan_code || session.metadata?.service || 'unknown';

    // Was the charge refunded?
    let refunded = false;
    if (session.payment_intent && typeof session.payment_intent === 'string') {
      try {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] });
        const charge: any = (pi as any).latest_charge;
        if (charge?.refunded || (charge?.amount_refunded || 0) >= (charge?.amount || 0)) {
          refunded = true;
        }
      } catch (e: any) {
        // Subscription mode often has no payment_intent on the session itself; we still capture invoice → charge below.
      }
    }
    // For subscription mode, look up the invoice to find charges
    if (!refunded && session.mode === 'subscription' && session.subscription && typeof session.subscription === 'string') {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        if (sub.status === 'canceled' || sub.status === 'unpaid') {
          // Could be refunded-and-canceled or just churned; mark as candidate
          if (sub.status === 'canceled') {
            // Verify whether the underlying invoice was refunded
            const invoices = await stripe.invoices.list({ subscription: session.subscription, limit: 3 });
            for (const inv of invoices.data) {
              if (inv.charge && typeof inv.charge === 'string') {
                const ch = await stripe.charges.retrieve(inv.charge);
                if (ch.refunded || (ch.amount_refunded || 0) >= (ch.amount || 0)) {
                  refunded = true;
                  break;
                }
              }
            }
          }
        }
      } catch {}
    }

    if (!supabaseUserId) {
      unknown.push({
        sessionId: session.id,
        email,
        amount: (session.amount_total || 0) / 100,
        plan,
        supabaseUserId: null,
        createdAt: new Date(session.created * 1000).toISOString(),
        dbState: 'no metadata.supabase_user_id',
        refunded,
      });
      continue;
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('user_id, email, is_paid, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', supabaseUserId)
      .maybeSingle();

    const isPaid = profile?.is_paid === true;
    const dbState = profile ? `is_paid=${profile.is_paid}` : 'NO PROFILE ROW';

    if (!refunded && !isPaid) {
      paidInStripeNotInDb.push({
        sessionId: session.id,
        email,
        amount: (session.amount_total || 0) / 100,
        plan,
        supabaseUserId,
        createdAt: new Date(session.created * 1000).toISOString(),
        dbState,
        refunded,
      });
    } else if (refunded && isPaid) {
      paidInDbButRefunded.push({
        sessionId: session.id,
        email,
        amount: (session.amount_total || 0) / 100,
        plan,
        supabaseUserId,
        createdAt: new Date(session.created * 1000).toISOString(),
        dbState,
        refunded,
      });
    } else {
      okCount.value++;
    }
  }

  // Report
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔴 PAID IN STRIPE BUT NOT is_paid IN DB');
  console.log(`   (these users gave you money and don't have access)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (paidInStripeNotInDb.length === 0) {
    console.log('   ✅ none — every paying customer has is_paid=true\n');
  } else {
    for (const m of paidInStripeNotInDb) {
      const flag = isLikelyTest(m.email) ? '⭐test?' : '';
      console.log(`   ${flag} ${m.email}  $${m.amount}  ${m.plan}  ${m.createdAt}`);
      console.log(`       user_id=${m.supabaseUserId}  session=${m.sessionId}  db=${m.dbState}`);
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🟡 REFUNDED IN STRIPE BUT is_paid=true IN DB');
  console.log(`   (these were refunded but still have access — review)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (paidInDbButRefunded.length === 0) {
    console.log('   ✅ none\n');
  } else {
    for (const m of paidInDbButRefunded) {
      const flag = isLikelyTest(m.email) ? '⭐test?' : '';
      console.log(`   ${flag} ${m.email}  $${m.amount}  ${m.plan}  ${m.createdAt}`);
      console.log(`       user_id=${m.supabaseUserId}  session=${m.sessionId}`);
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  SESSIONS WITHOUT supabase_user_id METADATA');
  console.log(`   (can't audit — usually old sessions or non-Autopilot products)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (unknown.length === 0) {
    console.log('   ✅ none\n');
  } else {
    for (const m of unknown.slice(0, 20)) {
      console.log(`   ${m.email}  $${m.amount}  ${m.plan}  ${m.createdAt}  session=${m.sessionId}`);
    }
    if (unknown.length > 20) console.log(`   ... and ${unknown.length - 20} more`);
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`SUMMARY`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Healthy:                              ${okCount.value}`);
  console.log(`🔴 Paid in Stripe, not is_paid in DB:    ${paidInStripeNotInDb.length}`);
  console.log(`🟡 Refunded in Stripe, is_paid in DB:    ${paidInDbButRefunded.length}`);
  console.log(`⚠️  No supabase_user_id metadata:        ${unknown.length}`);
  console.log(`Total sessions reviewed:                 ${sessions.length}`);
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

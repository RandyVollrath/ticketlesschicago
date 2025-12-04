import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

/**
 * Get the Stripe client instance (lazy initialization)
 */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY environment variable");
    }

    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2025-11-17.clover",
      typescript: true,
    });
  }
  return stripeInstance;
}

/**
 * Platform fee percentage (10%)
 */
export const PLATFORM_FEE_PERCENT = 0.10;

/**
 * Calculate platform fee from total price in cents
 */
export function calculatePlatformFee(totalCents: number): number {
  return Math.round(totalCents * PLATFORM_FEE_PERCENT);
}

/**
 * Convert dollars to cents
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Create a Stripe Connect Express account for a plower
 */
export async function createConnectAccount(
  email: string,
  phone: string,
  name?: string
): Promise<Stripe.Account> {
  const stripe = getStripe();

  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: "individual",
    individual: {
      phone,
      first_name: name?.split(" ")[0] || undefined,
      last_name: name?.split(" ").slice(1).join(" ") || undefined,
    },
    metadata: {
      platform: "snowsos",
      phone,
    },
  });

  return account;
}

/**
 * Create an account link for Connect onboarding
 */
export async function createAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<Stripe.AccountLink> {
  const stripe = getStripe();

  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
}

/**
 * Check if a Connect account is fully onboarded
 */
export async function isAccountOnboarded(accountId: string): Promise<boolean> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);

  return (
    account.charges_enabled === true &&
    account.payouts_enabled === true &&
    account.details_submitted === true
  );
}

/**
 * Create or retrieve a Stripe Customer
 */
export async function getOrCreateCustomer(
  phone: string,
  name?: string
): Promise<Stripe.Customer> {
  const stripe = getStripe();

  // Search for existing customer by phone
  const existingCustomers = await stripe.customers.search({
    query: `phone:"${phone}"`,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create new customer
  return stripe.customers.create({
    phone,
    name: name || undefined,
    metadata: {
      platform: "snowsos",
    },
  });
}

/**
 * Create a PaymentIntent for a job with Connect destination charge
 */
export async function createJobPaymentIntent(
  customerId: string,
  totalCents: number,
  platformFeeCents: number,
  connectAccountId: string,
  jobId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  return stripe.paymentIntents.create({
    amount: totalCents,
    currency: "usd",
    customer: customerId,
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: connectAccountId,
    },
    metadata: {
      job_id: jobId,
      platform: "snowsos",
    },
    automatic_payment_methods: {
      enabled: true,
    },
  });
}

/**
 * Retrieve a PaymentIntent
 */
export async function retrievePaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Refund a PaymentIntent
 */
export async function refundPaymentIntent(
  paymentIntentId: string,
  amountCents?: number
): Promise<Stripe.Refund> {
  const stripe = getStripe();

  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountCents, // undefined = full refund
  });
}

/**
 * Verify Stripe webhook signature
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET environment variable");
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

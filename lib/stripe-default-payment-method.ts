import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
});

export async function resolveDefaultStripePaymentMethod(customerId: string): Promise<{
  paymentMethodId: string | null;
  source: 'customer_default' | 'subscription_default' | 'none';
}> {
  const stripeCustomer = await stripe.customers.retrieve(customerId);

  if (!stripeCustomer || stripeCustomer.deleted) {
    throw new Error('Stripe customer not found');
  }

  // @ts-ignore Stripe types lag invoice_settings expansion on customer
  let paymentMethodId = stripeCustomer.invoice_settings?.default_payment_method as string | null | undefined;

  if (paymentMethodId) {
    return {
      paymentMethodId,
      source: 'customer_default',
    };
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
  });

  if (subscriptions.data.length > 0) {
    paymentMethodId = subscriptions.data[0].default_payment_method as string | null;
    if (paymentMethodId) {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      return {
        paymentMethodId,
        source: 'subscription_default',
      };
    }
  }

  return {
    paymentMethodId: null,
    source: 'none',
  };
}

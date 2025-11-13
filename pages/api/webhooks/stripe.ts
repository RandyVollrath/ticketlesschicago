// Stripe webhook endpoint at correct path: /api/webhooks/stripe
// This file re-exports the main stripe webhook handler

export { default } from '../stripe-webhook';
export { config } from '../stripe-webhook';

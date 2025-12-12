// Stripe webhook endpoint at correct path: /api/webhooks/stripe
// This file re-exports the main stripe webhook handler

export { default } from '../stripe-webhook';

// Config must be defined directly in this file (Next.js 15.5+ requirement)
export const config = {
  api: {
    bodyParser: false
  }
};

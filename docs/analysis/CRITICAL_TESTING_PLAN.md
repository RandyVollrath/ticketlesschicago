# Critical Testing Plan - Protection Purchase Flow

## The Problem

The most critical function of the app (users paying for Protection and getting access) was broken in production with no automated way to detect it.

**What was broken:**
- Users paid money ✅
- Users got email ✅
- Users' legal consents were NOT created ❌
- Users' payment audit logs were NOT created ❌

**Why it wasn't caught:**
- No automated tests
- No post-deployment smoke tests
- No monitoring/alerting for incomplete purchases
- Webhook returned 200 (success) even though it didn't complete

## Immediate Actions (Do This Week)

### 1. Smoke Test Script (Run After Every Deploy)

Create `scripts/smoke-test-protection.js`:

```javascript
#!/usr/bin/env node
// Automated smoke test - runs after each deployment
// Uses Stripe test mode to verify Protection purchase works end-to-end

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

async function smokeTest() {
  const testEmail = `smoke-test-${Date.now()}@autopilotamerica.com`;

  console.log('🧪 Running Protection purchase smoke test...');
  console.log('Test email:', testEmail);

  // 1. Create a test Stripe checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: 'https://autopilotamerica.com/success',
    customer_email: testEmail,
    line_items: [{ price: process.env.STRIPE_PROTECTION_PRICE_ID, quantity: 1 }],
    metadata: {
      product: 'ticket_protection',
      plan: 'monthly',
      // ... other metadata
    }
  });

  // 2. Simulate webhook (call our webhook endpoint with test event)
  const webhookEvent = {
    type: 'checkout.session.completed',
    data: { object: session }
  };

  const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/stripe-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookEvent)
  });

  if (!response.ok) {
    console.error('❌ WEBHOOK FAILED:', await response.text());
    process.exit(1);
  }

  // 3. Wait for async operations
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Verify EVERYTHING was created
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users.find(u => u.email === testEmail);

  if (!user) {
    console.error('❌ SMOKE TEST FAILED: User not created');
    process.exit(1);
  }

  const userId = user.id;

  // Check profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!profile || !profile.has_protection || !profile.stripe_customer_id) {
    console.error('❌ SMOKE TEST FAILED: Profile incomplete');
    console.error('Profile:', profile);
    process.exit(1);
  }

  // Check consents
  const { data: consents } = await supabase
    .from('user_consents')
    .select('*')
    .eq('user_id', userId);

  if (!consents || consents.length === 0) {
    console.error('❌ SMOKE TEST FAILED: No consents created');
    process.exit(1);
  }

  // Check audit logs
  const { data: audits } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', userId);

  if (!audits || audits.length === 0) {
    console.error('❌ SMOKE TEST FAILED: No audit logs created');
    process.exit(1);
  }

  // Cleanup
  await supabase.auth.admin.deleteUser(userId);

  console.log('✅ SMOKE TEST PASSED');
  console.log('  ✅ Profile created');
  console.log('  ✅ Consents logged');
  console.log('  ✅ Audit trail recorded');
  console.log('');
  console.log('🎉 Protection purchase flow is working correctly');
}

smokeTest().catch(err => {
  console.error('❌ SMOKE TEST CRASHED:', err);
  process.exit(1);
});
```

**Run this after EVERY deployment:**
```bash
npm run build && vercel deploy && npm run smoke-test
```

### 2. GitHub Actions CI/CD

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy with Smoke Test

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Deploy to Vercel
        run: vercel deploy --prod
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}

      - name: Run Smoke Test
        run: npm run smoke-test
        env:
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
          NEXT_PUBLIC_SITE_URL: https://autopilotamerica.com

      - name: Alert on Failure
        if: failure()
        run: |
          curl -X POST https://api.resend.com/emails \
            -H "Authorization: Bearer ${{ secrets.RESEND_API_KEY }}" \
            -d '{"from":"alerts@autopilotamerica.com","to":"randyvollrath@gmail.com","subject":"🚨 DEPLOY FAILED - Smoke test failed","text":"Deployment succeeded but smoke test failed. DO NOT USE THIS VERSION."}'
```

### 3. Real-Time Monitoring Script

Create `scripts/monitor-protection-purchases.js`:

```javascript
#!/usr/bin/env node
// Runs every 5 minutes via cron
// Checks recent Protection purchases for completeness

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

async function monitor() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get Protection purchases from last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: recentProtection } = await supabase
    .from('user_profiles')
    .select('user_id, email, created_at')
    .eq('has_protection', true)
    .gte('created_at', tenMinutesAgo);

  if (!recentProtection || recentProtection.length === 0) {
    console.log('No recent Protection purchases');
    return;
  }

  console.log(`Checking ${recentProtection.length} recent Protection purchases...`);

  const issues = [];

  for (const user of recentProtection) {
    // Check consents
    const { data: consents } = await supabase
      .from('user_consents')
      .select('*')
      .eq('user_id', user.user_id);

    if (!consents || consents.length === 0) {
      issues.push({
        email: user.email,
        userId: user.user_id,
        issue: 'Missing consents'
      });
    }

    // Check audit logs
    const { data: audits } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('user_id', user.user_id);

    if (!audits || audits.length === 0) {
      issues.push({
        email: user.email,
        userId: user.user_id,
        issue: 'Missing audit logs'
      });
    }
  }

  if (issues.length > 0) {
    // Send alert
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Alerts <alerts@autopilotamerica.com>',
      to: 'randyvollrath@gmail.com',
      subject: '🚨 CRITICAL: Incomplete Protection Purchases Detected',
      text: `Found ${issues.length} Protection purchases with missing data:\n\n${JSON.stringify(issues, null, 2)}\n\nWebhook may not be completing properly!`
    });

    console.error('❌ ISSUES FOUND:', issues);
    process.exit(1);
  }

  console.log('✅ All recent Protection purchases are complete');
}

monitor().catch(console.error);
```

**Add to Vercel cron jobs:**
```json
{
  "crons": [
    {
      "path": "/api/cron/monitor-protection-purchases",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### 4. Webhook Success Criteria

Update the webhook to ONLY return 200 if EVERYTHING completed:

```javascript
// At end of Protection purchase flow
let webhookComplete = {
  profile: false,
  email: false,
  consent: false,
  audit: false
};

try {
  // Create profile
  webhookComplete.profile = true;

  // Send email
  webhookComplete.email = true;

  // Create consent
  webhookComplete.consent = true;

  // Log audit
  webhookComplete.audit = true;

  if (Object.values(webhookComplete).every(v => v === true)) {
    console.log('✅ Protection purchase fully completed');
    return res.status(200).json({ success: true });
  } else {
    console.error('❌ Protection purchase incomplete:', webhookComplete);
    return res.status(500).json({ error: 'Incomplete purchase', details: webhookComplete });
  }
} catch (error) {
  return res.status(500).json({ error: error.message });
}
```

Now Stripe dashboard will show failures if anything doesn't complete.

## Long-Term Actions (Do This Month)

### 5. Full Test Suite

Create `tests/protection-purchase.test.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Protection Purchase Flow', () => {
  test('new user can purchase Protection and access account', async ({ page }) => {
    const testEmail = `test-${Date.now()}@autopilotamerica.com`;

    // 1. Go to Protection page
    await page.goto('https://autopilotamerica.com/protection');

    // 2. Fill out form
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="phone"]', '5551234567');
    await page.check('input[name="consent"]');

    // 3. Click Get Protection
    await page.click('button:has-text("Get Complete Protection")');

    // 4. Complete Stripe checkout
    await page.waitForURL(/checkout.stripe.com/);
    await page.fill('[name="email"]', testEmail);
    await page.fill('[name="cardNumber"]', '4242424242424242');
    await page.fill('[name="cardExpiry"]', '12/34');
    await page.fill('[name="cardCvc"]', '123');
    await page.fill('[name="billingName"]', 'Test User');
    await page.click('button[type="submit"]');

    // 5. Should redirect to success
    await page.waitForURL(/autopilotamerica.com\/alerts\/success/);

    // 6. Check email was sent (check test email inbox API)
    // ...

    // 7. Verify database records
    const supabase = createClient(...);
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email === testEmail);

    expect(user).toBeTruthy();

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    expect(profile.has_protection).toBe(true);
    expect(profile.stripe_customer_id).toBeTruthy();

    const { data: consents } = await supabase
      .from('user_consents')
      .select('*')
      .eq('user_id', user.id);

    expect(consents.length).toBeGreaterThan(0);

    const { data: audits } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('user_id', user.id);

    expect(audits.length).toBeGreaterThan(0);
  });
});
```

### 6. Staging Environment

Set up a staging environment:
- `staging.autopilotamerica.com`
- Separate Supabase project
- Stripe test mode
- Test EVERY deployment here before production

## Summary: Never Let This Happen Again

**Immediate (this week):**
1. ✅ Bug is fixed (consents now created)
2. Create smoke test script
3. Run smoke test after every deploy manually

**Short-term (this month):**
1. Set up GitHub Actions to auto-deploy + smoke test
2. Add monitoring cron job (alerts if purchases incomplete)
3. Update webhook to return 500 if anything fails

**Long-term (next quarter):**
1. Full Playwright test suite
2. Staging environment
3. Pre-production testing requirement

**Critical Rule:**
**NEVER deploy webhook changes without running a real test purchase in production immediately after.**

This should have been caught on the FIRST test after deployment. The fact that real customers hit this is unacceptable.

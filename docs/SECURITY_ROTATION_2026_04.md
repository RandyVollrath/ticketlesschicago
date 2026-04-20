# Vercel April 2026 Incident — Rotation Checklist

**Context:** On 2026-04-19, Vercel disclosed a compromise originating from Context.ai that gave an attacker access to a Vercel employee's Google Workspace, then to Vercel environments and all env vars **not marked as "sensitive."**

**Project status (audited 2026-04-20):** 104 env vars in `ticketless-chicago`, **0 marked sensitive**. Treat every secret below as potentially exposed.

Source of truth for the type flag:
```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/prj_M8zKwqV1tjcl6wezjknAyyaYPsKC/env?teamId=team_4hx1IYCoyNuNB7l53P7S5pOb" \
  | jq '.envs[] | {key, type, target}'
```

---

## P0 — Rotate first (hours, not days)

These grant write access to money, user data, or admin surface.

| Var | Where to rotate | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` (prod + dev/preview) | Stripe → Developers → API keys → Roll | Webhook deliveries continue; rotate webhook secret separately |
| `STRIPE_WEBHOOK_SECRET` (prod + dev/preview) | Stripe → Webhooks → endpoint → Roll signing secret | Must redeploy before events drop |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → Reset service_role JWT | **Bypasses RLS.** Invalidates all existing service tokens |
| `MSC_SUPABASE_SERVICE_ROLE_KEY` | Supabase (MyStreetCleaning project) → Reset service_role JWT | Same blast radius for MSC project |
| `FIREBASE_PRIVATE_KEY` (+ `FIREBASE_CLIENT_EMAIL`) | GCP Console → IAM → Service Accounts → rotate key | Old key must be revoked, not just left orphaned |
| `LOB_API_KEY` | Lob → Settings → API Keys | Real mail, real money. Check recent sends |
| `NEXTAUTH_SECRET` | Generate with `openssl rand -base64 32` | Invalidates all sessions — users must re-login |
| `CRON_SECRET` | Generate with `openssl rand -base64 32` | Auth for `/api/cron/*` routes |
| `ADMIN_API_TOKEN` | Generate with `openssl rand -base64 32` | Admin-only endpoint auth |
| `REMITTER_API_KEY` | Generate with `openssl rand -base64 32` | Remitter portal auth |
| `UTILITYAPI_TOKEN` | UtilityAPI dashboard → regenerate | Customer utility data |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob → rotate | Otherwise attacker can read/overwrite uploads |

## P1 — Rotate same day (billable API keys)

Attacker can run up charges on your account.

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` (3 envs)
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_CLOUD_VISION_CREDENTIALS` (3 envs — service-account JSON, rotate the SA key in GCP)
- `ELEVENLABS_API_KEY`
- `RESEND_API_KEY`
- `CLICKSEND_API_KEY` (+ `CLICKSEND_USERNAME`)
- `REWARDFUL_API_SECRET`
- `OPENWEATHERMAP_API_KEY`

## P2 — Rotate this week (webhook signing / integration secrets)

Lower blast radius (forging inbound webhooks), but still worth rotating.

- `CLICKSEND_WEBHOOK_SECRET`
- `CLOUDFLARE_EMAIL_WORKER_SECRET`
- `RESEND_EVIDENCE_WEBHOOK_SECRET`
- `RESEND_WEBHOOK_SECRET`

## P3 — Configuration values (no rotation needed)

Non-secret or already public. Verify each is correct but do not rotate:

- All `NEXT_PUBLIC_*` (shipped to browser bundle already)
- All `STRIPE_*_PRICE_ID` (price IDs are public identifiers)
- `STRIPE_MODE`, `STRIPE_CONNECT_CLIENT_ID`, `NEXTAUTH_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `RESEND_FROM`, `SMS_SENDER`, `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`, `LOB_TEST_MODE`, `DRY_RUN`, `FIREBASE_PROJECT_ID`, `GOOGLE_MEASUREMENT_ID`, `REWARDFUL_CUSTOMER_CAMPAIGN_ID`, `ADMIN_ALERT_EMAILS`, `ADMIN_NOTIFICATION_EMAILS`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`

## ⚠️ `NEXT_PUBLIC_ADMIN_TOKEN`

If a token is `NEXT_PUBLIC_*`, it's baked into the client bundle — meaning it's always been public. Review the code that uses it; an admin token should not be `NEXT_PUBLIC_`. Either rotate + remove the prefix (server-only) or audit what it actually gates.

---

## Procedure for each rotation

1. **Generate** the new value.
2. **Set it** in Vercel *with the Sensitive flag*:
   ```bash
   # CLI doesn't support --sensitive as of v51 — use the dashboard OR API:
   curl -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.vercel.com/v10/projects/prj_M8zKwqV1tjcl6wezjknAyyaYPsKC/env?teamId=team_4hx1IYCoyNuNB7l53P7S5pOb" \
     -d '{"key":"STRIPE_SECRET_KEY","value":"sk_live_...","type":"sensitive","target":["production"]}'
   ```
3. **Redeploy** (`npx vercel --prod --yes`) so the new value is live.
4. **Revoke the old** at the upstream provider.
5. **Update local** `.env.local` and mobile app env if referenced.

## Post-rotation verification

- Run `node scripts/audit-security-incident.js` (see that file for what it checks).
- Vercel Dashboard → Activity Log → scan last 14 days for unfamiliar deployments, env reads, team changes.
- Google Workspace → Admin → Security → OAuth app access → search for `110671459871-30f1spbu0hptbs60cb4vsmv79i7bbvqj` (the Context.ai IOC) and revoke if found.
- Stripe Dashboard → Developers → Logs → filter to API requests from unusual IPs.
- Supabase Dashboard → Logs → filter auth events + DB for service-role usage outside expected IPs.

## Going forward

- Set every future secret with `type: sensitive` via API or dashboard checkbox.
- Consider a pre-commit / CI check that fails if any env var in the project is not marked sensitive.

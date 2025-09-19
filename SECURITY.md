# 🔒 Security Guidelines

## API Key Management

### ✅ DO:
- Keep API keys in `.env.local` (already in `.gitignore`)
- Use placeholder values in committed files (`your-api-key-here`)
- Store production keys in Vercel environment variables
- Rotate keys immediately if exposed
- Use the pre-commit hook to catch leaks

### ❌ DON'T:
- Never commit `.env.local` or `.env` files
- Never hardcode API keys in source code
- Never share keys in chat/email/screenshots
- Never commit real keys even temporarily

## Environment Setup

### Local Development:
1. Copy `.env.example` to `.env.local`
2. Add your real API keys to `.env.local` only
3. Never commit `.env.local`

### Production (Vercel):
1. Add environment variables in Vercel dashboard
2. Deploy will automatically use these secure values

## Pre-commit Hook

A pre-commit hook is installed that will:
- Scan for potential API key patterns
- Block commits containing `.env` files
- Prevent known API key formats from being committed

If blocked, the hook will show an error message and prevent the commit.

## Key Rotation Checklist

If keys are ever exposed:

1. **Immediately rotate keys:**
   - Resend: https://resend.com/api-keys
   - ClickSend: https://dashboard.clicksend.com/#/account/subaccount

2. **Update all deployments:**
   - Vercel environment variables
   - Local `.env.local` file

3. **Verify the old keys are revoked**

4. **Test that services still work**

## Emergency Contact

If you discover a security issue:
- Rotate keys immediately
- Update this documentation if needed
- Review all recent commits for other potential leaks

## Tools Used

- **Pre-commit hook**: Scans for API key patterns
- **`.gitignore`**: Excludes environment files
- **Vercel environment variables**: Secure production storage

---

*Last updated: $(date)*
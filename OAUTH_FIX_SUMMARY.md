# OAuth Redirect Bug - Executive Summary

## The Problem

Users logging in from protected pages (like `/admin/message-audit` or `/notification-preferences`) are redirected to `/settings` instead of returning to the page they came from.

## Root Cause (The Smoking Gun)

**Supabase's `detectSessionInUrl: true` configuration is processing auth tokens and modifying the URL BEFORE our callback handler can read the redirect parameter.**

### The Race Condition

```
1. User clicks "Sign In" from /admin/message-audit
2. Protected page redirects to /login?redirect=/admin/message-audit ✅
3. Login page passes redirect to OAuth callback URL ✅
4. OAuth redirects to /auth/callback?redirect=/admin/message-audit#access_token=... ✅
5. Supabase detectSessionInUrl runs FIRST, modifies URL ⚠️
6. Callback handler runs SECOND, reads window.location.search ❌
7. Query params are gone, defaults to /settings ❌
```

## Why Previous Fix Failed

The previous fix correctly passed the redirect parameter through the entire flow:
- ✅ Protected pages set `?redirect=/admin/message-audit`
- ✅ Login page reads redirect from query params
- ✅ OAuth callback URL includes `?redirect=/admin/message-audit`
- ✅ Magic link API includes redirect in callback URL

**BUT:** Supabase processes the URL before our code runs, stripping/modifying the query parameters.

## The Solution: SessionStorage

Instead of passing redirect via URL query params (which get consumed by Supabase), store it in `sessionStorage` before initiating auth.

### Why SessionStorage?

1. **Survives URL modifications** - Supabase can't touch it
2. **Tab-specific** - Won't interfere with other tabs
3. **Automatic cleanup** - Cleared when tab closes
4. **Already proven** - Used elsewhere in codebase (pendingFreeSignup, expectedGoogleEmail)
5. **Backwards compatible** - Can fall back to URL param

## Implementation Plan

### 3 Files to Change

1. **`/pages/login.tsx`**
   - Before each auth method (Google, Magic Link, Password, Passkey)
   - Add: `sessionStorage.setItem('postAuthRedirect', redirectUrl)`
   - On error: `sessionStorage.removeItem('postAuthRedirect')`

2. **`/pages/auth/callback.tsx`** (lines 321-336)
   - Replace URL param reading with sessionStorage reading
   - Fall back to URL param for backwards compatibility
   - Clean up after reading

3. **`/pages/api/auth/send-magic-link.ts`** (lines 9-28)
   - Remove `redirectTo` from request body
   - Simplify callback URL (no query param needed)

### Testing Required

**3 Scenarios × 2 Pages = 6 Tests:**

| Scenario | Starting Page | Auth Method | Expected Destination |
|----------|--------------|-------------|---------------------|
| 1 | /admin/message-audit | Google OAuth | /admin/message-audit |
| 2 | /admin/message-audit | Magic Link | /admin/message-audit |
| 3 | /notification-preferences | Google OAuth | /notification-preferences |
| 4 | /notification-preferences | Magic Link | /notification-preferences |
| 5 | Direct login (no redirect) | Any | /settings |
| 6 | Login error | Any | Clean up sessionStorage |

## Risk Assessment

**Risk Level: LOW ✅**

- Small, isolated changes (3 files)
- Backwards compatible (falls back to URL param)
- Proven pattern (already used in codebase)
- Easy to test
- Easy to rollback

## Confidence Level

**95% confident this will fix the issue** because:

1. Root cause clearly identified (Supabase detectSessionInUrl)
2. Solution addresses the root cause (bypass URL modifications)
3. Pattern already proven in same codebase
4. No breaking changes to existing functionality

## Next Steps

1. Review detailed implementation guide in `OAUTH_REDIRECT_INVESTIGATION.md`
2. Implement changes in 3 files
3. Test all 6 scenarios locally
4. Deploy to staging
5. User acceptance testing
6. Deploy to production

---

**For full technical details, see `OAUTH_REDIRECT_INVESTIGATION.md`**

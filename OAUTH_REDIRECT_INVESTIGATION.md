# OAuth Redirect Issue - Root Cause Analysis & Solution

## Executive Summary

**THE SMOKING GUN:** The redirect parameter is being properly passed through the OAuth flow, but **Supabase's `detectSessionInUrl` config is automatically processing the auth tokens and triggering a redirect BEFORE our callback handler runs**.

All three authentication flows (Google OAuth, Magic Link, Password) redirect to `/settings` because:
1. Supabase auto-detects the session
2. The callback page's `window.location.href` redirect runs (lines 336 in callback.tsx)
3. BUT the redirect param gets read from `window.location.search` which **no longer contains the redirect param** because Supabase already processed it

---

## Why Previous Fix Failed

### What We Thought Would Happen:
```
1. User clicks login from /admin/message-audit
2. OAuth redirects to /auth/callback?redirect=/admin/message-audit
3. callback.tsx reads redirect param
4. Redirects to /admin/message-audit ✅
```

### What Actually Happens:
```
1. User clicks login from /admin/message-audit
2. OAuth redirects to /auth/callback?redirect=/admin/message-audit#access_token=...
3. Supabase detectSessionInUrl runs FIRST, strips the hash
4. callback.tsx useEffect runs
5. window.location.search is NOW EMPTY (Supabase consumed it)
6. Falls back to default: /settings ❌
```

---

## Evidence

### 1. Callback Handler (lines 321-336 of `/pages/auth/callback.tsx`)
```typescript
// Check for redirect parameter, default to settings
const urlParams = new URLSearchParams(window.location.search);
const redirectPath = urlParams.get('redirect') || '/settings';  // ❌ PROBLEM: search params already consumed

console.log('=== POST-AUTH REDIRECT ===')
console.log('redirect parameter:', redirectPath)  // This logs '/settings' even when redirect was passed

// Use window.location for absolute redirect
const redirectUrl = window.location.origin + redirectPath;
window.location.href = redirectUrl;  // Redirects to /settings
```

**The Issue:** By the time this code runs, `window.location.search` has been cleared/modified by Supabase's session detection.

### 2. Supabase Config (`/lib/supabase.ts` lines 17-24)
```typescript
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,  // ❌ THIS IS THE CULPRIT
    storage: typeof window !== 'undefined' ? window.localStorage : undefined
  }
})
```

**The Issue:** `detectSessionInUrl: true` makes Supabase automatically process auth tokens in the URL, which modifies the URL and can clear query params.

### 3. Protected Pages Properly Pass Redirect

Both protected pages correctly include the redirect parameter:

**`/pages/admin/message-audit.tsx` (lines 507-512)**
```typescript
if (!session) {
  return {
    redirect: {
      destination: '/login?redirect=/admin/message-audit',  // ✅ Correct
      permanent: false
    }
  };
}
```

**`/pages/notification-preferences.tsx` (lines 522-528)**
```typescript
if (!session) {
  return {
    redirect: {
      destination: '/login?redirect=/notification-preferences',  // ✅ Correct
      permanent: false
    }
  };
}
```

### 4. Login Page Passes Redirect to OAuth

**`/pages/login.tsx` (lines 52-76)**
```typescript
const handleGoogleAuth = async () => {
  // Get the redirect URL and pass it to the callback
  const redirectUrl = getRedirectUrl()  // ✅ Gets from query param
  const callbackUrl = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectUrl)}`  // ✅ Passes it

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl  // ✅ Sends to callback with redirect param
    }
  })
}
```

### 5. Magic Link API Passes Redirect

**`/pages/api/auth/send-magic-link.ts` (lines 20-36)**
```typescript
const { email, redirectTo } = req.body;

console.log('📍 Redirect destination:', redirectTo || '/settings (default)');

// Build callback URL with redirect parameter
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
const callbackPath = '/auth/callback';
const finalRedirect = redirectTo || '/settings';
const callbackUrl = `${baseUrl}${callbackPath}?redirect=${encodeURIComponent(finalRedirect)}`;  // ✅ Correct

const { data: linkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: email,
  options: {
    redirectTo: callbackUrl  // ✅ Passes redirect param
  }
});
```

---

## The Real Problem: Race Condition

```
┌─────────────────────────────────────────────────────────────┐
│ URL: /auth/callback?redirect=/admin/message-audit#access... │
└─────────────────────────────────────────────────────────────┘
                         │
                         ├─────────────────────────────────┐
                         │                                 │
                         ▼                                 ▼
              ┌──────────────────┐              ┌──────────────────┐
              │ Supabase Client  │              │  Callback Page   │
              │ detectSessionInUrl│              │   useEffect      │
              └──────────────────┘              └──────────────────┘
                         │                                 │
                         │ RUNS FIRST ⚡                   │ RUNS SECOND
                         │                                 │
                         ▼                                 ▼
              ┌──────────────────┐              ┌──────────────────┐
              │ Processes hash   │              │ Reads URL params │
              │ Modifies URL     │              │ Finds empty!     │
              │ Sets session     │              │ Uses /settings   │
              └──────────────────┘              └──────────────────┘
```

---

## Solution Architecture

We need to **preserve the redirect destination across the OAuth flow** using a method that survives URL modifications.

### Option 1: SessionStorage (RECOMMENDED)
**Pros:**
- Survives URL modifications
- Tab-specific (won't affect other tabs)
- Cleared when tab closes (security)
- Already used in the codebase for other flow state

**Implementation:**
1. Store redirect destination in sessionStorage BEFORE initiating OAuth
2. Read from sessionStorage in callback (not from URL)
3. Clean up after redirect

### Option 2: State Parameter (Supabase Native)
**Pros:**
- Built into OAuth spec
- Supabase preserves it
- More "correct" architecturally

**Cons:**
- May not work with Supabase's implicit flow
- Requires testing

### Option 3: Disable detectSessionInUrl
**Pros:**
- Would prevent URL modification
- Forces manual session handling

**Cons:**
- Breaks existing flows (free signup, paid signup, etc.)
- Requires massive refactor
- High risk

---

## Recommended Solution: SessionStorage Approach

### Files to Modify

#### 1. `/pages/login.tsx`

**Lines 52-77** - Google OAuth:
```typescript
const handleGoogleAuth = async () => {
  try {
    setLoading(true)
    setAuthMethod('google')

    // Store redirect destination in sessionStorage BEFORE OAuth
    const redirectUrl = getRedirectUrl()
    sessionStorage.setItem('postAuthRedirect', redirectUrl)
    console.log('🔖 Stored redirect destination:', redirectUrl)

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`  // Remove redirect param from URL
      }
    })

    if (error) throw error
  } catch (error: any) {
    sessionStorage.removeItem('postAuthRedirect')  // Clean up on error
    setMessage({
      type: 'error',
      text: error.message || 'An error occurred with Google sign in'
    })
    setLoading(false)
    setAuthMethod(null)
  }
}
```

**Lines 79-138** - Magic Link:
```typescript
const handleMagicLink = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!email) {
    setMessage({
      type: 'error',
      text: 'Please enter your email address'
    })
    return
  }

  setLoading(true)
  setMessage(null)
  setAuthMethod('magic-link')

  try {
    // Store redirect destination in sessionStorage
    const redirectUrl = getRedirectUrl()
    sessionStorage.setItem('postAuthRedirect', redirectUrl)
    console.log('🔖 Stored redirect destination for magic link:', redirectUrl)

    const response = await fetch('/api/auth/send-magic-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email
        // No longer passing redirectTo - using sessionStorage instead
      })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send magic link')
    }

    setMessage({
      type: 'success',
      text: data.message || 'Check your email for the magic link!'
    })
  } catch (error: any) {
    sessionStorage.removeItem('postAuthRedirect')  // Clean up on error
    console.error('Magic link error details:', error)
    
    setMessage({
      type: 'error',
      text: error.message || 'An error occurred sending the magic link'
    })
  } finally {
    setLoading(false)
    setAuthMethod(null)
  }
}
```

**Lines 140-210** - Password Auth:
```typescript
const handlePasswordAuth = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!email || !password) {
    setMessage({
      type: 'error',
      text: 'Please enter both email and password'
    })
    return
  }

  setLoading(true)
  setMessage(null)
  setAuthMethod('password')

  try {
    // First try to sign in
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    })

    if (signInError?.message === 'Invalid login credentials') {
      // Try to create account...
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            source: 'ticketless-america-login'
          }
        }
      })

      if (signUpError) {
        setMessage({
          type: 'error',
          text: 'Invalid email or password.'
        })
      } else if (signUpData?.user?.identities?.length === 0) {
        setMessage({
          type: 'error',
          text: 'Account exists but password is incorrect.'
        })
      } else {
        setMessage({
          type: 'success',
          text: 'Account created! Check your email to verify.'
        })
      }
    } else if (signInError) {
      throw signInError
    } else {
      // Successful sign in - redirect using sessionStorage
      const redirectUrl = sessionStorage.getItem('postAuthRedirect') || getRedirectUrl()
      sessionStorage.removeItem('postAuthRedirect')  // Clean up
      console.log('✅ Password login successful, redirecting to:', redirectUrl)
      window.location.href = redirectUrl
    }
  } catch (error: any) {
    sessionStorage.removeItem('postAuthRedirect')  // Clean up on error
    setMessage({
      type: 'error',
      text: error.message || 'An error occurred during authentication'
    })
  } finally {
    setLoading(false)
    setAuthMethod(null)
  }
}
```

**Lines 212-284** - Passkey Auth:
```typescript
const handlePasskeyAuth = async () => {
  if (!passkeysSupported) {
    setMessage({
      type: 'error',
      text: 'Passkeys are not supported on this device or browser'
    })
    return
  }

  setLoading(true)
  setAuthMethod('passkey')
  setMessage(null)

  try {
    const { startAuthentication } = await import('@simplewebauthn/browser')

    const response = await fetch('/api/auth/passkey/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' })
    })

    if (!response.ok) throw new Error('Failed to start passkey authentication')

    const options = await response.json()
    const assertion = await startAuthentication({ optionsJSON: options })

    const verifyResponse = await fetch('/api/auth/passkey/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...assertion,
        challenge: options.challenge
      })
    })

    if (!verifyResponse.ok) throw new Error('Failed to verify passkey')

    const result = await verifyResponse.json()
    if (result.verified && result.session) {
      console.log('Passkey verified, setting session')
      
      await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token
      })

      // Redirect using sessionStorage
      const redirectUrl = sessionStorage.getItem('postAuthRedirect') || getRedirectUrl()
      sessionStorage.removeItem('postAuthRedirect')  // Clean up
      console.log('✅ Passkey login successful, redirecting to:', redirectUrl)
      window.location.href = redirectUrl
    }
  } catch (error: any) {
    sessionStorage.removeItem('postAuthRedirect')  // Clean up on error
    console.error('Passkey auth error:', error)
    
    let errorMessage = 'No passkeys found. Please sign in with email first.'
    
    if (error.name === 'NotAllowedError') {
      errorMessage = 'Passkey authentication was cancelled or failed'
    } else if (error.message && error.message.includes('No passkey found')) {
      errorMessage = 'No passkeys registered yet. Sign in with email to add one!'
    }
    
    setMessage({
      type: 'error',
      text: errorMessage
    })
  } finally {
    setLoading(false)
    setAuthMethod(null)
  }
}
```

#### 2. `/pages/auth/callback.tsx`

**Lines 321-336** - Replace redirect logic:
```typescript
// Check for redirect destination - prioritize sessionStorage over URL param
let redirectPath = sessionStorage.getItem('postAuthRedirect')

if (!redirectPath) {
  // Fallback to URL param (for backwards compatibility)
  const urlParams = new URLSearchParams(window.location.search)
  redirectPath = urlParams.get('redirect')
}

// Clean up and default to /settings
sessionStorage.removeItem('postAuthRedirect')
const finalRedirect = redirectPath || '/settings'

console.log('=== POST-AUTH REDIRECT ===')
console.log('user email:', user.email)
console.log('redirect destination:', finalRedirect)
console.log('source:', redirectPath ? (sessionStorage.getItem('postAuthRedirect') ? 'sessionStorage' : 'URL param') : 'default')

// Perform redirect
const redirectUrl = window.location.origin + finalRedirect
console.log('Full redirect URL:', redirectUrl)
window.location.href = redirectUrl
```

#### 3. `/pages/api/auth/send-magic-link.ts`

**Lines 9-28** - Simplify (no longer needs redirectTo):
```typescript
const { email } = req.body;

if (!email || typeof email !== 'string') {
  return res.status(400).json({ error: 'Email is required' });
}

if (!supabaseAdmin) {
  console.error('Supabase admin client not available');
  return res.status(500).json({ error: 'Server configuration error' });
}

try {
  console.log('📧 Generating magic link for:', email);

  // Simple callback URL - redirect destination stored in sessionStorage
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const callbackUrl = `${baseUrl}/auth/callback`;

  // Generate magic link using admin API
  const { data: linkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: callbackUrl  // No redirect param needed
    }
  });
```

---

## Implementation Steps

1. ✅ **Backup current code** (already done - you have git)

2. **Modify login.tsx**
   - Add sessionStorage.setItem before each auth method
   - Add sessionStorage.removeItem in error handlers
   - Remove redirect param from OAuth URLs

3. **Modify callback.tsx**
   - Check sessionStorage first for redirect
   - Fall back to URL param (backwards compatibility)
   - Clean up sessionStorage after reading

4. **Modify send-magic-link.ts**
   - Remove redirectTo from request body
   - Simplify callback URL (no query param)

5. **Test all 3 scenarios**
   - Scenario 1: /admin/message-audit → login → Google OAuth → should land on /admin/message-audit
   - Scenario 2: /admin/message-audit → login → Magic Link → should land on /admin/message-audit
   - Scenario 3: /notification-preferences → login → any method → should land on /notification-preferences

6. **Edge case testing**
   - Direct login (no redirect param) → should go to /settings
   - Multiple tabs → each tab should maintain own redirect
   - Login error → sessionStorage should be cleaned up

---

## Why This Will Work

1. **SessionStorage survives URL modifications** - Supabase can't touch it
2. **Tab-specific** - Won't interfere with other tabs
3. **Automatic cleanup** - Cleared on tab close
4. **Already proven** - The codebase uses sessionStorage for other flow state (pendingFreeSignup, expectedGoogleEmail)
5. **Backwards compatible** - Falls back to URL param if sessionStorage is empty

---

## Risk Analysis

**Risk Level: LOW**

- ✅ Small, isolated changes
- ✅ Backwards compatible (falls back to URL param)
- ✅ Proven pattern (already used in codebase)
- ✅ Easy to test
- ✅ Easy to rollback if needed

**Potential Issues:**
- Browser doesn't support sessionStorage (rare, but handle gracefully)
- User has sessionStorage disabled (fall back to URL param → /settings)
- Tab closed before redirect (acceptable - user would restart flow)

---

## Alternative Solutions (Why Not Recommended)

### Why Not Use Cookies?
- More complex (need to set/read on both client and server)
- CSRF concerns
- Cookie consent requirements
- Overkill for this use case

### Why Not Use URL State Parameter?
- Supabase may not preserve it in implicit flow
- Would require testing Supabase internals
- Less reliable than sessionStorage

### Why Not Disable detectSessionInUrl?
- Would break existing flows (free signup, paid signup)
- Massive refactor required
- High risk of breaking production

### Why Not Use Router Query?
- Next.js router state gets lost during hard redirects
- window.location.href bypasses router
- Already tried and failed

---

## Testing Checklist

### Pre-deployment
- [ ] Test Google OAuth from /admin/message-audit
- [ ] Test Magic Link from /admin/message-audit
- [ ] Test Google OAuth from /notification-preferences
- [ ] Test Magic Link from /notification-preferences
- [ ] Test direct login (should go to /settings)
- [ ] Test login error handling (sessionStorage cleanup)
- [ ] Test in incognito mode
- [ ] Test with browser sessionStorage disabled

### Post-deployment
- [ ] Monitor error logs for sessionStorage errors
- [ ] Check analytics for redirect success rate
- [ ] User acceptance testing

---

## Success Metrics

**This fix is successful if:**
1. Users redirected from protected pages land back on those pages after auth (100% success rate)
2. Direct logins still go to /settings (backwards compatibility)
3. No increase in auth errors
4. No user complaints about login redirects

**Failure would look like:**
1. Still redirecting to /settings (didn't fix the bug)
2. Redirect to wrong page (new bug introduced)
3. Auth errors increase (broke authentication)
4. SessionStorage errors in logs (browser compatibility issues)

---

## Conclusion

The redirect parameter has been correctly implemented at every step, but Supabase's automatic session detection clears it before the callback handler runs. Using sessionStorage to preserve the redirect destination across the OAuth flow will solve this issue with minimal risk and maximum compatibility.

**Next Step:** Implement the sessionStorage solution in the three files listed above.

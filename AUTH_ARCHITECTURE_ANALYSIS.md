# Authentication Architecture Analysis: Autopilot America Web & Mobile

## Executive Summary

**Autopilot America** uses a **unified Supabase authentication backend** shared between web (autopilotamerica.com) and mobile apps. Both platforms authenticate against the same Supabase instance, allowing seamless cross-platform authentication.

---

## 1. SHARED BACKEND ARCHITECTURE

### Supabase Instance
Both web and mobile use the **same Supabase instance**:
- **URL:** `https://dzhqolbhuqdcpngdayuq.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (same across both platforms)

**Location:**
- Web config: `/home/randy-vollrath/ticketless-chicago/lib/supabase.ts`
- Mobile config: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/config/config.ts`

### Key Implication
A user who logs in on the mobile app automatically creates/accesses the same Supabase user account that would be used on the web app. The accounts are **inherently unified** at the Supabase level.

---

## 2. MOBILE APP AUTH FLOW

### File Structure
- **LoginScreen:** `/TicketlessChicagoMobile/src/screens/LoginScreen.tsx`
- **AuthService:** `/TicketlessChicagoMobile/src/services/AuthService.ts`
- **DeepLinking:** `/TicketlessChicagoMobile/src/services/DeepLinkingService.ts`
- **Config:** `/TicketlessChicagoMobile/src/config/config.ts`

### Authentication Methods

#### 1. **Magic Link (Email OTP)**
```typescript
async signInWithMagicLink(email: string)
```
**Flow:**
1. User enters email in LoginScreen
2. `AuthService.signInWithMagicLink()` calls Supabase OTP endpoint
3. Redirect URL: `ticketlesschicago://auth/callback`
4. Supabase sends email with magic link containing tokens in URL fragment
5. User taps link → Deep link parsed by `DeepLinkingService`
6. Tokens extracted and passed to `supabase.auth.setSession()`
7. User authenticated in app

**Key Code:**
```typescript
const { error } = await this.supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: 'ticketlesschicago://auth/callback',
  },
});
```

#### 2. **Google Sign-In**
```typescript
async signInWithGoogle()
```
**Flow:**
1. User taps "Continue with Google"
2. Native Google Sign-In dialog opens
3. User authenticates with Google, app receives `idToken`
4. App exchanges idToken with Supabase: `supabase.auth.signInWithIdToken()`
5. Supabase creates/links user account
6. Session automatically established

**Config:**
- Google Web Client ID: `475235892792-f369h80bodv82phk7n438rtu677fapqt.apps.googleusercontent.com`
- **Limitation:** Android uses webClientId only (no nonce issues with Supabase)

#### 3. **Apple Sign-In** (iOS only)
```typescript
async signInWithApple()
```
**Flow:**
1. User taps "Continue with Apple"
2. Native Apple Auth dialog opens
3. App receives `identityToken` and `nonce`
4. App exchanges with Supabase: `supabase.auth.signInWithIdToken(provider: 'apple', token, nonce)`
5. Supabase creates/links user account

---

## 3. WEB APP AUTH FLOW

### File Structure
- **Login Page:** `/pages/login.tsx`
- **Auth Callback:** `/pages/auth/callback.tsx`
- **Supabase Client:** `/lib/supabase.ts`
- **Magic Link API:** `/pages/api/auth/send-magic-link.ts`
- **OAuth Callback API:** `/pages/api/auth/oauth-callback.ts`

### Authentication Methods

#### 1. **Magic Link (Email OTP)**
**Flow:**
1. User enters email on `/login.tsx`
2. Frontend calls `/api/auth/send-magic-link` endpoint
3. Server-side generates magic link using `supabaseAdmin.auth.admin.generateLink()`
4. Server sends email via Resend (with retry logic)
5. User clicks link → redirects to `/auth/callback?access_token=...#access_token=...`
6. Client sets session with tokens
7. Redirects to `/settings` or saved redirect destination

**Key Code:**
```typescript
const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: email,
  options: {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
  }
});
```

#### 2. **Google OAuth**
**Flow:**
1. User taps "Continue with Google"
2. Frontend calls: `supabase.auth.signInWithOAuth({ provider: 'google' })`
3. Supabase redirects to Google consent screen
4. User authenticates
5. Google redirects back to `/auth/callback` with tokens
6. Client calls `/api/auth/session` to establish server-side session
7. Redirects to `/settings` or payment/signup flows

#### 3. **Password Auth**
Web app supports email/password login (not used in mobile)

---

## 4. AUTH CALLBACK HANDLING (WEB)

### Cross-Platform Deep Link Detection
The `/pages/auth/callback.tsx` component intelligently detects if the callback is from mobile:

```typescript
const isMobileApp = searchParams.get('mobile') === 'true' ||
                   searchParams.get('redirect_to')?.startsWith('ticketlesschicago://');

if (isMobileApp) {
  // Extract tokens and redirect back to mobile app
  const customSchemeUrl = `ticketlesschicago://auth/callback${queryString}`;
  window.location.href = customSchemeUrl; // iOS
  // OR
  window.location.href = intentUrl;      // Android via intent://
}
```

**What this means:**
- Mobile app can use web's OAuth flow (redirects to autopilotamerica.com)
- Web's callback page detects it's for mobile
- Redirects back to mobile app with tokens via deep link
- Mobile app's DeepLinkingService receives and processes tokens

---

## 5. MOBILE DEEP LINK HANDLING

### DeepLinkingService
Location: `/TicketlessChicagoMobile/src/services/DeepLinkingService.ts`

**Supported Schemes:**
- `ticketlesschicago://` (primary)
- `autopilotamerica://` (alias)
- `https://autopilotamerica.com` (web URLs)

**Auth Callback Route:**
```
ticketlesschicago://auth/callback?access_token=...&refresh_token=...
OR
ticketlesschicago://auth/callback#access_token=...&refresh_token=...
```

**Token Validation:**
```typescript
function isValidAccessToken(token): boolean {
  // JWT format: 3 base64 parts separated by dots
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token);
}

function isValidRefreshToken(token): boolean {
  // Opaque string (non-JWT), length >= 10
  return token.length >= 10 && /^[A-Za-z0-9_-]+[A-Za-z0-9_.\-=]*$/.test(token);
}
```

**Session Establishment:**
```typescript
const { error } = await supabase.auth.setSession({
  access_token: accessToken,
  refresh_token: refreshToken,
});
```

---

## 6. SESSION MANAGEMENT

### Mobile
- **Storage:** AsyncStorage (React Native secure storage adapter)
- **Auto-refresh:** Enabled (`autoRefreshToken: true`)
- **Persistence:** Enabled (`persistSession: true`)
- **Token refresh:** Manual via `AuthService.refreshToken()`

### Web
- **Storage:** `window.localStorage`
- **Auto-refresh:** Enabled (`autoRefreshToken: true`)
- **Persistence:** Enabled (`persistSession: true`)
- **Server-side cookies:** Set via `/api/auth/session` endpoint for SSR

**Server-Side Session (Web Only):**
```typescript
// From callback.tsx
const response = await fetch('/api/auth/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  }),
  credentials: 'include'
});
```

---

## 7. ANSWER: CAN USERS AUTHENTICATE ACROSS PLATFORMS?

### YES - WITH CAVEATS

#### Scenario 1: Mobile → Web (Magic Link)
1. User signs in on mobile via magic link
2. `ticketlesschicago://auth/callback#access_token=...` is processed
3. Supabase session created on mobile
4. User can **manually** open autopilotamerica.com web app
5. Web app has **separate** localStorage session
6. **Result:** Two independent sessions, same user account

**Current Limitation:** No automatic cross-platform redirect

#### Scenario 2: Mobile → Web (Google/Apple)
1. User signs in on mobile with Google/Apple
2. Same Supabase user created
3. User opens web app
4. **Can manually log in with same Google account**
5. Web will recognize same Supabase user
6. **Result:** Two independent sessions, same user account

#### Scenario 3: Web → Mobile (Magic Link)
1. User signs in on web app via magic link
2. Receives token, localStorage session created
3. User opens mobile app
4. **Would need to request magic link on mobile**
5. Email link opens mobile app with tokens
6. **Result:** Two independent sessions, same user account

#### Scenario 4: Web → Mobile (Google)
1. User signs in on web with Google
2. Supabase user created
3. Opens mobile app
4. User signs in with Google (same account)
5. **Result:** Two independent sessions, same user account

### The Gap: No SSO/Single Sign-On
- Users must **separately** authenticate on each platform
- There's **no automatic cross-platform session sharing**
- Both platforms authenticate against the same Supabase instance
- User account is **unified**, but sessions are **platform-specific**

---

## 8. API BACKEND INTEGRATION

### Mobile API Calls
```typescript
// From AuthService.authenticatedFetch()
const response = await fetch(url, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

**API Base URL:** `https://autopilotamerica.com` (web backend)

### Key Endpoint: `/api/mobile/check-parking.ts`
Mobile app calls web backend's parking check API
- Uses Bearer token authentication
- Same Supabase user account can be verified on backend

---

## 9. RECOMMENDED ENHANCEMENTS FOR TRUE SSO

### Option A: Token Sharing (Simple)
1. Generate a short-lived cross-platform token after any auth
2. Store in Supabase user metadata or session table
3. Other platform can verify token to auto-login
4. **Pros:** Simple, no new infrastructure
5. **Cons:** Time-limited, requires platform coordination

### Option B: Auth State Sync (Medium)
1. Use deep links to pass tokens between platforms
2. When user logs in, if app is installed, redirect to other platform
3. Other platform receives tokens via deep link
4. **Pros:** Seamless experience
5. **Cons:** Requires app presence detection, platform-specific

### Option C: OAuth Unified Flow (Complex)
1. Create auth.autopilotamerica.com as OAuth provider
2. Both web and mobile use OAuth to this provider
3. Provider maintains session across platforms
4. **Pros:** True SSO, industry standard
5. **Cons:** Significant infrastructure

### Option D: Current Design Enhancement (Minimal)
1. Detect if user already has session on other platform
2. Show "Sign in with [web/mobile]" button
3. Pre-fill email if available
4. **Pros:** Non-intrusive, familiar UX
5. **Cons:** Still requires manual action

---

## 10. SECURITY CONSIDERATIONS

### Strengths
- ✅ HTTPS-only Supabase connections
- ✅ Token validation (JWT format checks)
- ✅ Rate limiting on magic link endpoint
- ✅ Email-based rate limiting prevents spam
- ✅ Secure storage (AsyncStorage on mobile, localStorage on web)
- ✅ Auto token refresh enabled
- ✅ Deep link token parameter validation

### Potential Concerns
- ⚠️ Magic link tokens in URL (visible in browser history)
- ⚠️ No cross-platform session invalidation
- ⚠️ If one platform's session compromised, Supabase session compromised
- ⚠️ No proof-of-possession for cross-platform authentication

---

## 11. NAMING: "AUTOPILOT AMERICA" vs "TICKETLESS CHICAGO"

From code analysis:

**Brand Names:**
- **App Name:** "Autopilot America" (official)
- **Legacy:** "Ticketless Chicago" (still used in deep link scheme)
- **Domain:** autopilotamerica.com (web)
- **Mobile Bundle:** fyi.ticketless.app
- **Deep Link Schemes:** Both `ticketlesschicago://` and `autopilotamerica://` work

**Implication:** Likely rebrand from "Ticketless Chicago" to "Autopilot America" with legacy code still using old names.

---

## SUMMARY TABLE

| Aspect | Mobile | Web |
|--------|--------|-----|
| **Supabase Instance** | Same (dzhqolbhuqdcpngdayuq) | Same |
| **Anon Key** | Same | Same |
| **Auth Methods** | Magic Link, Google, Apple | Magic Link, Google, Password |
| **Session Storage** | AsyncStorage | localStorage + server cookies |
| **API Base URL** | https://autopilotamerica.com | N/A (same server) |
| **Deep Link Schemes** | ticketlesschicago://, autopilotamerica:// | https://autopilotamerica.com |
| **Account Linking** | Yes (same Supabase user) | Yes (same Supabase user) |
| **Automatic SSO** | No | No |
| **Token Refresh** | Auto + manual | Auto |

---

## CONCLUSION

**Yes, Autopilot America web and mobile apps share a unified Supabase authentication backend.** A user's account is the same across both platforms. However, **sessions are independent** — signing in on one platform doesn't automatically sign you in on the other. This is a common pattern (similar to Google, Slack, etc.) and provides flexibility for platform-specific session management while maintaining account unity.

To enable true single sign-on, one of the enhancement options (A-D) would need implementation.

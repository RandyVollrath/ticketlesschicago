# Backend API Structure & Architecture Summary

## 1. API Route Organization

### Root API Directory Structure
The backend API is organized using **Next.js API routes** in `/pages/api/` with a hierarchical structure:

```
/pages/api/
├── /admin/                 # Admin-specific endpoints
├── /auth/                  # Authentication endpoints
├── /push/                  # Push notification registration
├── /notifications/         # Notification processing
├── /profile/               # User profile management
├── /cron/                  # Scheduled jobs (Vercel cron)
├── /email/                 # Email handling
├── /renewals/              # Renewal processing endpoints
├── /permits-zone/          # Parking permit zone endpoints
├── /protection/            # Protection service endpoints
├── /street-cleaning/       # Street cleaning data endpoints
├── /weather/               # Weather-related endpoints
├── /sms/                   # SMS endpoints
├── /stripe-connect/        # Stripe integration
└── [40+ other specialized directories for various features]
```

**Architecture Pattern:** File-based routing where each `.ts` file becomes a route handler
- Example: `/pages/api/auth/send-magic-link.ts` → POST `/api/auth/send-magic-link`
- Handler pattern: `export default async function handler(req: NextApiRequest, res: NextApiResponse)`

---

## 2. Push Notification Endpoints

### Registration & Management
**Location:** `/pages/api/push/`

#### POST `/api/push/register-token`
- **Purpose:** Register/update push notification token for a device
- **Auth:** Bearer token (user's access token)
- **Request Body:**
  ```typescript
  {
    token: string;              // FCM/APNs token
    platform: 'ios' | 'android' | 'web';
    deviceId?: string;          // Unique device identifier
    deviceName?: string;        // e.g., "iPhone 15 Pro"
    appVersion?: string;        // e.g., "1.0.0"
  }
  ```
- **Response:**
  ```typescript
  {
    success: boolean;
    tokenId?: string;           // UUID of registered token
    error?: string;
  }
  ```
- **Database:** Uses `register_push_token()` RPC function to upsert tokens into `push_tokens` table

#### POST `/api/push/deactivate-token`
- **Purpose:** Deactivate a push token (logout, disable notifications)
- **Request Body:**
  ```typescript
  {
    token: string;              // Token to deactivate
  }
  ```
- **Response:**
  ```typescript
  {
    success: boolean;
    error?: string;
  }
  ```
- **Database:** Calls `deactivate_push_token()` RPC function

### Notification Processing
**Location:** `/pages/api/notifications/`

#### POST/GET `/api/notifications/process`
- **Purpose:** Main notification processing endpoint (called by Vercel cron)
- **Auth:** None (Vercel cron secret validation possible)
- **Functionality:** Processes pending reminders from `user_profiles` table
  - Checks renewal dates (city sticker, license plate, emissions)
  - Sends notifications via email, SMS, or push
  - Handles different reminder schedules for Protection vs Free users
- **Response:**
  ```typescript
  {
    success: boolean;
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
    timestamp: string;
  }
  ```

#### POST `/api/notifications/test-run`
- **Purpose:** Test notification flow for a specific user
- **Auth:** Simple check (email hardcoded)
- **Response:** Detailed logs of notification status check

#### POST `/api/notifications/debug`
- **Purpose:** Debug notification configuration and status

#### POST `/api/notifications/force-test`
- **Purpose:** Force send test notifications

---

## 3. Authentication Endpoints

### Magic Link Authentication
**Location:** `/pages/api/auth/`

#### POST `/api/auth/send-magic-link`
- **Purpose:** Generate and send magic link for passwordless login
- **Rate Limiting:** IP-based and email-based rate limiting
- **Request Body:**
  ```typescript
  {
    email: string;
  }
  ```
- **Features:**
  - Generates magic link using Supabase admin API
  - Sends via Resend email service
  - Records rate limit actions in database
  - Logs magic link requests for audit trail
- **Encryption:** Uses secure email token encryption
- **Response:**
  ```typescript
  {
    success: boolean;
    error?: string;
  }
  ```

#### POST `/api/auth/resend-verification`
- **Purpose:** Resend email verification link
- **Rate Limiting:** Prevents abuse

#### POST `/api/auth/session`
- **Purpose:** Get current user session information

### Passkey Authentication (WebAuthn)
**Location:** `/pages/api/auth/passkey/`

#### POST `/api/auth/passkey/register`
- **Purpose:** Register a new passkey (Face ID, Touch ID, Windows Hello)
- **Flow:** SimpleWebAuthn library used for credential generation

#### POST `/api/auth/passkey/authenticate`
- **Purpose:** Authenticate using registered passkey
- **Features:**
  - Dynamic RP ID/origin based on request host
  - Supports localhost, production domains, Vercel preview deployments
  - Uses Supabase admin client for credential verification
  - Counter verification to prevent cloning attacks

#### POST `/api/auth/passkey/verify`
- **Purpose:** Verify passkey authentication response

### OAuth Integration
**Location:** `/pages/api/auth/oauth-callback.ts`

#### POST/GET `/api/auth/oauth-callback`
- **Purpose:** Handle OAuth provider callbacks
- **Integration:** Syncs user data to MyStreetCleaning service
- **Features:**
  - Address validation during signup
  - Automatic user creation in `user_profiles`
  - Notification preference initialization

### Redirect Management
- **POST `/api/auth/set-redirect`** - Store post-login redirect URL
- **POST `/api/auth/clear-redirect`** - Clear stored redirect

---

## 4. Database Schema for Notifications & Device Tokens

### Core Tables

#### `push_tokens` Table
**Location:** `/sql/push_tokens.sql`

```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Token Details
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  
  -- Device Info
  device_id TEXT,              -- Unique device identifier
  device_name TEXT,            -- e.g., "iPhone 15 Pro"
  app_version TEXT,            -- e.g., "1.0.0"
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, device_id)
);

-- Indexes:
-- - idx_push_tokens_user_id (for token lookup by user)
-- - idx_push_tokens_token (for token deactivation)
-- - idx_push_tokens_active (active tokens only)
```

**RPC Functions:**
- `register_push_token(p_user_id, p_token, p_platform, p_device_id, p_device_name, p_app_version)` - Upsert token
- `get_user_push_tokens(p_user_id)` - Get active tokens for user
- `deactivate_push_token(p_token)` - Deactivate token

**RLS Policies:**
- Users can view, insert, update, delete own tokens
- Service role has full access

---

#### `users` Table (Main Supabase Auth Table)
**Extends Supabase `auth.users` with custom fields:**

```typescript
{
  id: string;                          // UUID from auth.users
  email: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
  email_verified: boolean;
  phone_verified: boolean;
  notification_preferences: Json;     // Dynamic preferences
  
  // Additional fields added via migrations:
  license_plate: VARCHAR(20);
  vin: VARCHAR(17);
  zip_code: VARCHAR(10);
  vehicle_type: VARCHAR(30);
  vehicle_year: INTEGER;
  
  // Renewal dates (for auto-reminders)
  city_sticker_expiry: DATE;
  license_plate_expiry: DATE;
  emissions_date: DATE;
  
  // Address fields
  street_address: VARCHAR(255);
  street_side: VARCHAR(10);            // 'even' or 'odd'
  mailing_address: VARCHAR(255);
  mailing_city: VARCHAR(100);
  mailing_state: VARCHAR(2);
  mailing_zip: VARCHAR(10);
  
  // Service fields
  concierge_service: BOOLEAN;
  city_stickers_only: BOOLEAN;
  spending_limit: INTEGER;
  subscription_status: VARCHAR(20);
}
```

---

#### `notification_logs` Table
**Purpose:** Track all notification attempts for auditing and retry logic

**Columns:**
- `id UUID` - Primary key
- `user_id UUID` - User who received notification
- `email VARCHAR` - Email address
- `phone VARCHAR` - Phone number
- `notification_type` - 'email' | 'sms' | 'voice' | 'push'
- `category` - Type of notification (e.g., 'street_cleaning', 'sticker_renewal')
- `subject VARCHAR` - Email subject or notification title
- `content_preview VARCHAR` - First 200 chars of content
- `status` - 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'retry_scheduled'
- `external_id VARCHAR` - ID from external service (Resend, ClickSend, FCM)
- `metadata JSONB` - Additional context
- `attempt_count INTEGER` - Retry counter
- `last_error TEXT` - Latest error message
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

**RPC Functions:**
- `log_notification()` - Create new log entry
- `update_notification_status()` - Update delivery status
- `get_pending_retries()` - Get failed notifications for retry
- `increment_retry_attempt()` - Track retry attempts

---

#### Winter Ban Notifications
**Location:** `database-migrations/005-add-winter-overnight-parking-ban.sql`

```sql
-- Streets with winter overnight parking ban (3am-7am Dec 1 - Apr 1)
CREATE TABLE winter_overnight_parking_ban_streets (
  id UUID PRIMARY KEY,
  street_name TEXT NOT NULL,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  created_at TIMESTAMPTZ
);

-- Track sent notifications per user per season
CREATE TABLE user_winter_ban_notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  notification_year INTEGER,           -- e.g., 2025 for 2025-2026 season
  notification_date DATE,
  sent_at TIMESTAMPTZ,
  channels TEXT[],                     -- ['email', 'sms']
  status TEXT,                         -- 'sent' or 'failed'
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, notification_year)
);
```

---

#### Snow Ban Notifications
**Location:** `database-migrations/006-add-snow-event-tracking.sql`

```sql
-- Track detected snow events
CREATE TABLE snow_events (
  id UUID PRIMARY KEY,
  event_date DATE,
  detected_at TIMESTAMPTZ,
  snow_amount_inches DECIMAL(4,2),
  forecast_source TEXT,               -- 'nws', 'noaa', 'manual'
  is_active BOOLEAN,
  two_inch_ban_triggered BOOLEAN,
  ban_triggered_at TIMESTAMPTZ,
  metadata JSONB,                     -- Raw weather API response
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Track notifications sent for snow bans
CREATE TABLE user_snow_ban_notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  snow_event_id UUID REFERENCES snow_events(id),
  notification_date DATE,
  sent_at TIMESTAMPTZ,
  channels TEXT[],                    -- ['email', 'sms']
  status TEXT,                        -- 'sent' or 'failed'
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, snow_event_id)
);
```

**Helper Functions:**
- `is_address_on_winter_ban_street()` - Check if address is on ban street
- `get_active_snow_event()` - Get current snow event
- `should_trigger_two_inch_ban()` - Check if ban should trigger
- `mark_snow_ban_triggered()` - Mark event as processed

---

#### User Passkeys (WebAuthn)
**Location:** `database-migrations/003-add-passkeys-table.sql`

```sql
CREATE TABLE user_passkeys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT,                     -- Prevent cloning attacks
  created_at TIMESTAMP WITH TIME ZONE,
  last_used TIMESTAMP WITH TIME ZONE,
  name TEXT                           -- User-friendly name
);
```

---

## 5. Authentication Flow on Backend

### Magic Link Authentication Flow

```
1. User submits email → POST /api/auth/send-magic-link
   ↓
2. Rate limiting checks (IP + email)
   ↓
3. Supabase admin generates magic link:
   - Type: 'magiclink'
   - Email: user's email
   - Redirect: /auth/callback (post-login handler)
   ↓
4. Email sent via Resend service
   ↓
5. Rate limit actions logged to database
   ↓
6. User clicks link → Supabase auth session created
   ↓
7. Redirect to callback URL with session token
```

**Key Components:**
- **Rate Limiter:** `lib/rate-limiter.ts`
  - IP-based: max 5 requests per IP per minute
  - Email-based: max 3 requests per email per minute
- **Email Service:** Resend API (`process.env.RESEND_API_KEY`)
- **Callback:** User session automatically created by Supabase

---

### Passkey Authentication Flow

```
1. Registration:
   - User submits face/fingerprint
   → POST /api/auth/passkey/register
   
2. Server generates challenge
   - Determines RP ID/origin based on request host
   - Uses SimpleWebAuthn library
   
3. Client generates credential
   - Biometric/PIN verification happens on device
   
4. Credential stored in user_passkeys table
   - credential_id, public_key, counter, name

5. Authentication:
   → POST /api/auth/passkey/authenticate
   
6. Server verifies:
   - Challenge matches
   - Signature is valid
   - Counter increased (prevents cloning)
   
7. Supabase session created
```

**Key Libraries:**
- `@simplewebauthn/server` - WebAuthn credential generation/verification
- `@supabase/supabase-js` - Session management

---

### Notification Preferences Flow

**Storage Location:** `users.notification_preferences` (JSON field)

**Typical Structure:**
```typescript
{
  reminder_days: [60, 45, 37, 30, 14, 7, 1],  // Days before expiry
  channels: {
    email: true,
    sms: true,
    push: true
  },
  categories: {
    street_cleaning: true,
    sticker_renewal: true,
    snow_ban: true,
    towing: true
  },
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "08:00"
  }
}
```

**Default Reminder Days:**
- **Protection Users:** 60d, 45d, 37d, 30d, 14d, 7d, 1d (more frequent pre-charge reminders)
- **Free Users:** 30d, 7d, 1d (basic reminders)

---

## 6. Push Notification Service Architecture

**Location:** `lib/push-service.ts`

### PushService Class

```typescript
class PushService {
  // Configuration
  fcmServerKey: string | null;
  isConfigured(): boolean
  
  // Core Methods
  async sendToToken(token: string, notification: PushNotification): Promise<boolean>
  async sendToUser(userId: string, notification: PushNotification): Promise<PushResult>
  async sendToUsers(userIds: string[], notification: PushNotification): Promise<{...}>
  
  // Helper
  private async deactivateToken(token: string): Promise<void>
}
```

### Notification Types

```typescript
interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  userId?: string;
  category?: string;
}
```

### Pre-built Notifications

```typescript
pushNotifications.streetCleaning(address, date, daysUntil)
pushNotifications.stickerReminder(plate, daysUntil)
pushNotifications.snowBan(address)
pushNotifications.towing(plate, location)
```

### FCM Configuration
- **API Endpoint:** `https://fcm.googleapis.com/fcm/send`
- **Authentication:** Server key in Authorization header
- **Payload Format:**
  ```json
  {
    "to": "device_token",
    "notification": {
      "title": "...",
      "body": "...",
      "sound": "default",
      "badge": 1
    },
    "data": {...},
    "priority": "high",
    "content_available": true
  }
  ```

---

## 7. Notification Logger Service

**Location:** `lib/notification-logger.ts`

### NotificationLogger Class

```typescript
class NotificationLogger {
  async log(entry: NotificationLogEntry): Promise<string | null>
  async updateStatus(id: string, status: string, externalId?: string, error?: string): Promise<boolean>
  async getPendingRetries(limit?: number): Promise<NotificationRetryEntry[]>
  async incrementRetryAttempt(id: string): Promise<boolean>
  async getUserStats(userId: string, days?: number): Promise<{...}>
  async getUserHistory(userId: string, limit?: number): Promise<NotificationLogEntry[]>
}
```

### Retry Logic
- Tracks failed notifications with attempt counts
- Supports up to 5 retry attempts
- Exponential backoff timing
- Logs detailed error information

---

## 8. Related Services & Integrations

### SMS Service
**Location:** `lib/sms-service.ts`
- **Provider:** ClickSend
- **Functions:**
  - `sendClickSendSMS(phone, message)`
  - `sendClickSendVoiceCall(phone, message)`

### Email Service
**Location:** Resend API
- **Configuration:** `RESEND_API_KEY`, `RESEND_FROM`
- **Used by:** Magic link delivery, notification emails

### Message Audit Logger
**Location:** `lib/message-audit-logger.ts`
- Logs all SMS, email, and push attempts
- Tracks delivery status per message type
- Prevents duplicate sends

---

## Summary of Key Points

✅ **API Architecture:**
- File-based routing in Next.js `/pages/api/`
- RESTful endpoints with standard request/response patterns
- Rate limiting on auth endpoints

✅ **Push Notifications:**
- Firebase Cloud Messaging (FCM) integration
- Device token registration/deactivation endpoints
- Multi-device support per user

✅ **Authentication:**
- Magic link (passwordless email)
- Passkey (WebAuthn/biometric)
- OAuth provider integration

✅ **Database:**
- Supabase PostgreSQL backend
- `push_tokens` table for device management
- `notification_logs` for audit trail and retry logic
- Specialized tables for winter/snow ban tracking
- RLS policies for security

✅ **Notification Flow:**
- Scheduled processing via `/api/notifications/process`
- Multi-channel delivery (email, SMS, push)
- Retry mechanism with exponential backoff
- Comprehensive logging for debugging


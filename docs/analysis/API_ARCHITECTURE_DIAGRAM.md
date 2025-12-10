# Backend API Architecture Diagram

## High-Level Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TICKETLESS CHICAGO BACKEND                           │
│                      (Next.js API Routes in /pages/api)                      │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │      CLIENT APPLICATIONS             │
                    │  (Web, Mobile - iOS/Android)         │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │    API GATEWAY (Next.js)             │
                    │    Rate Limiting & Auth              │
                    └──────────────────┬───────────────────┘
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        │              │               │               │              │
        ▼              ▼               ▼               ▼              ▼
    ┌────────┐  ┌──────────────┐ ┌─────────────┐ ┌────────┐   ┌──────────┐
    │  Auth  │  │    Push      │ │Notification │ │ Profile│   │ Renewals │
    │Endpoints│  │  Endpoints  │ │ Endpoints   │ │Endpoints│  │Endpoints │
    └────────┘  └──────────────┘ └─────────────┘ └────────┘   └──────────┘
```

---

## Authentication Flow Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       AUTHENTICATION LAYER                                │
└──────────────────────────────────────────────────────────────────────────┘

    MAGIC LINK FLOW                      PASSKEY FLOW
    ═══════════════════                  ════════════════

    User Email                           User Biometric
        │                                     │
        ▼                                     ▼
    POST /api/auth/              POST /api/auth/passkey/
    send-magic-link              register
        │                                     │
        ├─ Rate Limit Check      ├─ RP ID/Origin Determination
        │  (IP + Email)          │  (Based on request host)
        │                         │
        ▼                         ▼
    Supabase Admin               SimpleWebAuthn Library
    generateLink()               (Challenge generation)
        │                                     │
        ├─ Generate magic link   ├─ Device creates credential
        │  with redirect          │  (Face ID/Touch ID/etc)
        │                         │
        ▼                         ▼
    Resend Email Service         POST /api/auth/passkey/
    (Email delivery)             authenticate
        │                                     │
        ├─ User receives email   ├─ Verify challenge
        │  with magic link        │  Check counter (anti-clone)
        │                         │
        ▼                         ▼
    User clicks link             Signature verification
    (/auth/callback)             passed
        │                                     │
        ▼                         ▼
    Supabase Session             Supabase Session
    Created                       Created
        │                                     │
        ▼                                     ▼
    User Authenticated                  User Authenticated
```

---

## Push Notification Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    PUSH NOTIFICATION SYSTEM                               │
└──────────────────────────────────────────────────────────────────────────┘

    DEVICE REGISTRATION                 NOTIFICATION DELIVERY
    ════════════════════                ═══════════════════════

    Mobile App (iOS/Android)            /api/notifications/
    (Requests permission)               process (Vercel Cron)
            │                                     │
            ▼                                     ▼
    POST /api/push/                     Query user_profiles
    register-token                      (renewal dates)
            │                                     │
    ┌───────┼────────┐                  ┌────────┴─────────┐
    │       │        │                  │                  │
    │  Validate      │                  ▼                  ▼
    │  Bearer Token  │          Check City Sticker    Check License Plate
    │       │        │          Expiry Date           Expiry Date
    │       ▼        │                  │                  │
    │   RPC Call     │                  │                  │
    │   register_    │                  └────────┬─────────┘
    │   push_token   │                           │
    │       │        │                           ▼
    │       ▼        │                  Matches Reminder Day?
    │   push_tokens  │                  (30d, 7d, 1d, etc)
    │   Table        │                           │
    │       │        │                     ┌─────┴──────┐
    │       ▼        │                     │            │
    │   Return       │              YES ▼            ▼ NO
    │   Token ID     │              Log to          Skip
    │                │              notification
    └────────────────┘              _logs table
         │                                 │
         │                                 ▼
         │                          Check User Prefs
         │                          (channels enabled)
         │                                 │
         │                    ┌────────────┼────────────┐
         │                    │            │            │
         │                    ▼            ▼            ▼
         │                  Email         SMS         Push
         │                  Resend      ClickSend    Firebase
         │                    │            │          (FCM)
         │                    │            │            │
         │                    ├────────────┼────────────┤
         │                                 │
         │                                 ▼
         │                          Get User Push Tokens
         │                          RPC: get_user_push_tokens
         │                                 │
         │                ┌────────────────┴────────────────┐
         │                │                                 │
         │         User has active                  User has NO
         │         tokens registered               tokens registered
         │                │                                 │
         │                ▼                                 ▼
         │         Send push to each                 Log: No tokens
         │         token via FCM API                 found
         │                │
         │                ├─ Success ▶ Mark sent
         │                │
         │                └─ Failure ▶ Deactivate token
         │                         Retry later
         │
         ├─ Later: POST /api/push/deactivate-token
         └─ On Logout or permission revoked
            RPC: deactivate_push_token
                 (marks is_active = false)
```

---

## Database Schema Relationship Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                  SUPABASE POSTGRESQL DB                        │
└────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │              auth.users (Supabase Built-in)             │
    │  ┌─ id (UUID)                                           │
    │  ├─ email                                               │
    │  ├─ phone                                               │
    │  ├─ created_at                                          │
    │  └─ updated_at                                          │
    └──────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌─────────────┐
    │  users  │  │push_tokens│  │user_passkeys│
    │(extended)  │          │  │             │
    ├─────────┤  ├──────────┤  ├─────────────┤
    │ id*     │  │ id*      │  │ id*         │
    │ email* ─┼──→ user_id* ├──┼─ user_id*   │
    │ phone  │  │ token    │  │ credential_ │
    │ notifi-│  │ platform │  │ id          │
    │ cation_│  │ device_id│  │ public_key  │
    │ prefere│  │ device_  │  │ counter     │
    │ nces   │  │ name     │  │ created_at  │
    │(JSON)  │  │ is_active│  │ last_used   │
    │ city_  │  │ last_used│  │ name        │
    │ sticker│  │ created_ │  └─────────────┘
    │ expiry │  │ at       │
    │ license│  │ updated_ │
    │ plate_ │  │ at       │
    │ expiry │  └──────────┘
    │ ...    │
    └─────────┘
         │
         ├─────────────────────────────┐
         │                             │
         ▼                             ▼
    ┌──────────────┐          ┌──────────────────┐
    │notification_ │          │user_winter_ban_  │
    │logs          │          │notifications     │
    ├──────────────┤          ├──────────────────┤
    │ id*          │          │ id*              │
    │ user_id* ────┼──────────→ user_id*         │
    │ notification │          │ notification_    │
    │ _type        │          │ year             │
    │ category     │          │ notification_    │
    │ subject      │          │ date             │
    │ content_     │          │ sent_at          │
    │ preview      │          │ channels[]       │
    │ status       │          │ status           │
    │ external_id  │          └──────────────────┘
    │ attempt_count│
    │ created_at   │
    └──────────────┘
         │
         └──────────────────────────────┐
                                        │
                                        ▼
                              ┌──────────────────┐
                              │user_snow_ban_    │
                              │notifications     │
                              ├──────────────────┤
                              │ id*              │
                              │ user_id* ────────┼──┐
                              │ snow_event_id*───┼──┼──┐
                              │ notification_    │  │  │
                              │ date             │  │  │
                              │ sent_at          │  │  │
                              │ channels[]       │  │  │
                              │ status           │  │  │
                              └──────────────────┘  │  │
                                                    │  │
                                                    ▼  ▼
                                          ┌──────────────────┐
                                          │snow_events       │
                                          ├──────────────────┤
                                          │ id*              │
                                          │ event_date       │
                                          │ snow_amount_     │
                                          │ inches           │
                                          │ is_active        │
                                          │ two_inch_ban_    │
                                          │ triggered        │
                                          │ created_at       │
                                          └──────────────────┘

* = Primary Key
→ = Foreign Key Relationship
```

---

## Notification Processing Workflow

```
┌──────────────────────────────────────────────────────────────┐
│        DAILY NOTIFICATION PROCESSING WORKFLOW                 │
│         (Triggered by Vercel Cron)                            │
└──────────────────────────────────────────────────────────────┘

START: POST /api/notifications/process
  │
  ▼
┌─────────────────────────────────────────────┐
│ 1. FETCH USERS WITH RENEWAL DATES           │
│    Query: user_profiles table                │
│    Filter: city_sticker_expiry OR            │
│           license_plate_expiry NOT NULL      │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 2. FOR EACH USER:                           │
│    Calculate days until expiry              │
│    for each renewal type                    │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 3. CHECK SPECIAL CONDITIONS:                │
│    - Emissions blocks license plate?        │
│    - Has permit zone docs (if needed)?      │
│    - Payment already confirmed?             │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 4. MATCH REMINDER DAYS                      │
│    Get user.notification_preferences        │
│    Check if today matches a reminder day    │
│    (Default: 30d, 7d, 1d for free users)    │
│    (Default: 60d, 45d, 37d, 30d... for     │
│            protection users)                 │
└────────────────────┬────────────────────────┘
                     │
              ┌──────┴──────┐
              │             │
         NO MATCH      MATCH FOUND
              │             │
              ▼             ▼
            SKIP       ┌──────────────────────┐
                       │ 5. LOG NOTIFICATION  │
                       │    Create entry in   │
                       │    notification_logs │
                       │    Status: pending   │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ 6. CHECK USER PREFS  │
                       │    notification_     │
                       │    preferences.      │
                       │    channels:         │
                       │    {                 │
                       │      email: true,    │
                       │      sms: true,      │
                       │      push: true      │
                       │    }                 │
                       └──────────┬───────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
              SEND EMAIL      SEND SMS      SEND PUSH
              (Resend)    (ClickSend)   (Firebase FCM)
                    │             │             │
                    └─────────────┼─────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ 7. UPDATE STATUS     │
                       │    In notification_  │
                       │    logs table:       │
                       │    status: sent      │
                       │    external_id: ID   │
                       │    from service      │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ 8. HANDLE FAILURES   │
                       │    If push fails:    │
                       │    - Deactivate     │
                       │      invalid token   │
                       │    - Log error       │
                       │    - Mark for retry  │
                       └──────────┬───────────┘
                                  │
END: Return processing summary
    {
      processed: 150,
      successful: 145,
      failed: 5,
      errors: [...]
    }
```

---

## Rate Limiting Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              RATE LIMITING SYSTEM                             │
│         (Protects /api/auth/* endpoints)                      │
└──────────────────────────────────────────────────────────────┘

    User Initiates Action
         │
         ▼
    ┌──────────────────────────────────────┐
    │  Get Client IP                       │
    │  (from X-Forwarded-For or socket)    │
    └──────────────────┬───────────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │ Check IP Rate Limit         │
         │ (5 requests/minute per IP)  │
         └────────────┬────────────────┘
                      │
              ┌───────┴────────┐
              │                │
        NOT EXCEEDED     EXCEEDED
              │                │
              ▼                ▼
           PASS              FAIL
              │                │
              ▼                ▼
         Check Email      Return 429
         Rate Limit       (Too Many Requests)
         (3/minute)             │
              │                 └── X
         ┌────┴────┐
         │          │
    NOT EXCEEDED  EXCEEDED
         │          │
         ▼          ▼
       PASS        FAIL
         │          │
         ▼          ▼
    Process     Return 429
    Request        │
         │         └──X
         ▼
    Record Action
    in rate_limits
    table
         │
         ▼
    Return Response
    + Headers:
    X-RateLimit-Limit: 5
    X-RateLimit-Remaining: 3
```

---

## Service Integration Map

```
┌─────────────────────────────────────────────────────────────┐
│              EXTERNAL SERVICE INTEGRATIONS                   │
└─────────────────────────────────────────────────────────────┘

TICKETLESS API
    │
    ├──────────────────────┬──────────────────────┬────────────┐
    │                      │                      │            │
    ▼                      ▼                      ▼            ▼
┌────────┐        ┌─────────────┐        ┌──────────┐    ┌─────────┐
│Supabase│        │   Resend    │        │ClickSend │    │Firebase │
│  Auth  │        │   (Email)   │        │  (SMS)   │    │ (FCM)   │
└────────┘        └─────────────┘        └──────────┘    └─────────┘
    │                      │                      │            │
    │              ┌───────┴───────┐              │            │
    │              │               │              │            │
    │         Magic Link    Notification      SMS Voice    Push to
    │         Emails         Emails           Messages   iOS/Android
    │              │               │              │            │
    ▼              ▼               ▼              ▼            ▼
User Auth    Delivery   Category  Delivery    Delivery    Delivery
Tokens       Confirmed  Specific  Confirmed   Confirmed   Confirmed
```

---

## File Structure Overview

```
ticketless-chicago/
├── pages/api/
│   ├── auth/                          # Authentication
│   │   ├── send-magic-link.ts         #  Magic link generation
│   │   ├── passkey/
│   │   │   ├── register.ts            #  Register biometric
│   │   │   ├── authenticate.ts        #  Login with biometric
│   │   │   └── verify.ts              #  Verify credential
│   │   └── oauth-callback.ts          #  Provider callbacks
│   │
│   ├── push/                          # Push Notifications
│   │   ├── register-token.ts          #  Register device token
│   │   └── deactivate-token.ts        #  Logout/disable
│   │
│   ├── notifications/                 # Notification Processing
│   │   ├── process.ts                 #  Main scheduler
│   │   ├── test-run.ts                #  Test delivery
│   │   ├── debug.ts                   #  Debug info
│   │   └── force-test.ts              #  Force test send
│   │
│   └── ... (40+ other endpoint directories)
│
├── lib/
│   ├── push-service.ts                # FCM push service
│   ├── notification-logger.ts         # Audit logging
│   ├── sms-service.ts                 # ClickSend SMS
│   ├── notifications-fixed.ts         # Scheduler logic
│   └── supabase.ts                    # Supabase clients
│
├── database-migrations/               # PostgreSQL migrations
│   ├── 003-add-passkeys-table.sql
│   ├── 005-add-winter-ban.sql
│   ├── 006-add-snow-ban.sql
│   └── ...
│
├── sql/
│   └── push_tokens.sql                # Push token schema
│
└── supabase/migrations/               # Supabase-managed migrations
    ├── create_*.sql
    └── fix_*.sql
```


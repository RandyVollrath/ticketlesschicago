# Notification System Architecture - Comprehensive Map

## Overview
The Autopilot America codebase contains a **highly fragmented and partially duplicated notification system** with multiple parallel implementations across different use cases. This creates significant technical debt and maintenance challenges.

---

## SYSTEM COMPONENTS

### 1. Core Notification Services (lib/)

#### A. **notifications.ts** (Legacy/Older Implementation)
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/notifications.ts`
- **Classes**: `NotificationService`, `NotificationScheduler`
- **Purpose**: Primary renewal reminder system with 4 notification types
- **Supported Channels**:
  - Email (via Resend)
  - SMS (via ClickSend)
  - Voice calls (via ClickSend)
  - Push notifications (via Firebase Cloud Messaging)
- **External Services**:
  - Resend (Email) - API key: `RESEND_API_KEY`
  - ClickSend (SMS/Voice) - API key: `CLICKSEND_API_KEY`, username: `CLICKSEND_USERNAME`
  - Firebase Cloud Messaging - API key: `FCM_SERVER_KEY`
- **Key Features**:
  - Generates sophisticated email content with HTML templates
  - Handles Protection plan vs Free tier notification differences
  - Includes permit zone document upload reminders
  - Uses Supabase RPC function: `get_obligations_needing_reminders()`
  - Sends notifications at reminder intervals: [60, 45, 30, 21, 14] days
  - Mock mode for development (when API keys invalid)
- **Issues**:
  - Complex content generation (~800+ lines)
  - No deduplication logic
  - Escalation system (emergency SMS/email for due today/tomorrow)

#### B. **notifications-fixed.ts** (Newer Implementation - PREFERRED)
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/notifications-fixed.ts`
- **Class**: `NotificationScheduler` (factory function version)
- **Purpose**: Refactored renewal reminder system - appears to be the current standard
- **Supported Channels**:
  - Email (via Resend)
  - SMS (via ClickSend)
  - Voice calls (via ClickSend)
  - NO push notifications in this version
- **External Services**: Same as above (Resend, ClickSend)
- **Key Improvements**:
  - Uses `message-audit-logger` for comprehensive logging
  - 48-hour deduplication check to prevent duplicate messages
  - DRY RUN MODE support for testing
  - Handles emissions test blockage scenario (emissions must complete before license plate renewal)
  - Integrates with permit zone documents table
  - Checks actual payment confirmation before saying "already purchased"
  - Better messaging for Protection users vs free users
- **Default Reminder Days**:
  - Protection: [60, 45, 37, 30, 14, 7, 1]
  - Free: [30, 7, 1]
- **Status**: This appears to be the ACTIVE, PREFERRED implementation
- **Lines**: ~850 lines of complex logic

#### C. **push-service.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/push-service.ts`
- **Class**: `PushService`
- **Purpose**: Firebase Cloud Messaging (FCM) push notification delivery
- **External Service**: Firebase Cloud Messaging - API key: `FCM_SERVER_KEY`
- **Capabilities**:
  - Send to single token or all user devices
  - Automatic invalid token deactivation
  - Category-based messaging (street_cleaning, sticker_renewal, snow_ban, towing)
  - Includes pre-built notification types via `pushNotifications` export
- **Methods**:
  - `sendToToken()` - Single device
  - `sendToUser()` - All devices for a user
  - `sendToUsers()` - Multiple users
- **Issues**: Only integrated into old `notifications.ts`, not the newer `notifications-fixed.ts`

#### D. **sms-service.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/sms-service.ts`
- **Functions**:
  - `sendClickSendSMS(to, message)` - Direct API implementation
  - `sendClickSendVoiceCall(to, message)` - Direct API implementation
- **External Service**: ClickSend REST API
- **Authentication**: Basic auth with `CLICKSEND_USERNAME:CLICKSEND_API_KEY`
- **Endpoints**:
  - SMS: `https://rest.clicksend.com/v3/sms/send`
  - Voice: `https://rest.clicksend.com/v3/voice/send`
- **Features**:
  - Removes non-digits from phone numbers
  - Detailed error handling with response parsing
  - Custom metadata fields (source, custom_string)
  - SMS sender field: 'TicketLess'

#### E. **notification-logger.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/notification-logger.ts`
- **Class**: `NotificationLogger`
- **Purpose**: Legacy logging system for notification tracking
- **Database**: `notification_logs` table
- **Methods**:
  - `log()` - Record notification attempt
  - `updateStatus()` - Update delivery status
  - `getPendingRetries()` - Get failed notifications for retry
  - `getUserStats()` - Get notification statistics per user
  - `getUserHistory()` - Get notification audit trail
- **Statuses**: pending, sent, delivered, failed, bounced, retry_scheduled
- **Issues**: Appears to be superseded by `message-audit-logger`

#### F. **message-audit-logger.ts** (NEW - AUDIT STANDARD)
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/message-audit-logger.ts`
- **Purpose**: Comprehensive message audit trail (NON-NEGOTIABLE per comments)
- **Database**: `message_audit_log` table
- **Functions**:
  - `logMessage()` - Main logging function
  - `logMessageSent()` - Helper for sent messages
  - `logMessageSkipped()` - Helper for skipped messages
  - `logMessageBlocked()` - Helper for blocked messages
  - `logMessageError()` - Helper for failed messages
  - `logMessageQueued()` - Helper for queued messages
  - `checkRecentlySent()` - Deduplication check (48h window)
  - `updateDeliveryStatus()` - Update status from webhook
  - `getMessageStats()` - Get user message statistics
- **Required Fields**: userId, messageKey, messageChannel, contextData, result
- **Features**:
  - Cost tracking (SMS ~2¢, voice ~5¢, email ~0.1¢)
  - External message ID tracking (ClickSend, Resend IDs)
  - Context data structure for flexible metadata
  - Delivery status tracking from webhooks
  - Message preview storage (first 200 chars)
- **Status**: CURRENT STANDARD - used by `notifications-fixed.ts`

#### G. **remitter-notifications.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/remitter-notifications.ts`
- **Purpose**: Notifications to renewal partners (remitters)
- **Functions**:
  - `notifyRemittersProfileConfirmed()` - When user confirms profile
  - `notifyRemittersUrgentDeadline()` - Urgent renewal deadline alerts
  - `notifyRemittersStickerPurchased()` - Sticker purchase confirmation
- **External Service**: Resend (direct API calls, not npm package)
- **Recipients**: `renewal_partners` table
- **Notification Types**: Email only to remitter email
- **Status**: Isolated implementation, remitter-only

#### H. **remitter-emails.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/remitter-emails.ts`
- **Purpose**: Daily/weekly digest emails for remitters
- **External Service**: Resend (npm package)
- **Function**: `sendRemitterDailyEmail()`
- **Content**: Pending renewals summary
- **Status**: Appears incomplete/partially implemented

#### I. **winter-ban-notifications.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/winter-ban-notifications.ts`
- **Purpose**: Winter overnight parking ban notifications
- **External Services**: Resend (email), ClickSend (SMS)
- **Functions**: Helper functions for email/SMS sending
- **Features**:
  - Checks winter ban season (Dec 1 - Apr 1)
  - Address matching against `winter_overnight_parking_ban_streets` table
  - Separate email/SMS content for ban notifications
- **Status**: Utility library for ban-specific endpoints

#### J. **mystreetcleaning-integration.ts**
- **File**: `/home/randy-vollrath/ticketless-chicago/lib/mystreetcleaning-integration.ts`
- **Purpose**: Cross-integration with MyStreetCleaning.com (sister platform)
- **Feature**: Auto-create MSC accounts for Autopilot America users
- **Notification Integration**: MSC handles street cleaning notifications independently
- **Status**: Integration point, not primary notification system
- **Note**: Both platforms use Supabase, allowing direct cross-database access

---

### 2. Scheduled Jobs (pages/api/cron/)

#### A. **send-sticker-reminders.ts**
- **Trigger**: Daily 10 AM Chicago time
- **Purpose**: Remind users to apply stickers after arrival
- **Flow**:
  1. Find completed orders with `sticker_reminder_date <= today`
  2. Send SMS reminder (5 max reminders)
  3. Increment counter, flag for manual follow-up after 5 reminders
- **External Service**: ClickSend SMS
- **Database**: `renewal_orders` table

#### B. **notify-remitter-daily.ts**
- **Trigger**: Daily 8 AM CT (14:00 UTC)
- **Purpose**: Morning digest to renewal partners
- **Content**:
  - Count of users ready for renewal (profile confirmed)
  - Urgent renewals (deadline <7 days)
  - All pending renewals with status indicators
- **External Service**: Resend (email)
- **Recipients**: `renewal_partners` table
- **Database**: `user_profiles`, renewal data

#### C. **send-winter-ban-reminder.ts**
- **Trigger**: Nov 30 at 9 AM CT (scheduled only)
- **Purpose**: One-time seasonal reminder about winter overnight parking bans
- **External Service**: Calls `/api/send-winter-ban-notifications`
- **Conditional**: Only runs Nov 30 (or with force=true)

#### D. **notify-emissions-test.ts**
- **Purpose**: Emissions test deadline reminders
- **External Service**: SMS/Email notifications
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-emissions-test.ts`
- **Status**: Exists but implementation not reviewed

#### E. **notify-sticker-purchased.ts**
- **Purpose**: Notify users after sticker purchase
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-sticker-purchased.ts`
- **Status**: Exists but implementation not reviewed

#### F. **notify-incomplete-profiles.ts**
- **Purpose**: Prompt users to complete their profiles
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-incomplete-profiles.ts`
- **Status**: Exists but implementation not reviewed

#### G. **notify-missing-residency-proof.ts**
- **Purpose**: Reminder for permit zone users to upload residency documents
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-missing-residency-proof.ts`
- **Status**: Exists but implementation not reviewed

#### H. **notify-email-forwarding-setup.ts**
- **Purpose**: Setup instructions for email forwarding (residency proof)
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-email-forwarding-setup.ts`
- **Status**: Exists but implementation not reviewed

#### I. **notify-expiring-licenses.ts**
- **Purpose**: License plate expiration reminders
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-expiring-licenses.ts`
- **Status**: Exists but implementation not reviewed

#### J. **process-notification-retries.ts**
- **Trigger**: Every 5 minutes
- **Purpose**: Retry failed notifications with exponential backoff
- **External Services**: Email (Resend), SMS/Voice (ClickSend)
- **Logic**:
  - Get pending retries from `notification_logs`
  - Retry based on type
  - Max 3 attempts with 5/10/20 minute delays
- **Status**: Retry infrastructure

#### K. **monitor-snow.ts**
- **Purpose**: Monitor weather for snow ban triggers
- **Database**: Weather data integration
- **Status**: Exists but implementation not reviewed

#### L. **send-winter-ban-reminder.ts** (CRON)
- Already covered above under API endpoints

---

### 3. API Endpoints (pages/api/)

#### A. **send-winter-ban-notifications.ts**
- **Method**: POST
- **Authentication**: Cron secret or Bearer token
- **Purpose**: Send winter overnight parking ban notifications
- **Notification Type**: Email + SMS
- **Flow**:
  1. Identify users on winter ban streets
  2. Check if it's within ban season (Dec 1 - Apr 1)
  3. Send tailored notifications
- **External Services**: Resend, ClickSend
- **Database**: User profiles, winter ban streets list

#### B. **send-snow-ban-notifications.ts**
- **Method**: POST
- **Authentication**: Cron secret or Bearer token
- **Purpose**: Emergency notifications when 2+ inches snow forecasted
- **Notification Type**: Email + SMS
- **Content**:
  - Snow forecast amount
  - Ban details for user's street
  - Towing cost warnings ($235+)
  - When ban activates
- **External Services**: Resend, ClickSend
- **Database**: User addresses, snow route data
- **Integration**: Uses `snow-route-matcher` library

#### C. **admin/notify-renewals.ts**
- **Purpose**: Manual trigger for renewal notifications
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/notify-renewals.ts`
- **Status**: Admin endpoint, likely manual testing

#### D. **admin/send-sticker-notifications.ts**
- **Purpose**: Manual trigger for sticker notifications
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/send-sticker-notifications.ts`
- **Status**: Admin endpoint for testing

#### E. **admin/test-notifications.ts**
- **Purpose**: Send test notifications to configured recipients
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/test-notifications.ts`
- **Status**: Testing/debugging endpoint

#### F. **test-notifications.ts**
- **Purpose**: Non-admin test notification endpoint
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/test-notifications.ts`
- **Status**: Development/testing

#### G. **test-force-notification.ts**
- **Purpose**: Force send notification for debugging
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/test-force-notification.ts`
- **Status**: Development endpoint

#### H. **send-test-emails.ts**
- **Purpose**: Send test emails for email service validation
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/send-test-emails.ts`
- **Status**: Email service testing

#### I. **admin/test-sms.ts**
- **Purpose**: Send test SMS for SMS service validation
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/test-sms.ts`
- **Status**: SMS service testing

#### J. **admin/notify-admin-snow.ts**
- **Purpose**: Notify admins of snow events
- **File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/notify-admin-snow.ts`
- **Status**: Admin-only alerts

---

### 4. External Third-Party Services

#### A. **Resend** (Email)
- **API Key**: `RESEND_API_KEY`
- **Endpoint**: `https://api.resend.com/emails`
- **From Address**: Configurable via `RESEND_FROM` or defaults to `hello@autopilotamerica.com`
- **Used By**:
  - `notifications.ts` - Renewal reminders
  - `notifications-fixed.ts` - Renewal reminders (current standard)
  - `remitter-notifications.ts` - Remitter notifications
  - `remitter-emails.ts` - Remitter digests
  - `winter-ban-notifications.ts` - Ban notifications
  - `send-winter-ban-notifications.ts` - Ban endpoint
  - `send-snow-ban-notifications.ts` - Snow endpoint
- **Unsubscribe**: List-Unsubscribe header, unsubscribe links in footer

#### B. **ClickSend** (SMS & Voice)
- **API Key**: `CLICKSEND_API_KEY`
- **Username**: `CLICKSEND_USERNAME`
- **Endpoints**:
  - SMS: `https://rest.clicksend.com/v3/sms/send`
  - Voice: `https://rest.clicksend.com/v3/voice/send`
- **Authentication**: Basic Auth (Base64 encoded username:password)
- **SMS Sender ID**: 'TicketLess' or 'Autopilot'
- **Used By**:
  - `notifications.ts` - SMS/Voice
  - `notifications-fixed.ts` - SMS/Voice (current standard)
  - `sms-service.ts` - Direct API wrapper
  - `send-sticker-reminders.ts` - Sticker reminders
  - `winter-ban-notifications.ts` - Ban SMS
  - `send-snow-ban-notifications.ts` - Snow SMS
  - Various cron jobs
- **Webhook Support**: `CLICKSEND_WEBHOOK_SECRET` for delivery callbacks

#### C. **Firebase Cloud Messaging (FCM)** (Push)
- **API Key**: `FCM_SERVER_KEY`
- **Endpoint**: `https://fcm.googleapis.com/fcm/send`
- **Authorization**: Header key format
- **Platforms**: iOS (APNs) and Android (GCM)
- **Used By**:
  - `push-service.ts` - Main implementation
  - `notifications.ts` - Integration (not in fixed version)
- **Device Registration**: Tokens stored in Supabase, retrieved via RPC `get_user_push_tokens()`

#### D. **MyStreetCleaning.com** (Sister Platform)
- **Integration Type**: Cross-platform account creation
- **Notification Handoff**: MSC handles street cleaning notifications independently
- **Database**: Shared Supabase instance (cross-database queries)

---

## CRITICAL ISSUES & DUPLICATIONS

### 1. **Dual Implementation Problem**
- **Issue**: Two nearly identical `NotificationScheduler` classes exist:
  - `notifications.ts` (older, ~891 lines)
  - `notifications-fixed.ts` (newer, ~855 lines)
- **Problem**: Code duplication, maintenance burden, conflicting logic
- **Recommendation**: Consolidate to `notifications-fixed.ts` only; deprecate `notifications.ts`
- **Impact**: Both are likely running in production, causing duplicate notifications

### 2. **Inconsistent Logging**
- **Issue**: Two logging systems exist:
  - `notification-logger.ts` (older, in `notifications.ts`)
  - `message-audit-logger.ts` (newer, in `notifications-fixed.ts`)
- **Problem**: Different schemas, no unified audit trail
- **Recommendation**: Migrate all to `message-audit-logger` with comprehensive field coverage

### 3. **Missing Push Notifications in Current Flow**
- **Issue**: `push-service.ts` only integrated in old `notifications.ts`, not in active `notifications-fixed.ts`
- **Impact**: Push notifications may not be sent
- **Recommendation**: Integrate `push-service` into `notifications-fixed.ts`

### 4. **Fragmented Email Implementation**
- **Issue**: Email sending duplicated across multiple files:
  - Direct Resend API calls in endpoints (fetch calls)
  - `remitter-emails.ts` using npm package
  - `remitter-notifications.ts` using fetch calls
  - Notification services using npm package
- **Problem**: Inconsistent error handling, different patterns
- **Recommendation**: Create centralized email service wrapper

### 5. **Multiple SMS/Voice Implementations**
- **Issue**: ClickSend API calls duplicated:
  - `sms-service.ts` - standalone functions
  - `notifications.ts` - direct fetch calls
  - `notifications-fixed.ts` - uses sms-service.ts functions
  - `winter-ban-notifications.ts` - direct fetch calls
  - `send-snow-ban-notifications.ts` - direct fetch calls
- **Problem**: Inconsistent error handling, maintenance burden
- **Recommendation**: Enforce use of `sms-service.ts` everywhere

### 6. **Weak Deduplication**
- **Issue**:
  - Old system (`notifications.ts`) has no deduplication
  - New system (`notifications-fixed.ts`) only checks 48-hour window
  - Multiple parallel implementations could send same message twice
- **Recommendation**: Implement request-level idempotency keys + UUID-based deduplication

### 7. **Winter Ban Notifications - Separate Implementation**
- **Issue**: Winter ban notifications completely separate from main notification system
- **Problem**: Different templates, different logic, different external service calls
- **Recommendation**: Integrate into main notification scheduler as a notification type

### 8. **Snow/Weather Monitoring - Incomplete**
- **Issue**: `monitor-snow.ts` cron exists but implementation unclear
- **Impact**: May not trigger snow ban notifications reliably
- **Recommendation**: Clarify flow between monitor-snow.ts and send-snow-ban-notifications.ts

---

## NOTIFICATION FLOW MATRICES

### Current Notification Types

| Type | Service | Trigger | Frequency | Status |
|------|---------|---------|-----------|--------|
| City Sticker Renewal | Email/SMS/Voice/Push | 60/45/37/30/21/14/7/1 days before expiry | Per schedule | Active |
| License Plate Renewal | Email/SMS/Voice/Push | Same as above | Per schedule | Active |
| Emissions Test Reminder | Email/SMS | Separate cron | Configurable | Active |
| Winter Ban (Annual) | Email/SMS | Nov 30 (one-time) | Seasonal | Active |
| Snow Ban (Emergency) | Email/SMS | When 2"+ forecast | Ad-hoc | Active |
| Sticker Application | SMS | 1-5 reminders after delivery | Daily | Active |
| Remitter Digest | Email | Daily 8 AM CT | Daily | Active |
| Remitter Profile Confirmed | Email | User action | On-demand | Active |
| Remitter Urgent Deadline | Email | <7 days to deadline | On-demand | Active |
| Remitter Sticker Purchased | Email | Purchase completion | On-demand | Active |

---

## CONFIGURATION & DEPENDENCIES

### Environment Variables Required
```
RESEND_API_KEY              # Email service
RESEND_FROM                 # Email from address
CLICKSEND_USERNAME          # SMS/Voice username
CLICKSEND_API_KEY           # SMS/Voice API key
CLICKSEND_WEBHOOK_SECRET    # SMS/Voice webhooks
FCM_SERVER_KEY              # Push notifications
CRON_SECRET                 # Cron job authentication
SMS_SENDER                  # SMS sender ID
```

### Database Tables
- `user_profiles` - User data, notification preferences
- `renewal_orders` - Sticker purchase orders
- `renewal_partners` - Remitter/reseller accounts
- `notification_logs` - Legacy notification audit trail
- `message_audit_log` - Current notification audit trail
- `winter_overnight_parking_ban_streets` - Winter ban street list
- `permit_zone_documents` - Permit zone proof uploads
- `push_tokens` - Device push notification tokens
- `renewal_payments` - Payment/purchase records

### Supabase RPC Functions Called
- `get_obligations_needing_reminders(days_ahead)`
- `get_user_push_tokens(p_user_id)`
- `deactivate_push_token(p_token)`
- `log_notification()` - Legacy
- `log_reminder()` - Legacy
- Various others in cron jobs

---

## RECOMMENDATIONS

### Immediate Priorities (Critical)
1. **Consolidate implementations**: Choose `notifications-fixed.ts` as single source of truth
2. **Unify logging**: Migrate `notification-logger` entries to `message-audit-logger`
3. **Fix push notifications**: Integrate push service into active flow
4. **Implement deduplication**: Add idempotency key tracking across all channels

### Short-term (High Priority)
5. **Centralize email**: Create EmailService wrapper for all Resend calls
6. **Enforce SMS/Voice**: Make `sms-service.ts` the only SMS/Voice layer
7. **Document integration**: Create clear mapping of notification types to endpoints
8. **Webhook handling**: Document and test ClickSend/Resend webhooks

### Medium-term (Important)
9. **Integrate winter bans**: Fold winter-ban-notifications into main scheduler
10. **Weather monitoring**: Clarify snow ban trigger workflow
11. **Remitter system**: Consolidate remitter email implementations
12. **Testing framework**: Centralize test endpoints with proper auth

### Long-term (Nice to Have)
13. **MessageQueue**: Consider message queue (SQS/Pub-Sub) for reliability
14. **Template system**: Move HTML templates to database or separate files
15. **Preferences dashboard**: User-facing notification preference management
16. **Analytics**: Detailed delivery and engagement metrics

---

## FILE ORGANIZATION DIAGRAM

```
Notification System
├── Core Services (lib/)
│   ├── notifications.ts ❌ DEPRECATED - Use notifications-fixed.ts
│   ├── notifications-fixed.ts ✅ ACTIVE STANDARD
│   ├── push-service.ts (FCM integration)
│   ├── sms-service.ts (ClickSend wrapper)
│   ├── notification-logger.ts (Legacy)
│   └── message-audit-logger.ts ✅ CURRENT STANDARD
│
├── Partner Notifications (lib/)
│   ├── remitter-notifications.ts
│   ├── remitter-emails.ts
│   └── mystreetcleaning-integration.ts
│
├── Special Purpose (lib/)
│   ├── winter-ban-notifications.ts (Independent)
│   └── [similar for snow, street-cleaning, etc.]
│
├── Cron Jobs (pages/api/cron/)
│   ├── send-sticker-reminders.ts
│   ├── notify-remitter-daily.ts
│   ├── send-winter-ban-reminder.ts
│   ├── notify-emissions-test.ts
│   ├── notify-sticker-purchased.ts
│   ├── notify-incomplete-profiles.ts
│   ├── notify-missing-residency-proof.ts
│   ├── notify-email-forwarding-setup.ts
│   ├── notify-expiring-licenses.ts
│   ├── process-notification-retries.ts
│   ├── monitor-snow.ts
│   └── [10+ more]
│
├── API Endpoints (pages/api/)
│   ├── send-winter-ban-notifications.ts
│   ├── send-snow-ban-notifications.ts
│   ├── admin/notify-renewals.ts
│   ├── admin/send-sticker-notifications.ts
│   ├── admin/test-notifications.ts
│   └── [test endpoints]
│
└── External Services
    ├── Resend (Email)
    ├── ClickSend (SMS/Voice)
    ├── Firebase Cloud Messaging (Push)
    └── MyStreetCleaning.com (Cross-platform)
```


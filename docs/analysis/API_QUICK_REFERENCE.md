# Backend API Quick Reference Guide

## File Locations
- **API Routes:** `/pages/api/` (Next.js route handlers)
- **Push Service:** `/lib/push-service.ts`
- **Notification Logger:** `/lib/notification-logger.ts`
- **Database Schema:** 
  - Push tokens: `/sql/push_tokens.sql`
  - Migrations: `/database-migrations/`
  - Supabase migrations: `/supabase/migrations/`

---

## Critical API Endpoints

### Authentication
```
POST /api/auth/send-magic-link          - Passwordless login
POST /api/auth/passkey/register         - Register biometric
POST /api/auth/passkey/authenticate     - Login with biometric
POST /api/auth/oauth-callback           - OAuth provider callback
POST /api/auth/resend-verification      - Resend email verification
POST /api/auth/session                  - Get current session
```

### Push Notifications
```
POST /api/push/register-token           - Register device token (Bearer auth)
POST /api/push/deactivate-token         - Deactivate token on logout
```

### Notification Processing
```
POST/GET /api/notifications/process     - Main notification scheduler (Vercel cron)
POST /api/notifications/test-run        - Test notification delivery
POST /api/notifications/debug           - Debug notification status
POST /api/notifications/force-test      - Force send test notifications
```

---

## Database Key Tables

### push_tokens
- **Stores:** Device tokens for push notifications
- **Columns:** id, user_id, token, platform (ios|android|web), device_id, device_name, app_version, is_active, last_used_at
- **Uniqueness:** One token per user per device
- **RPC Functions:**
  - `register_push_token()` - Upsert token
  - `get_user_push_tokens()` - Get active tokens
  - `deactivate_push_token()` - Deactivate token

### users
- **Extends:** Supabase auth.users
- **Key Fields:** 
  - `notification_preferences` (JSON) - User preferences, reminder days, channels
  - `city_sticker_expiry`, `license_plate_expiry`, `emissions_date` - Renewal dates
  - Vehicle info: `license_plate`, `vin`, `vehicle_type`, `vehicle_year`

### notification_logs
- **Tracks:** All notification attempts (email, SMS, voice, push)
- **Columns:** id, user_id, notification_type, category, status, attempt_count, external_id, metadata
- **Statuses:** pending | sent | delivered | failed | bounced | retry_scheduled
- **Retention:** ~30 days by default

### user_winter_ban_notifications
- **Tracks:** Winter overnight parking ban (3am-7am Dec 1 - Apr 1) notifications sent
- **Uniqueness:** One per user per season

### user_snow_ban_notifications
- **Tracks:** 2-inch snow ban notifications
- **Uniqueness:** One per user per snow event

### user_passkeys
- **Stores:** WebAuthn credentials for biometric login
- **Columns:** id, user_id, credential_id, public_key, counter, created_at, last_used

---

## Service Classes

### PushService (lib/push-service.ts)
```typescript
pushService.isConfigured()                                    // Check if FCM configured
pushService.sendToToken(token, notification)                 // Send to single token
pushService.sendToUser(userId, notification)                 // Send to all user devices
pushService.sendToUsers(userIds[], notification)             // Bulk send

// Pre-built notifications:
pushNotifications.streetCleaning(address, date, daysUntil)
pushNotifications.stickerReminder(plate, daysUntil)
pushNotifications.snowBan(address)
pushNotifications.towing(plate, location)
```

### NotificationLogger (lib/notification-logger.ts)
```typescript
notificationLogger.log(entry)                                 // Log notification attempt
notificationLogger.updateStatus(id, status, externalId, error) // Update status
notificationLogger.getPendingRetries(limit)                   // Get failed notifications
notificationLogger.incrementRetryAttempt(id)                  // Increment retry count
notificationLogger.getUserStats(userId, days)                // Get notification stats
notificationLogger.getUserHistory(userId, limit)             // Get recent notifications
```

---

## Authentication Flows

### Magic Link Flow
1. User enters email → POST `/api/auth/send-magic-link`
2. Rate limits checked (IP: 5/min, Email: 3/min)
3. Supabase generates magic link
4. Email sent via Resend
5. User clicks link → Session created
6. Redirect to callback URL

### Passkey Flow
1. User registers face/fingerprint → POST `/api/auth/passkey/register`
2. Server generates challenge (RP ID/origin determined from request host)
3. Client generates credential with biometric verification
4. Stored in `user_passkeys` table
5. Login: POST `/api/auth/passkey/authenticate` with credential
6. Counter checked to prevent cloning
7. Supabase session created

### Notification Preferences
Location: `users.notification_preferences` (JSON field)

```typescript
{
  reminder_days: [60, 45, 37, 30, 14, 7, 1],
  channels: { email: true, sms: true, push: true },
  categories: { street_cleaning: true, sticker_renewal: true, ... }
}
```

**Default Reminder Days:**
- Protection users: 60d, 45d, 37d, 30d, 14d, 7d, 1d
- Free users: 30d, 7d, 1d

---

## Environment Variables Required

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

# Firebase Cloud Messaging (Push)
FCM_SERVER_KEY

# Email (Resend)
RESEND_API_KEY
RESEND_FROM

# SMS (ClickSend)
CLICKSEND_USERNAME
CLICKSEND_API_KEY

# Auth
NEXT_PUBLIC_SITE_URL
```

---

## Common Patterns

### Get User's Push Tokens
```typescript
const { data: tokens } = await supabaseAdmin.rpc('get_user_push_tokens', {
  p_user_id: userId
});
```

### Send Push to User
```typescript
const result = await pushService.sendToUser(userId, {
  title: 'Street Cleaning Today',
  body: 'Move your car to avoid a ticket!',
  data: { type: 'street_cleaning' },
  category: 'street_cleaning'
});
```

### Log Notification
```typescript
const logId = await notificationLogger.log({
  user_id: userId,
  notification_type: 'email',
  category: 'sticker_renewal',
  subject: 'City Sticker Renewal',
  content_preview: 'Your city sticker expires...',
  status: 'pending'
});
```

### Update Notification Status
```typescript
await notificationLogger.updateStatus(
  logId,
  'sent',
  externalId,        // ID from Resend/FCM/ClickSend
  error              // Error message if failed
);
```

---

## Testing Endpoints

### Test Magic Link
```bash
curl -X POST http://localhost:3000/api/auth/send-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

### Register Push Token
```bash
curl -X POST http://localhost:3000/api/push/register-token \
  -H "Authorization: Bearer USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "fcm_token_here",
    "platform": "ios",
    "deviceId": "device-123",
    "deviceName": "iPhone 15"
  }'
```

### Process Notifications
```bash
curl -X POST http://localhost:3000/api/notifications/process \
  -H "Content-Type: application/json"
```

---

## Debugging Tips

### Check Notification Logs
```sql
SELECT * FROM notification_logs 
WHERE user_id = 'user_uuid' 
ORDER BY created_at DESC 
LIMIT 20;
```

### Get User's Push Tokens
```sql
SELECT * FROM push_tokens 
WHERE user_id = 'user_uuid' AND is_active = true;
```

### Check Retry Queue
```typescript
const retries = await notificationLogger.getPendingRetries(50);
```

### Verify Notification Preferences
```sql
SELECT notification_preferences FROM users WHERE id = 'user_uuid';
```

### Monitor FCM Configuration
```typescript
console.log('FCM Configured:', pushService.isConfigured());
```

---

## Rate Limiting

### Magic Link
- **IP-based:** 5 requests per minute per IP
- **Email-based:** 3 requests per minute per email
- **Bypass:** None in production

### Headers Returned
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
```

---

## Error Handling

### Push Token Errors
- Invalid token format → Return 400
- Missing authorization → Return 401
- Database error → Return 500

### Notification Errors
- No active tokens → Log and continue
- FCM API failure → Deactivate token, retry later
- Invalid address → Skip notification

### Auth Errors
- Rate limit exceeded → Return 429
- Invalid magic link → Return 400
- Passkey verification failed → Return 401

---

## Best Practices

1. **Always use Bearer token** for push token endpoints
2. **Log all notifications** to notification_logs for auditing
3. **Check user preferences** before sending
4. **Implement retry logic** for failed messages
5. **Update last_used_at** when token is successfully used
6. **Deactivate invalid tokens** immediately
7. **Rate limit auth endpoints** to prevent abuse
8. **Store external IDs** from FCM/Resend for tracking
9. **Use RPC functions** for database operations (cleaner, faster)
10. **Test in dry-run mode** before production deployment


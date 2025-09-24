# Enhanced OAuth Integration with MyStreetCleaning.com

This document explains the enhanced integration between Ticketless America and MyStreetCleaning.com that supports Google OAuth authentication.

## Overview

When users sign up for Ticketless America via Google OAuth, the system automatically:
1. Creates a Ticketless America account
2. Creates a linked MyStreetCleaning.com account
3. Syncs notification preferences and address data
4. Links accounts using Google ID for future updates

## Components

### 1. Enhanced Signup Flow (`components/EnhancedSignupFlow.tsx`)

- Collects Chicago address and notification preferences BEFORE OAuth
- Validates Chicago address format
- Stores data for OAuth callback processing
- Initiates Google OAuth with collected data

### 2. OAuth Callback Handler (`pages/api/auth/oauth-callback.ts`)

- Processes Google OAuth callback
- Creates/updates user metadata in Ticketless America
- Triggers MyStreetCleaning account creation
- Handles error recovery and rollback

### 3. Enhanced MyStreetCleaning Integration (`lib/mystreetcleaning-integration.ts`)

**New Features:**
- Google ID linking support
- Full notification preferences (email, SMS, voice, reminder days)
- User name handling from OAuth
- Smart updates for existing users
- Comprehensive error handling and logging

**Updated Interface:**
```typescript
interface MyStreetCleaningAccount {
  email: string;
  streetAddress: string;
  userId?: string;
  googleId?: string;  // NEW
  name?: string;      // NEW
  notificationPreferences?: {  // NEW
    email?: boolean;
    sms?: boolean;
    voice?: boolean;
    days_before?: number[];
  };
}
```

### 4. Webhook Integration

The Stripe webhook has been enhanced to:
- Extract OAuth data from user metadata
- Pass notification preferences to MyStreetCleaning
- Update user metadata with MSC account info
- Handle OAuth-based payment flows

## Usage Examples

### Basic OAuth Integration
```javascript
// In your signup component
import { EnhancedSignupFlow } from '../components/EnhancedSignupFlow';

<EnhancedSignupFlow 
  onSuccess={(data) => console.log('Account created:', data)}
  onError={(error) => console.error('Signup failed:', error)}
/>
```

### Manual Account Creation
```javascript
import { syncUserToMyStreetCleaning } from '../lib/mystreetcleaning-integration';

const result = await syncUserToMyStreetCleaning(
  'user@example.com',
  '123 N Michigan Ave, Chicago, IL 60601',
  'user-id-123',
  {
    googleId: 'google-oauth-id',
    name: 'John Doe',
    notificationPreferences: {
      email: true,
      sms: false,
      voice: true,
      days_before: [1, 7, 30]
    }
  }
);
```

## Data Flow

1. **User Signup:**
   ```
   User fills form → OAuth with Google → Callback handler
   ```

2. **Account Creation:**
   ```
   Ticketless Account → User Metadata → MyStreetCleaning Account
   ```

3. **Data Sync:**
   ```
   Address + Preferences → MSC Database → Notification Setup
   ```

## Database Schema

### MyStreetCleaning.com Fields Used:
- `user_id`: UUID (generated or linked)
- `email`: User's Google email
- `home_address_full`: Chicago street address
- `notify_email`: Email notification preference
- `notify_sms`: SMS notification preference
- `voice_calls_enabled`: Voice call preference
- `phone_call_enabled`: Phone call preference
- `notify_days_array`: Array of reminder days
- `role`: Set to 'ticketless_user'
- `affiliate_signup_date`: Account creation timestamp

### Ticketless America Metadata:
```json
{
  "address": "123 Main St, Chicago, IL",
  "notificationMethod": "email,text",
  "phone": "312-555-0123",
  "google_id": "google-oauth-id",
  "msc_account_created": true,
  "msc_account_id": "msc-uuid"
}
```

## Testing

### Test Scripts:
- `scripts/test-oauth-integration.js`: Test OAuth integration
- `scripts/check-msc-schema.js`: Verify MSC database schema
- `scripts/verify-user-data.js`: Check user data sync

### Test the Integration:
```bash
# Test OAuth integration
node scripts/test-oauth-integration.js

# Verify user data
node scripts/verify-user-data.js user@example.com
```

## Security Considerations

1. **Environment Variables:**
   - `MSC_SUPABASE_URL`: MyStreetCleaning Supabase URL
   - `MSC_SUPABASE_SERVICE_ROLE_KEY`: Service role key (server-side only)
   - Both stored in Vercel environment variables

2. **Data Protection:**
   - Service role keys never exposed client-side
   - OAuth tokens handled securely by Supabase
   - User data encrypted in transit and at rest

3. **Error Handling:**
   - Failed MSC creation doesn't block Ticketless signup
   - Comprehensive logging for debugging
   - Rollback mechanisms for partial failures

## Monitoring

### Success Metrics:
- Account creation success rate
- Data sync accuracy
- OAuth flow completion rate

### Debug Endpoints:
- `/api/webhook-debug`: Debug webhook processing
- `/api/test-webhook-log`: Check recent activity
- `/api/auth/oauth-callback`: OAuth callback handler

## Troubleshooting

### Common Issues:

1. **Address Validation Fails:**
   - Ensure address contains "Chicago", "IL", or "606" zip code
   - Check for typos in street names

2. **MSC Account Creation Fails:**
   - Verify MSC environment variables are set
   - Check MSC database connectivity
   - Review logs for schema mismatches

3. **OAuth Flow Breaks:**
   - Verify Google OAuth configuration
   - Check redirect URLs in both Supabase projects
   - Ensure callback handler is accessible

### Debug Steps:
1. Check Vercel function logs
2. Verify environment variables
3. Test MSC database connection
4. Run integration test scripts
5. Check Supabase auth logs

## Future Enhancements

- Real-time sync between apps using webhooks
- Shared notification preferences UI
- Advanced address validation with Chicago API
- Bulk user migration tools
- Cross-app authentication tokens
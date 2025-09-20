# MyStreetCleaning.com Integration

This document explains how the automatic account creation integration between ticketlesschicago.com and mystreetcleaning.com works.

## Overview

When a user creates an account on ticketlesschicago.com, an account is automatically created on mystreetcleaning.com using their email address and street cleaning address.

## How It Works

1. **User Registration**: User signs up for ticketlesschicago.com and provides:
   - Email address
   - Street address (for street cleaning notifications)
   - Vehicle information

2. **Stripe Webhook**: After successful payment, the Stripe webhook is triggered
3. **Account Creation**: The webhook calls the MyStreetCleaning integration
4. **Cross-Site Sync**: A new account is created on mystreetcleaning.com with:
   - Same email address
   - Street cleaning address
   - Default notification preferences

## Files Modified/Added

### Core Integration Files
- `lib/mystreetcleaning-integration.ts` - Main integration logic
- `pages/api/mystreetcleaning-sync.ts` - API endpoint for manual sync
- `pages/api/stripe-webhook.ts` - Updated to trigger integration

### Database Changes
- `add-street-cleaning-integration.sql` - Database migration script
- Added `street_cleaning_address` field to `vehicle_reminders` table
- Added `msc_integration_logs` table for tracking

### Configuration
- `.env.local.example` - Added MyStreetCleaning environment variables

### Testing
- `test-msc-integration.js` - Test script for integration
- `MYSTREETCLEANING_INTEGRATION.md` - This documentation

## Environment Variables Required

Add these to your `.env.local` file:

```bash
# MyStreetCleaning.com Integration
MSC_SUPABASE_URL=your_mystreetcleaning_supabase_url
MSC_SUPABASE_SERVICE_ROLE_KEY=your_mystreetcleaning_service_role_key
```

## Database Setup

Run the migration script to add required database tables and fields:

```sql
-- Run this in your Supabase SQL editor
\i add-street-cleaning-integration.sql
```

## API Endpoints

### Automatic Integration
The integration runs automatically when users complete checkout via the Stripe webhook.

### Manual Sync API
You can also manually sync a user:

```bash
POST /api/mystreetcleaning-sync
Content-Type: application/json

{
  "email": "user@example.com",
  "streetAddress": "123 N State St, Chicago, IL 60601",
  "userId": "optional-user-id"
}
```

Response:
```json
{
  "success": true,
  "message": "Account created successfully",
  "accountId": "msc_1234567890_abcdef123"
}
```

## Testing

To test the integration:

1. Start your Next.js development server:
   ```bash
   npm run dev
   ```

2. Run the test script:
   ```bash
   node test-msc-integration.js
   ```

## Error Handling

The integration includes comprehensive error handling:

- **Duplicate Users**: If a user already exists on mystreetcleaning.com, their address is updated
- **Missing Data**: Validates required fields (email, address)
- **Database Errors**: Logs errors and continues with account creation
- **Integration Logs**: All attempts are logged in `msc_integration_logs` table

## Monitoring

Check the integration logs to monitor success/failure rates:

```sql
SELECT 
  status,
  COUNT(*) as count,
  DATE(created_at) as date
FROM msc_integration_logs 
GROUP BY status, DATE(created_at)
ORDER BY date DESC;
```

## Security Considerations

- Uses service role keys for database access
- Validates all input data
- Logs sensitive operations
- Fails gracefully without exposing internal errors

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Ensure MSC_SUPABASE_URL and MSC_SUPABASE_SERVICE_ROLE_KEY are set
   - Check that variables are accessible in the webhook environment

2. **Database Connection Issues**
   - Verify MyStreetCleaning database credentials
   - Ensure service role key has proper permissions

3. **Address Validation**
   - Check that addresses are properly formatted
   - Ensure street cleaning address is captured in the form

### Debug Logs

The integration produces detailed logs with prefixes:
- `🚀 [MSC Integration]` - General integration logs
- `✅ [MSC Integration]` - Success messages
- `❌ [MSC Integration]` - Error messages
- `📤 [MSC Integration]` - API requests
- `ℹ️ [MSC Integration]` - Informational messages

## Future Enhancements

Potential improvements:
- Bidirectional sync between sites
- Real-time address updates
- Notification preference synchronization
- Bulk user migration tools
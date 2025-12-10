# ClickSend Incoming SMS Setup Guide

This guide explains how to set up ClickSend to forward incoming SMS replies to our webhook for processing.

## Overview

When users reply to our renewal reminder SMS messages, ClickSend will forward those replies to our webhook endpoint, which will:
1. Store the message in the database
2. Match it to the user's profile
3. Send an email notification to mystreetcleaning@gmail.com
4. Make it available in the admin panel for processing

## Setup Steps

### 1. Create the Database Table

First, create the `incoming_sms` table in your Supabase database:

```bash
# Run the SQL migration
psql $DATABASE_URL < sql/create-incoming-sms-table.sql
```

Or manually run the SQL from `sql/create-incoming-sms-table.sql` in your Supabase SQL editor.

### 2. Configure ClickSend Webhook

1. **Log in to ClickSend Dashboard**
   - Go to: https://dashboard.clicksend.com
   - Sign in with your mystreetcleaning@gmail.com account

2. **Navigate to Inbound SMS Settings**
   - Click on **SMS** in the left sidebar
   - Go to **Settings** → **Inbound SMS Rules**

3. **Add New Inbound Rule**
   - Click **"Add Rule"** or **"Create New Rule"**
   - Configure the following:
     - **Name**: Ticketless America Profile Updates
     - **Phone Number**: Select your SMS number (or "All numbers" if you only have one)
     - **Action**: Forward to URL / Webhook
     - **URL**: `https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms`
     - **Method**: POST
     - **Format**: JSON (if available, otherwise it will send form data which we handle)

4. **Test the Webhook** (Optional)
   - ClickSend usually has a "Test" button to send a sample webhook
   - Or you can send yourself a test SMS and reply to it

### 3. Verify the Setup

After configuration, test the flow:

1. **Send a test SMS** to your Ticketless America phone number
2. **Check the admin panel**: Visit https://ticketlessamerica.com/admin/profile-updates
3. **Check your email**: You should receive a notification at mystreetcleaning@gmail.com
4. **Check the database**: Run this query to see incoming messages:
   ```sql
   SELECT * FROM incoming_sms ORDER BY created_at DESC LIMIT 10;
   ```

## Webhook Endpoint Details

**Endpoint**: `https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms`

**Expected ClickSend Payload**:
```json
{
  "from": "+13125551234",
  "body": "New license plate is ABC123",
  "message_id": "clicksend-message-id",
  "to": "+18335623866",
  "timestamp": "2025-01-15T12:30:00Z"
}
```

**Response**:
```json
{
  "success": true,
  "message": "SMS received and processed",
  "sms_id": 123,
  "matched_user": "user@example.com"
}
```

## Admin Panel Access

**URL**: https://ticketlessamerica.com/admin/profile-updates

Features:
- View all incoming SMS replies
- See matched user profiles
- Edit user information (license plate, VIN, address, expiry dates)
- Mark messages as processed
- Filter by unprocessed/all messages

## Troubleshooting

### Messages Not Arriving

1. **Check ClickSend Dashboard**
   - Go to SMS → Inbound SMS
   - Verify messages are being received by ClickSend

2. **Check Webhook Logs**
   - ClickSend Dashboard → Settings → Inbound SMS Rules
   - Click on your rule to see webhook delivery logs
   - Look for 200 OK responses (success) or errors

3. **Check Vercel Logs**
   - Visit https://vercel.com/randyvollraths-projects/ticketless-chicago
   - Go to Functions → View logs
   - Filter for `/api/webhooks/clicksend-incoming-sms`

4. **Check Database**
   ```sql
   SELECT * FROM incoming_sms ORDER BY created_at DESC LIMIT 10;
   ```

### Email Notifications Not Sending

1. **Check Resend API Key**
   - Verify `RESEND_API_KEY` is set in environment variables
   - Check Resend dashboard for delivery logs

2. **Check Email Column in Database**
   ```sql
   SELECT id, email_sent, created_at FROM incoming_sms WHERE email_sent = false;
   ```

### User Not Being Matched

The system tries to match users by phone number. It normalizes and tries multiple formats:
- `3125551234`
- `+13125551234`
- `+3125551234`

If a user isn't matched:
1. Check their phone number in `user_profiles`:
   ```sql
   SELECT user_id, email, phone, phone_number FROM user_profiles WHERE email = 'user@example.com';
   ```
2. Update if needed:
   ```sql
   UPDATE user_profiles SET phone = '+13125551234' WHERE user_id = '...';
   ```

## Renewal SMS Messages

Users will receive these messages at **60, 30, 14, 7, 3, 2, 1 days** before their city sticker or license plate expiry:

### 30+ Days Before:
> Ticketless: City Sticker coming up in 30 days for ABC123. Has anything changed? (license plate, VIN, address). Reply to update. - Ticketless America

### 7 Days Before:
> Ticketless: City Sticker expires in 7 days for ABC123. We'll purchase it for you. Reply if new license plate, VIN, or address. - Ticketless America

### 1 Day Before:
> Ticketless: City Sticker expires TOMORROW for ABC123. We'll handle renewal. Reply if anything changed (new plate/VIN/address). - Ticketless America

### Day Of:
> Ticketless: City Sticker expires TODAY! We'll handle renewal. Reply if license plate, VIN, or address changed. - Ticketless America

## Security Notes

- The webhook endpoint is public (required for ClickSend to access it)
- All data is validated before storage
- Unknown numbers are logged but no sensitive actions are taken
- Only authenticated users can access the admin panel

## Support

If you encounter issues:
1. Check this documentation
2. Review Vercel and ClickSend logs
3. Test with a known phone number
4. Contact ClickSend support if webhook delivery fails

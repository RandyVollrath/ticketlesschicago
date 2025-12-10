import { NextApiRequest, NextApiResponse } from 'next';
import {
  logMessageSent,
  logMessageSkipped,
  logMessageError,
  logMessageBlocked
} from '../../../lib/message-audit-logger';
import { withAdminAuth } from '../../../lib/auth-middleware';

/**
 * Test Endpoint - Populate Audit Log with Sample Data
 *
 * This creates sample audit log entries to test the dashboard
 * POST /api/admin/test-audit-log
 */
export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📋 Creating sample audit log entries...');

    const sampleUserId = '00000000-0000-0000-0000-000000000001';
    const sampleEmail = 'test@example.com';
    const samplePhone = '+12125551234';

    // 1. Successful SMS send
    await logMessageSent({
      userId: sampleUserId,
      userEmail: sampleEmail,
      userPhone: samplePhone,
      messageKey: 'renewal_city_sticker_30day',
      messageChannel: 'sms',
      contextData: {
        plate: 'IL ABC123',
        zone: 42,
        days_until: 30,
        renewal_type: 'City Sticker',
        has_protection: true
      },
      messagePreview: 'Autopilot: Your City Sticker expires in 30 days. We\'ll charge your card today...',
      externalMessageId: 'test-sms-001',
      costCents: 2
    });

    // 2. Skipped due to deduplication
    await logMessageSkipped({
      userId: sampleUserId,
      userEmail: sampleEmail,
      userPhone: samplePhone,
      messageKey: 'renewal_city_sticker_30day',
      messageChannel: 'sms',
      contextData: {
        plate: 'IL ABC123',
        zone: 42,
        days_until: 30
      },
      reason: 'already_sent_48h'
    });

    // 3. Email sent successfully
    await logMessageSent({
      userId: sampleUserId,
      userEmail: sampleEmail,
      userPhone: samplePhone,
      messageKey: 'renewal_city_sticker_30day_email',
      messageChannel: 'email',
      contextData: {
        plate: 'IL ABC123',
        zone: 42,
        days_until: 30,
        renewal_type: 'City Sticker'
      },
      messagePreview: 'City Sticker Renewal - Charging your card today!',
      externalMessageId: 'test-email-001',
      costCents: 0
    });

    // 4. SMS failed - missing phone number
    await logMessageSkipped({
      userId: '00000000-0000-0000-0000-000000000002',
      userEmail: 'user-no-phone@example.com',
      userPhone: undefined,
      messageKey: 'street_cleaning_1day',
      messageChannel: 'sms',
      contextData: {
        plate: 'IL XYZ789',
        zone: 15,
        street: 'Main St',
        date: '2025-11-18'
      },
      reason: 'missing_phone_number'
    });

    // 5. SMS error - API failure
    await logMessageError({
      userId: sampleUserId,
      userEmail: sampleEmail,
      userPhone: samplePhone,
      messageKey: 'renewal_license_plate_7day',
      messageChannel: 'sms',
      contextData: {
        plate: 'IL ABC123',
        days_until: 7,
        renewal_type: 'License Plate'
      },
      reason: 'api_error',
      errorDetails: {
        error: 'ClickSend API timeout',
        statusCode: 500,
        message: 'Failed to connect to ClickSend API'
      }
    });

    // 6. Blocked - user opted out
    await logMessageBlocked({
      userId: '00000000-0000-0000-0000-000000000003',
      userEmail: 'opted-out@example.com',
      userPhone: '+13125555678',
      messageKey: 'renewal_emissions_test_14day',
      messageChannel: 'sms',
      contextData: {
        plate: 'IL DEF456',
        days_until: 14,
        renewal_type: 'Emissions Test'
      },
      reason: 'user_opted_out'
    });

    // 7. Voice call sent
    await logMessageSent({
      userId: sampleUserId,
      userEmail: sampleEmail,
      userPhone: samplePhone,
      messageKey: 'renewal_city_sticker_1day_voice',
      messageChannel: 'voice',
      contextData: {
        plate: 'IL ABC123',
        zone: 42,
        days_until: 1,
        renewal_type: 'City Sticker'
      },
      messagePreview: 'Hello from Autopilot America. This is a reminder that your City Sticker expires in 1 day...',
      externalMessageId: 'test-voice-001',
      costCents: 5
    });

    // 8. Email skipped - user disabled email
    await logMessageSkipped({
      userId: '00000000-0000-0000-0000-000000000004',
      userEmail: 'no-email-pref@example.com',
      userPhone: '+14155559999',
      messageKey: 'street_cleaning_tomorrow',
      messageChannel: 'email',
      contextData: {
        plate: 'IL GHI789',
        zone: 28,
        street: 'Oak Ave',
        date: '2025-11-18'
      },
      reason: 'user_disabled_email'
    });

    console.log('✅ Created 8 sample audit log entries');

    return res.status(200).json({
      success: true,
      message: 'Created 8 sample audit log entries',
      entries: [
        { type: 'sent', channel: 'sms', key: 'renewal_city_sticker_30day' },
        { type: 'skipped', channel: 'sms', reason: 'already_sent_48h' },
        { type: 'sent', channel: 'email', key: 'renewal_city_sticker_30day_email' },
        { type: 'skipped', channel: 'sms', reason: 'missing_phone_number' },
        { type: 'error', channel: 'sms', reason: 'api_error' },
        { type: 'blocked', channel: 'sms', reason: 'user_opted_out' },
        { type: 'sent', channel: 'voice', key: 'renewal_city_sticker_1day_voice' },
        { type: 'skipped', channel: 'email', reason: 'user_disabled_email' }
      ]
    });

  } catch (error: any) {
    console.error('❌ Error creating sample entries:', error);
    return res.status(500).json({
      error: 'Failed to create sample entries',
      message: error.message
    });
  }
});

import type { NextApiRequest, NextApiResponse } from 'next';
import { NotificationService } from '../../lib/notifications';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, phone, testType = 'all' } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const notificationService = new NotificationService();
  const results: any = {
    email: null,
    sms: null,
    voice: null,
    timestamp: new Date().toISOString()
  };

  try {
    // Test email notification
    if (testType === 'all' || testType === 'email') {
      console.log('Testing email notification to:', email);
      const emailResult = await notificationService.sendEmail({
        to: email,
        subject: 'Test: License Plate Registration Reminder',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #2563eb; color: white; padding: 20px; text-align: center;">
              <h1>Autopilot America</h1>
              <p>Test Notification</p>
            </div>
            <div style="padding: 20px; background: #fff;">
              <h2>This is a test notification</h2>
              <p>Hi! We're testing your notification preferences to make sure you receive your renewal reminders.</p>
              <p><strong>Vehicle:</strong> TEST123</p>
              <p><strong>Test Date:</strong> Today</p>
              <p style="margin-top: 20px;">If you received this email, your notifications are set up correctly and you'll receive reminders before your actual renewal dates.</p>
              <p>Thanks for using Autopilot America!</p>
            </div>
          </div>
        `,
        text: 'Test notification from Autopilot America. Vehicle: TEST123. If you received this, your notifications are working correctly.'
      });
      results.email = {
        sent: emailResult,
        to: email,
        message: emailResult ? 'Email sent successfully' : 'Email failed to send'
      };
    }

    // Test SMS notification
    if (phone && (testType === 'all' || testType === 'sms')) {
      console.log('Testing SMS notification to:', phone);
      const smsResult = await notificationService.sendSMS({
        to: phone,
        message: 'Ticketless test: Your notifications are working! You\'ll receive reminders before renewals are due.'
      });
      results.sms = {
        sent: smsResult,
        to: phone,
        message: smsResult ? 'SMS sent successfully' : 'SMS failed - check phone number and ClickSend credentials'
      };
    }

    // Test voice call
    if (phone && (testType === 'all' || testType === 'voice')) {
      console.log('Testing voice call to:', phone);
      const voiceResult = await notificationService.sendVoiceCall({
        to: phone,
        message: 'Hello, this is a test call from Autopilot America. We are testing your notification preferences. If you received this call, your voice notifications are set up correctly. Thank you for using Autopilot America. Have a great day!'
      });
      results.voice = {
        sent: voiceResult,
        to: phone,
        message: voiceResult ? 'Voice call initiated successfully' : 'Voice call failed - check phone number and ClickSend credentials'
      };
    }

    // Check if we should also update a test user in the database
    if (req.body.updateTestUser) {
      const { data: existingUser } = await supabaseAdmin
        .from('vehicle_reminders')
        .select('*')
        .eq('email', email)
        .single();

      if (existingUser) {
        // Update existing user
        await supabaseAdmin
          .from('vehicle_reminders')
          .update({
            phone: phone || existingUser.phone,
            license_plate_expiry: new Date().toISOString().split('T')[0], // Set to today
            sent_reminders: [], // Clear sent reminders to allow new notifications
            notification_preferences: {
              email: true,
              sms: !!phone,
              voice: false,
              reminder_days: [30, 7, 3, 1, 0]
            }
          })
          .eq('email', email);
        
        results.database = 'Updated existing test user';
      } else {
        // Create new test user
        await supabaseAdmin
          .from('vehicle_reminders')
          .insert({
            user_id: crypto.randomUUID(),
            license_plate: 'TEST' + Date.now().toString().slice(-4),
            email: email,
            phone: phone || '+15551234567',
            license_plate_expiry: new Date().toISOString().split('T')[0], // Set to today
            city_sticker_expiry: '2025-12-31',
            notification_preferences: {
              email: true,
              sms: !!phone,
              voice: false,
              reminder_days: [30, 7, 3, 1, 0]
            },
            sent_reminders: []
          });
        
        results.database = 'Created new test user';
      }
    }

    res.status(200).json({
      success: true,
      results,
      message: 'Test notifications processed. Check your email/phone for messages.'
    });

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      error: 'Failed to send test notifications',
      details: error instanceof Error ? error.message : 'Unknown error',
      results
    });
  }
}
import { supabaseAdmin } from './supabase';
import { createNotificationScheduler } from './notifications';

/**
 * Automated Test Harness
 *
 * Generates fake users in various states to test messaging logic
 * Runs scenarios to verify correct messages fire
 *
 * Usage:
 *   import { generateTestUsers, runScenario, cleanupTestUsers } from './lib/test-harness';
 *
 *   // Generate test users
 *   await generateTestUsers();
 *
 *   // Run specific scenario
 *   const results = await runScenario('renewal_30_days_protection');
 *
 *   // Cleanup
 *   await cleanupTestUsers();
 */

export interface TestUser {
  user_id: string;
  email: string;
  phone_number: string;
  license_plate: string;
  has_protection: boolean;
  has_permit_zone: boolean;
  city_sticker_expiry?: string;
  license_plate_expiry?: string;
  emissions_date?: string;
  permit_zone?: number;
  notification_preferences?: any;
}

export interface TestScenario {
  name: string;
  description: string;
  users: TestUser[];
  expectedMessages: {
    messageKey: string;
    userId: string;
    result: 'sent' | 'skipped';
    reason?: string;
  }[];
}

/**
 * Generate fake users for testing
 * Creates users in various states to test all message paths
 */
export async function generateTestUsers(): Promise<{
  success: boolean;
  userIds: string[];
  error?: string;
}> {
  try {
    console.log('🧪 Generating test users...');

    const testUsers: Partial<TestUser>[] = [
      // Scenario 1: City sticker renewal in 30 days - Protection user
      {
        email: 'test-protection-30d@autopilottest.com',
        phone_number: '+15555550001',
        license_plate: 'TEST001',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 2: City sticker renewal in 30 days - Free user
      {
        email: 'test-free-30d@autopilottest.com',
        phone_number: '+15555550002',
        license_plate: 'TEST002',
        has_protection: false,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 3: City sticker renewal in 14 days - Protection user (post-purchase)
      {
        email: 'test-protection-14d@autopilottest.com',
        phone_number: '+15555550003',
        license_plate: 'TEST003',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(14),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 4: City sticker renewal in 60 days - Protection + Permit zone
      {
        email: 'test-permit-60d@autopilottest.com',
        phone_number: '+15555550004',
        license_plate: 'TEST004',
        has_protection: true,
        has_permit_zone: true,
        permit_zone: 42,
        city_sticker_expiry: getFutureDate(60),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 5: License plate renewal in 7 days
      {
        email: 'test-license-7d@autopilottest.com',
        phone_number: '+15555550005',
        license_plate: 'TEST005',
        has_protection: true,
        has_permit_zone: false,
        license_plate_expiry: getFutureDate(7),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 6: Emissions test in 1 day
      {
        email: 'test-emissions-1d@autopilottest.com',
        phone_number: '+15555550006',
        license_plate: 'TEST006',
        has_protection: false,
        has_permit_zone: false,
        emissions_date: getFutureDate(1),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 7: No phone number (should skip SMS)
      {
        email: 'test-no-phone@autopilottest.com',
        phone_number: null,
        license_plate: 'TEST007',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 8: SMS disabled in preferences
      {
        email: 'test-sms-disabled@autopilottest.com',
        phone_number: '+15555550008',
        license_plate: 'TEST008',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        notification_preferences: { sms: false, email: true, voice: false }
      },

      // Scenario 9: Multiple renewals due
      {
        email: 'test-multiple@autopilottest.com',
        phone_number: '+15555550009',
        license_plate: 'TEST009',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        license_plate_expiry: getFutureDate(30),
        emissions_date: getFutureDate(30),
        notification_preferences: { sms: true, email: true, voice: false }
      },

      // Scenario 10: Already received message recently (deduplication test)
      {
        email: 'test-dedup@autopilottest.com',
        phone_number: '+15555550010',
        license_plate: 'TEST010',
        has_protection: true,
        has_permit_zone: false,
        city_sticker_expiry: getFutureDate(30),
        notification_preferences: { sms: true, email: true, voice: false }
      }
    ];

    const createdUserIds: string[] = [];

    for (const userData of testUsers) {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          email: userData.email,
          phone_number: userData.phone_number,
          license_plate: userData.license_plate,
          license_state: 'IL',
          has_protection: userData.has_protection,
          has_permit_zone: userData.has_permit_zone,
          permit_zone: userData.permit_zone,
          city_sticker_expiry: userData.city_sticker_expiry,
          license_plate_expiry: userData.license_plate_expiry,
          emissions_date: userData.emissions_date,
          notification_preferences: userData.notification_preferences,
          // Mark as test user
          metadata: { is_test_user: true }
        })
        .select('user_id')
        .single();

      if (error) {
        console.error(`Failed to create test user ${userData.email}:`, error);
      } else if (data) {
        createdUserIds.push(data.user_id);
        console.log(`✅ Created test user: ${userData.email}`);
      }
    }

    console.log(`✅ Generated ${createdUserIds.length} test users`);

    return {
      success: true,
      userIds: createdUserIds
    };
  } catch (error: any) {
    console.error('❌ Error generating test users:', error);
    return {
      success: false,
      userIds: [],
      error: error.message
    };
  }
}

/**
 * Run a specific test scenario
 */
export async function runScenario(
  scenarioName: string,
  options?: { dryRun?: boolean }
): Promise<{
  success: boolean;
  scenario: string;
  messagesProcessed: number;
  messagesSent: number;
  messagesSkipped: number;
  errors: any[];
}> {
  try {
    console.log(`🧪 Running scenario: ${scenarioName}`);

    const dryRun = options?.dryRun !== false; // Default to dry run for safety

    // Create notification scheduler
    const scheduler = createNotificationScheduler({ dryRun });

    // Run the scheduler
    const results = await scheduler.processPendingReminders();

    console.log(`✅ Scenario complete: ${scenarioName}`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Sent: ${results.successful}`);
    console.log(`   Failed: ${results.failed}`);

    return {
      success: true,
      scenario: scenarioName,
      messagesProcessed: results.processed,
      messagesSent: results.successful,
      messagesSkipped: results.processed - results.successful,
      errors: results.errors
    };
  } catch (error: any) {
    console.error(`❌ Error running scenario ${scenarioName}:`, error);
    return {
      success: false,
      scenario: scenarioName,
      messagesProcessed: 0,
      messagesSent: 0,
      messagesSkipped: 0,
      errors: [error.message]
    };
  }
}

/**
 * Run all test scenarios
 */
export async function runAllScenarios(options?: {
  dryRun?: boolean;
}): Promise<any[]> {
  const scenarios = [
    'renewal_30_days_protection',
    'renewal_30_days_free',
    'renewal_14_days_post_purchase',
    'permit_zone_60_days',
    'license_plate_7_days',
    'emissions_test_1_day',
    'missing_phone_number',
    'sms_disabled',
    'multiple_renewals',
    'deduplication_test'
  ];

  const results = [];

  for (const scenario of scenarios) {
    const result = await runScenario(scenario, options);
    results.push(result);
  }

  return results;
}

/**
 * Cleanup test users
 */
export async function cleanupTestUsers(): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    console.log('🧹 Cleaning up test users...');

    // Delete all users with test emails
    const { error: deleteError, count } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .like('email', '%@autopilottest.com');

    if (deleteError) {
      console.error('Error deleting test users:', deleteError);
      return {
        success: false,
        deletedCount: 0,
        error: deleteError.message
      };
    }

    // Also delete test audit log entries
    await supabaseAdmin
      .from('message_audit_log')
      .delete()
      .like('user_email', '%@autopilottest.com');

    console.log(`✅ Deleted ${count || 0} test users`);

    return {
      success: true,
      deletedCount: count || 0
    };
  } catch (error: any) {
    console.error('❌ Error cleaning up test users:', error);
    return {
      success: false,
      deletedCount: 0,
      error: error.message
    };
  }
}

/**
 * Helper: Get date N days in the future
 */
function getFutureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Get test results from audit log
 */
export async function getTestResults(userEmail: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from('message_audit_log')
    .select('*')
    .eq('user_email', userEmail)
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching test results:', error);
    return [];
  }

  return data || [];
}

/**
 * Verify scenario expectations
 */
export async function verifyScenario(
  scenarioName: string,
  expectations: {
    userEmail: string;
    expectedMessages: string[];
    expectedSkips?: string[];
  }
): Promise<{
  passed: boolean;
  issues: string[];
}> {
  const results = await getTestResults(expectations.userEmail);
  const issues: string[] = [];

  // Check expected messages were sent
  for (const expectedKey of expectations.expectedMessages) {
    const found = results.find(
      (r) => r.message_key === expectedKey && r.result === 'sent'
    );
    if (!found) {
      issues.push(`Expected message '${expectedKey}' was not sent`);
    }
  }

  // Check expected skips
  if (expectations.expectedSkips) {
    for (const expectedSkip of expectations.expectedSkips) {
      const found = results.find(
        (r) => r.message_key === expectedSkip && r.result === 'skipped'
      );
      if (!found) {
        issues.push(`Expected skip '${expectedSkip}' was not logged`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

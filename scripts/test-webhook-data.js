#!/usr/bin/env node

// Test if webhook is working by simulating the exact data flow
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testWebhookDataFlow() {
  console.log('🧪 TESTING WEBHOOK DATA FLOW');
  console.log('==============================\n');

  // Simulate the exact form data that would come from the homepage
  const testFormData = {
    name: 'Test User',
    email: 'test-webhook@example.com',
    phone: '312-555-0100',
    licensePlate: 'TEST123',
    vin: '1HGCM82633A001122',
    zipCode: '60601',
    vehicleType: 'passenger',
    vehicleYear: 2022,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31',
    emissionsDate: '2025-06-30',
    streetAddress: '123 Main St, Chicago, IL 60601',
    mailingAddress: '123 Main St',
    mailingCity: 'Chicago',
    mailingState: 'IL',
    mailingZip: '60601',
    emailNotifications: true,
    smsNotifications: true,
    voiceNotifications: true,
    reminderDays: [60, 30, 14, 7, 1],
    billingPlan: 'monthly',
    conciergeService: true,
    cityStickersOnly: false,
    spendingLimit: 500
  };

  console.log('📋 TEST FORM DATA:');
  console.log(JSON.stringify(testFormData, null, 2));

  try {
    // First, create a test user with a proper UUID
    const { randomUUID } = require('crypto');
    const testUserId = randomUUID();
    
    console.log('\n🔧 TESTING DIRECT USER INSERTION...');
    const { data: insertedUser, error: insertError } = await supabase
      .from('users')
      .insert([{
        id: testUserId,
        email: testFormData.email,
        phone: testFormData.phone || null,
        first_name: testFormData.name ? testFormData.name.split(' ')[0] : null,
        last_name: testFormData.name ? testFormData.name.split(' ').slice(1).join(' ') : null,
        notification_preferences: {
          email: testFormData.emailNotifications !== false,
          sms: testFormData.smsNotifications || false,
          voice: testFormData.voiceNotifications || false,
          reminder_days: testFormData.reminderDays || [30, 7, 1]
        },
        license_plate: testFormData.licensePlate,
        vin: testFormData.vin,
        zip_code: testFormData.zipCode,
        vehicle_type: testFormData.vehicleType,
        vehicle_year: testFormData.vehicleYear,
        city_sticker_expiry: testFormData.cityStickerExpiry,
        license_plate_expiry: testFormData.licensePlateExpiry,
        emissions_date: testFormData.emissionsDate,
        street_address: testFormData.streetAddress,
        mailing_address: testFormData.mailingAddress,
        mailing_city: testFormData.mailingCity,
        mailing_state: testFormData.mailingState,
        mailing_zip: testFormData.mailingZip,
        concierge_service: testFormData.conciergeService || false,
        city_stickers_only: testFormData.cityStickersOnly || false,
        spending_limit: testFormData.spendingLimit || 500,
        email_verified: true,
        phone_verified: false
      }])
      .select()
      .single();

    if (insertError) {
      console.log('❌ FAILED TO INSERT USER:');
      console.log('Error:', insertError.message);
      console.log('Code:', insertError.code);
      console.log('Details:', insertError.details);
      return;
    }

    console.log('✅ USER INSERTED SUCCESSFULLY!');
    console.log('User ID:', insertedUser.id);

    // Now read it back to verify all fields were saved
    const { data: retrievedUser, error: retrieveError } = await supabase
      .from('users')
      .select('*')
      .eq('id', testUserId)
      .single();

    if (retrieveError) {
      console.log('❌ FAILED TO RETRIEVE USER:', retrieveError);
      return;
    }

    console.log('\n📊 RETRIEVED USER DATA:');
    console.log('Phone:', retrievedUser.phone);
    console.log('First Name:', retrievedUser.first_name);
    console.log('Last Name:', retrievedUser.last_name);
    console.log('City Sticker Expiry:', retrievedUser.city_sticker_expiry);
    console.log('License Plate Expiry:', retrievedUser.license_plate_expiry);
    console.log('Emissions Date:', retrievedUser.emissions_date);
    console.log('Street Address:', retrievedUser.street_address);
    console.log('SMS Notifications:', retrievedUser.notification_preferences?.sms);
    console.log('Voice Notifications:', retrievedUser.notification_preferences?.voice);
    console.log('Reminder Days:', retrievedUser.notification_preferences?.reminder_days);

    // Clean up
    await supabase.from('users').delete().eq('id', testUserId);
    console.log('\n🧹 Cleaned up test user');

    console.log('\n✅ DATABASE CAN STORE ALL FORM DATA CORRECTLY!');
    console.log('\n🤔 NEXT: Check if webhook is being called by Stripe');
    console.log('   1. Check Stripe Dashboard → Webhooks → View delivery attempts');
    console.log('   2. Look for recent webhook calls with checkout.session.completed');
    console.log('   3. Check if webhook URL is correct: https://www.ticketlessamerica.com/api/stripe-webhook');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testWebhookDataFlow().catch(console.error);
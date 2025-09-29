#!/usr/bin/env node

// Test production notification system WITHOUT deploying any changes
// Run: node scripts/test-production-notifications.js

const https = require('https');

console.log('🔍 PRODUCTION NOTIFICATION DIAGNOSTICS\n');
console.log('=' .repeat(60));
console.log('\nThis will check your production notification system at ticketlessamerica.com');
console.log('WITHOUT deploying any new code.\n');

// Test the debug endpoint we created
async function testDebugEndpoint() {
  console.log('📊 Testing debug endpoint...\n');
  
  return new Promise((resolve) => {
    const data = JSON.stringify({
      email: 'randyvollrath@gmail.com'
    });

    const options = {
      hostname: 'ticketlessamerica.com',
      port: 443,
      path: '/api/notifications/debug',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(responseData);
            console.log('✅ Debug endpoint responded successfully!\n');
            
            // Display results
            console.log('🔧 ENVIRONMENT CHECKS:');
            console.log('-----------------------');
            const env = result.checks.environment;
            console.log(`ClickSend Username: ${env.hasClickSendUsername ? '✅ Set' : '❌ Missing'}`);
            console.log(`ClickSend API Key: ${env.hasClickSendApiKey ? '✅ Set' : '❌ Missing'}`);
            console.log(`Resend API Key: ${env.hasResendApiKey ? '✅ Set' : '❌ Missing'}`);
            console.log(`Resend From: ${env.resendFrom !== 'not set' ? '✅ ' + env.resendFrom : '❌ Missing'}`);
            
            console.log('\n💾 DATABASE:');
            console.log('------------');
            const db = result.checks.database;
            console.log(`Can connect: ${db.canConnect ? '✅ Yes' : '❌ No'}`);
            if (db.error) console.log(`Error: ${db.error}`);
            if (db.userProfilesCount !== undefined) {
              console.log(`Total users in user_profiles: ${db.userProfilesCount}`);
            }
            
            console.log('\n👤 YOUR USER DATA (randyvollrath@gmail.com):');
            console.log('---------------------------------------------');
            const user = result.checks.userData;
            console.log(`Found in user_profiles: ${user.found ? '✅ Yes' : '❌ No'}`);
            if (user.found) {
              console.log(`Has phone number: ${user.hasPhoneNumber ? '✅ Yes' : '❌ No'}`);
              console.log(`Has city sticker expiry: ${user.hasCityStickerExpiry ? '✅ Yes' : '❌ No'}`);
              console.log(`Has license plate expiry: ${user.hasLicensePlateExpiry ? '✅ Yes' : '❌ No'}`);
              console.log(`Has emissions date: ${user.hasEmissionsDate ? '✅ Yes' : '❌ No'}`);
              console.log(`Has notification preferences: ${user.hasNotificationPrefs ? '✅ Yes' : '❌ No'}`);
              console.log(`Has street cleaning data: ${user.hasStreetCleaningData ? '✅ Yes' : '❌ No'}`);
              
              if (Object.keys(user.daysUntilRenewals).length > 0) {
                console.log('\n📅 Days until renewals:');
                for (const [type, days] of Object.entries(user.daysUntilRenewals)) {
                  console.log(`  ${type}: ${days} days`);
                }
              }
              
              if (user.notificationPrefs) {
                console.log('\n🔔 Notification preferences:');
                console.log(JSON.stringify(user.notificationPrefs, null, 2));
              }
            }
            
            if (result.checks.oldUsersTable.found) {
              console.log('\n⚠️  DATA IN OLD TABLE:');
              console.log('----------------------');
              console.log('User found in OLD users table with:');
              const oldData = result.checks.oldUsersTable.hasData;
              console.log(`  Phone: ${oldData.phone ? '✅' : '❌'}`);
              console.log(`  City Sticker: ${oldData.cityStickerExpiry ? '✅' : '❌'}`);
              console.log(`  License Plate: ${oldData.licensePlateExpiry ? '✅' : '❌'}`);
              console.log(`  Emissions: ${oldData.emissionsDate ? '✅' : '❌'}`);
            }
            
            if (result.diagnosis && result.diagnosis.length > 0) {
              console.log('\n🔍 DIAGNOSIS:');
              console.log('-------------');
              result.diagnosis.forEach(item => console.log(item));
            }
            
            resolve(true);
          } catch (e) {
            console.log('Error parsing response:', e);
            console.log('Raw response:', responseData);
            resolve(false);
          }
        } else if (res.statusCode === 404) {
          console.log('❌ Debug endpoint not found (404)');
          console.log('   The debug endpoint hasn\'t been deployed yet.');
          console.log('   You\'ll need to deploy it first to use this diagnostic.');
          resolve(false);
        } else {
          console.log(`❌ Unexpected status code: ${res.statusCode}`);
          console.log('Response:', responseData);
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request failed:', error);
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

// Main execution
async function main() {
  const debugWorked = await testDebugEndpoint();
  
  if (!debugWorked) {
    console.log('\n⚠️  IMPORTANT: The debug endpoint needs to be deployed first.');
    console.log('   Since you don\'t want to accidentally deploy, you have two options:\n');
    console.log('   OPTION 1: Deploy just the debug endpoint');
    console.log('   -----------------------------------------');
    console.log('   The debug endpoint is safe - it only reads data and doesn\'t change anything.');
    console.log('   It\'s in: pages/api/notifications/debug.ts\n');
    console.log('   OPTION 2: Check Vercel logs directly');
    console.log('   -------------------------------------');
    console.log('   1. Go to https://vercel.com/your-team/ticketless-chicago');
    console.log('   2. Click on Functions tab');
    console.log('   3. Look for /api/notifications/process');
    console.log('   4. Check the logs for any errors\n');
  } else {
    console.log('\n✅ NEXT STEPS:');
    console.log('--------------');
    console.log('Based on the diagnosis above, fix any issues found.');
    console.log('Common fixes:');
    console.log('1. If user not in user_profiles: Need to migrate data');
    console.log('2. If missing phone/dates: Update user profile in database');
    console.log('3. If missing API keys: Add them in Vercel environment variables');
  }
}

main().catch(console.error);
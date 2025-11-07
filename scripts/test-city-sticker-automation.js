// Test the city sticker automation end-to-end
// Run: node scripts/test-city-sticker-automation.js

const { registerCitySticker } = require('../lib/city-sticker-automation');

// TEST DATA
// Replace with real data if you want to test with an actual vehicle
const testVehicle = {
  licensePlate: 'CW22016',  // Replace with actual plate
  vin: '1HGCM82633A123456',  // Replace with actual VIN (17 characters)
  lastName: 'Vollrath',  // Owner's last name
  email: 'randy@ticketlesschicago.com'
};

console.log('🧪 Testing City Sticker Automation\n');
console.log('═══════════════════════════════════════\n');
console.log('Test Vehicle Information:');
console.log(`  License Plate: ${testVehicle.licensePlate}`);
console.log(`  VIN: ${testVehicle.vin}`);
console.log(`  Email: ${testVehicle.email}`);
console.log('\n═══════════════════════════════════════\n');

console.log('⚠️  Running in DRY RUN mode');
console.log('   This will go through the entire process');
console.log('   but stop before completing payment\n');

registerCitySticker(testVehicle, true)
  .then(result => {
    console.log('\n═══════════════════════════════════════');
    console.log('📊 RESULT:');
    console.log('═══════════════════════════════════════\n');

    if (result.success) {
      console.log('✅ SUCCESS!');
      console.log(`\n${result.message}`);

      if (result.totalAmount) {
        console.log(`\n💰 Total Amount: $${result.totalAmount}`);
      }

      if (result.screenshots && result.screenshots.length > 0) {
        console.log(`\n📸 Screenshots saved:`);
        result.screenshots.forEach(s => console.log(`   - ${s}`));
      }

      console.log('\n✅ Automation is working!');
      console.log('\n📝 Next Steps:');
      console.log('   1. Review screenshots to verify each step');
      console.log('   2. Test with a vehicle actually due for renewal');
      console.log('   3. Add payment processing integration');
      console.log('   4. Add to user dashboard (when ready)');
    } else {
      console.log('❌ FAILED');
      console.log(`\nError: ${result.error}`);
      console.log(`\n${result.message}`);

      if (result.screenshots && result.screenshots.length > 0) {
        console.log(`\n📸 Screenshots saved (check for debugging):`);
        result.screenshots.forEach(s => console.log(`   - ${s}`));
      }

      console.log('\n📝 Troubleshooting:');
      console.log('   - Check if vehicle is eligible for renewal');
      console.log('   - Verify license plate and VIN are correct');
      console.log('   - Review screenshots for error messages');
    }

    console.log('\n═══════════════════════════════════════\n');
  })
  .catch(error => {
    console.error('\n❌ Unexpected error:', error.message);
    console.error(error.stack);
  });

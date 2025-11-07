const { checkUserTickets } = require('./lib/ticket-monitor');

console.log('🧪 Testing 2captcha integration with real user data...\n');

checkUserTickets({
  user_id: 'test-user-id',
  license_plate: 'CW22016',
  license_state: 'IL',
  last_name: 'Vollrath',
  email: 'test@example.com'
}).then(() => {
  console.log('\n✅ Test complete!');
}).catch(error => {
  console.error('\n❌ Test failed:', error.message);
});

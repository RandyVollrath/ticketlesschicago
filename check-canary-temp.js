const { supabaseAdmin } = require('./lib/supabase');

(async () => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, is_canary')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
  
  if (error) {
    console.log('Error:', error.message);
  } else {
    console.log('User found:');
    console.log('  Email:', data.email);
    console.log('  Is Canary:', data.is_canary);
    
    if (!data.is_canary) {
      console.log('\n❌ Randy is NOT set as a canary user');
    } else {
      console.log('\n✅ Randy IS a canary user');
    }
  }
})();

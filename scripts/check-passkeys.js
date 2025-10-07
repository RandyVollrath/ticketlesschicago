const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkPasskeys() {
  const email = 'heyliberalname@gmail.com'

  console.log('Looking up user:', email)

  // Get user ID
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()

  if (userError) {
    console.error('Error listing users:', userError)
    return
  }

  const user = users.find(u => u.email === email)

  if (!user) {
    console.log('User not found')
    return
  }

  console.log('User ID:', user.id)
  console.log('User created:', user.created_at)

  // Get passkeys for this user
  const { data: passkeys, error: passkeyError } = await supabase
    .from('user_passkeys')
    .select('*')
    .eq('user_id', user.id)

  if (passkeyError) {
    console.error('Error fetching passkeys:', passkeyError)
    return
  }

  console.log('\nPasskeys for this user:', passkeys?.length || 0)

  if (passkeys && passkeys.length > 0) {
    passkeys.forEach((pk, i) => {
      console.log(`\nPasskey ${i + 1}:`)
      console.log('  ID:', pk.id)
      console.log('  Name:', pk.name)
      console.log('  Credential ID (first 40 chars):', pk.credential_id?.substring(0, 40) + '...')
      console.log('  Created:', pk.created_at)
      console.log('  Last used:', pk.last_used)
      console.log('  Counter:', pk.counter)
    })
  } else {
    console.log('No passkeys registered')
  }
}

checkPasskeys().catch(console.error)

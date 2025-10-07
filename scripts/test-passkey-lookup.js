const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testLookup() {
  const email = 'heyliberalname@gmail.com'

  // Get user ID
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const user = users.find(u => u.email === email)

  console.log('User ID:', user.id)

  // Get the passkey
  const { data: passkeys } = await supabase
    .from('user_passkeys')
    .select('*')
    .eq('user_id', user.id)

  if (!passkeys || passkeys.length === 0) {
    console.log('No passkeys found')
    return
  }

  const passkey = passkeys[0]
  console.log('\nStored credential_id:', passkey.credential_id)
  console.log('Length:', passkey.credential_id.length)

  // Try to decode it to understand the format
  try {
    const decoded = Buffer.from(passkey.credential_id, 'base64')
    console.log('\nDecoded length:', decoded.length)
    console.log('Decoded as string:', decoded.toString('utf-8').substring(0, 50))

    // Check if it's double-encoded
    const asString = decoded.toString('utf-8')
    if (/^[A-Za-z0-9_-]+={0,2}$/.test(asString)) {
      console.log('\n⚠️  This looks double-encoded!')
      const doubleDecoded = Buffer.from(asString, 'base64url')
      console.log('Double-decoded length:', doubleDecoded.length)
    } else {
      console.log('\n✓ This appears properly encoded')
    }
  } catch (e) {
    console.error('Error decoding:', e.message)
  }

  // Test lookup with the exact credential_id
  console.log('\n--- Testing database lookup ---')
  const { data: found, error } = await supabase
    .from('user_passkeys')
    .select('user_id')
    .eq('credential_id', passkey.credential_id)
    .single()

  if (error) {
    console.error('Lookup failed:', error.message)
  } else {
    console.log('✓ Found passkey by exact match')
  }
}

testLookup().catch(console.error)

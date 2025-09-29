import { NextApiRequest, NextApiResponse } from 'next'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { supabaseAdmin } from '../../../../lib/supabase'

// This would be stored in your database in a real application
const rpID = process.env.PASSKEY_RP_ID || 'localhost'
const rpName = 'Ticketless America'
const origin = process.env.PASSKEY_ORIGIN || 'http://localhost:3000'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email } = req.body

    // In a real app, you'd look up the user's registered authenticators
    // For now, we'll generate options that work with any registered passkey
    const options = await generateAuthenticationOptions({
      rpID,
      // If you have specific user authenticators, you'd include them here
      allowCredentials: [],
      userVerification: 'preferred',
    })

    // Store the challenge temporarily (in production, use Redis or database)
    // For now, we'll pass it back and forth
    res.json({
      ...options,
      rpID,
      origin
    })
  } catch (error) {
    console.error('Passkey authentication error:', error)
    res.status(500).json({ error: 'Failed to generate authentication options' })
  }
}
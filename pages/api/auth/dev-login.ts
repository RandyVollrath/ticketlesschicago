import { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin } from '../../../lib/supabase'
import { sanitizeErrorMessage } from '../../../lib/error-utils'

// DEV ONLY: Direct login endpoint for testing when email is not working
// REMOVE THIS IN PRODUCTION!
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Admin client not configured' })
    }

    // Generate a magic link using the admin API
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`
      }
    })

    if (error) throw error

    // In development, return the link directly
    res.json({ 
      success: true,
      message: 'Development login link generated',
      link: data.properties?.action_link
    })
  } catch (error: any) {
    console.error('Dev login error:', error)
    res.status(500).json({
      error: sanitizeErrorMessage(error)
    })
  }
}
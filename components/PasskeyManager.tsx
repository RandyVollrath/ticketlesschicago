import React, { useState, useEffect } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { supabase } from '../lib/supabase'

interface Passkey {
  id: string
  name: string
  created_at: string
  last_used?: string
}

export default function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)

  useEffect(() => {
    // Check if passkeys are supported
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeysSupported(true)
    }

    // Load existing passkeys
    loadPasskeys()
  }, [])

  const loadPasskeys = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setPasskeys([])
        return
      }

      const { data, error } = await supabase
        .from('user_passkeys')
        .select('id, name, created_at, last_used')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error loading passkeys:', error)
        setPasskeys([])
        return
      }

      // Ensure data is always an array and each item has required properties
      const safePasskeys = Array.isArray(data) ? data.filter(pk => pk && pk.id && pk.created_at) : []
      setPasskeys(safePasskeys)
    } catch (error) {
      console.error('Error loading passkeys:', error)
      setPasskeys([]) // Ensure passkeys is always an array
    }
  }

  const registerPasskey = async () => {
    if (!passkeysSupported) {
      setMessage({
        type: 'error',
        text: 'Passkeys are not supported on this device or browser'
      })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Start registration
      const response = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start',
          email: user.email,
          userId: user.id
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Passkey registration start failed:', errorData)
        throw new Error(errorData.details || errorData.error || 'Failed to start passkey registration')
      }

      const options = await response.json()
      console.log('Registration options received:', options)
      
      // Validate options before passing to startRegistration
      if (!options || !options.challenge) {
        throw new Error('Invalid registration options received from server')
      }
      
      const registration = await startRegistration({ optionsJSON: options })
      console.log('Registration response from browser:', registration)

      // Verify registration
      const verifyPayload = {
        action: 'verify',
        registration,
        challenge: options.challenge,
        userId: user.id
      }
      console.log('Sending verification payload:', verifyPayload)
      
      const verifyResponse = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyPayload)
      })

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json()
        console.error('Passkey registration verify failed:', errorData)
        throw new Error(errorData.details || errorData.error || 'Failed to verify passkey registration')
      }

      setMessage({
        type: 'success',
        text: 'Passkey registered successfully! You can now use it to sign in.'
      })

      // Reload passkeys
      await loadPasskeys()
    } catch (error: any) {
      console.error('Passkey registration error:', error)
      setMessage({
        type: 'error',
        text: error.message || 'Failed to register passkey'
      })
    } finally {
      setLoading(false)
    }
  }

  const deletePasskey = async (passkeyId: string) => {
    if (!confirm('Are you sure you want to remove this passkey?')) return

    try {
      const { error } = await supabase
        .from('user_passkeys')
        .delete()
        .eq('id', passkeyId)

      if (error) throw error

      setMessage({
        type: 'success',
        text: 'Passkey removed successfully'
      })

      await loadPasskeys()
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to remove passkey'
      })
    }
  }

  if (!passkeysSupported) {
    return (
      <div style={{ 
        border: '1px solid #d1d5db', 
        borderRadius: '8px', 
        padding: '16px',
        backgroundColor: '#f9fafb'
      }}>
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
          Passkeys
        </h3>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>
          Passkeys are not supported on this device or browser. Please use a modern browser with WebAuthn support.
        </p>
      </div>
    )
  }

  return (
    <div style={{ 
      border: '1px solid #d1d5db', 
      borderRadius: '8px', 
      padding: '16px' 
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
            Passkeys
          </h3>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            Use your device's biometric authentication for secure, passwordless sign-in.
          </p>
        </div>
        <button
          onClick={registerPasskey}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1
          }}
        >
          {loading ? 'Adding...' : 'Add Passkey'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '12px',
          borderRadius: '6px',
          fontSize: '14px',
          marginBottom: '16px',
          backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
          color: message.type === 'success' ? '#166534' : '#dc2626',
          border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`
        }}>
          {message.text}
        </div>
      )}

      {!Array.isArray(passkeys) || passkeys.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '32px',
          color: '#6b7280',
          fontSize: '14px'
        }}>
          <svg 
            style={{ width: '48px', height: '48px', margin: '0 auto 16px', opacity: 0.5 }} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p>No passkeys registered yet.</p>
          <p>Add a passkey to enable faster, more secure sign-in.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.isArray(passkeys) && passkeys.map((passkey) => (
            <div 
              key={passkey.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                backgroundColor: '#f9fafb'
              }}
            >
              <div>
                <div style={{ fontWeight: '500', fontSize: '14px' }}>
                  {passkey.name || 'Unnamed Passkey'}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Added {new Date(passkey.created_at).toLocaleDateString()}
                  {passkey.last_used && (
                    <span> • Last used {new Date(passkey.last_used).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => deletePasskey(passkey.id)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
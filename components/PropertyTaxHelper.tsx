import React, { useState } from 'react'

interface PropertyTaxHelperProps {
  userAddress: string
  userId?: string
  onBillFetched: (url: string) => void
  onError: (error: string) => void
}

export default function PropertyTaxHelper({
  userAddress,
  userId,
  onBillFetched,
  onError
}: PropertyTaxHelperProps) {
  const [fetching, setFetching] = useState(false)
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'searching' | 'downloading' | 'uploading' | 'success' | 'error'>('idle')

  // Build the Cook County Property Info Portal URL (better than treasurer site)
  const cookCountySearchUrl = 'https://www.cookcountypropertyinfo.com'

  const handleAutoFetch = async () => {
    if (!userAddress) {
      onError('Please enter your street address first')
      return
    }

    if (!userId) {
      onError('Please sign in to use auto-fetch')
      return
    }

    setFetching(true)
    setFetchStatus('searching')

    try {
      const response = await fetch('/api/property-tax/auto-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          address: userAddress
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch tax bill')
      }

      if (data.success && data.pdfUrl) {
        setFetchStatus('success')
        onBillFetched(data.pdfUrl)
      } else {
        throw new Error(data.error || 'Could not retrieve tax bill')
      }
    } catch (error: any) {
      console.error('Auto-fetch error:', error)
      setFetchStatus('error')
      onError(error.message || 'Failed to fetch tax bill. Please try manual download.')
    } finally {
      setFetching(false)
    }
  }

  return (
    <div style={{
      marginBottom: '24px',
      padding: '20px',
      backgroundColor: '#f0f9ff',
      border: '1px solid #bae6fd',
      borderRadius: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ fontSize: '24px' }}>🏠</span>
        <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#0369a1' }}>
          Get Your Property Tax Bill
        </h4>
      </div>

      {/* Option 1: Auto-Fetch (1-click) */}
      <div style={{
        padding: '16px',
        backgroundColor: 'white',
        border: '1px solid #e0f2fe',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            backgroundColor: '#0ea5e9',
            color: 'white',
            borderRadius: '50%',
            fontSize: '12px',
            fontWeight: '600'
          }}>1</span>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#0c4a6e' }}>
            Easiest: We Fetch It For You
          </span>
          <span style={{
            fontSize: '11px',
            backgroundColor: '#dcfce7',
            color: '#166534',
            padding: '2px 8px',
            borderRadius: '12px',
            fontWeight: '500'
          }}>
            Recommended
          </span>
        </div>

        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0', lineHeight: '1.5' }}>
          Click below and we'll automatically retrieve your property tax bill from Cook County Treasurer's public records.
        </p>

        {userAddress && (
          <p style={{ fontSize: '12px', color: '#0369a1', margin: '0 0 12px 0', backgroundColor: '#f0f9ff', padding: '8px 12px', borderRadius: '6px' }}>
            <strong>Address:</strong> {userAddress}
          </p>
        )}

        <button
          onClick={handleAutoFetch}
          disabled={fetching || !userAddress}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: '600',
            color: 'white',
            backgroundColor: fetching ? '#94a3b8' : '#0ea5e9',
            border: 'none',
            borderRadius: '8px',
            cursor: fetching || !userAddress ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'background-color 0.2s'
          }}
        >
          {fetching ? (
            <>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid white',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              {fetchStatus === 'searching' && 'Searching Cook County records...'}
              {fetchStatus === 'downloading' && 'Downloading tax bill...'}
              {fetchStatus === 'uploading' && 'Saving to your account...'}
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="7,10 12,15 17,10" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Fetch My Tax Bill (1 Click)
            </>
          )}
        </button>

        {fetchStatus === 'success' && (
          <div style={{
            marginTop: '12px',
            padding: '10px 12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '16px' }}>✅</span>
            <span style={{ fontSize: '13px', color: '#166534', fontWeight: '500' }}>
              Tax bill fetched and saved successfully!
            </span>
          </div>
        )}

        {fetchStatus === 'error' && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: '500', color: '#991b1b', marginBottom: '8px' }}>
              Auto-fetch didn't work (Cook County's site may require CAPTCHA)
            </div>
            <div style={{ fontSize: '12px', color: '#7f1d1d' }}>
              No worries - use the manual option below. It only takes 60 seconds!
            </div>
          </div>
        )}

        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '16px 0'
      }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#cbd5e1' }} />
        <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '500' }}>OR</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#cbd5e1' }} />
      </div>

      {/* Option 2: Manual Download */}
      <div style={{
        padding: '16px',
        backgroundColor: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            backgroundColor: '#64748b',
            color: 'white',
            borderRadius: '50%',
            fontSize: '12px',
            fontWeight: '600'
          }}>2</span>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#334155' }}>
            Manual: Download It Yourself (60 seconds)
          </span>
        </div>

        <ol style={{
          margin: '0 0 16px 0',
          paddingLeft: '20px',
          fontSize: '13px',
          color: '#475569',
          lineHeight: '1.8'
        }}>
          <li>Click the link below to open Cook County Property Info</li>
          <li>Click "Search by Property Address"</li>
          <li>Enter your address and click Search</li>
          <li>Click "View/Print Tax Bill" and download the PDF</li>
        </ol>

        <a
          href={cookCountySearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: '500',
            color: '#0369a1',
            backgroundColor: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '6px',
            textDecoration: 'none',
            transition: 'all 0.2s'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="15,3 21,3 21,9" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="10" y1="14" x2="21" y2="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Open Cook County Property Info Portal
        </a>
      </div>

      {/* Info Note */}
      <div style={{
        marginTop: '16px',
        padding: '12px',
        backgroundColor: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#92400e',
        lineHeight: '1.5'
      }}>
        <strong>Why property tax bills?</strong> They're publicly available, show your name and address, and prove homeownership. The City Clerk accepts them as valid proof of residency.
      </div>
    </div>
  )
}

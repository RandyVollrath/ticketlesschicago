import React from 'react'

interface PropertyTaxHelperProps {
  userAddress: string
}

export default function PropertyTaxHelper({
  userAddress
}: PropertyTaxHelperProps) {
  // Cook County Treasurer - has actual downloadable tax bills
  const treasurerSearchUrl = 'https://www.cookcountytreasurer.com/yourpropertytaxoverview.aspx'

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
          Get Your Property Tax Bill (60 seconds)
        </h4>
      </div>

      {userAddress && (
        <p style={{ fontSize: '12px', color: '#0369a1', margin: '0 0 16px 0', backgroundColor: '#e0f2fe', padding: '10px 12px', borderRadius: '6px' }}>
          <strong>Your address:</strong> {userAddress}
        </p>
      )}

      <div style={{
        padding: '16px',
        backgroundColor: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <ol style={{
          margin: '0 0 16px 0',
          paddingLeft: '20px',
          fontSize: '13px',
          color: '#475569',
          lineHeight: '2'
        }}>
          <li>Click the button below to open Cook County Treasurer</li>
          <li>Click <strong>"Search by Property Address"</strong></li>
          <li>Enter your house number and street name <em>(without N/S/E/W or St/Ave)</em></li>
          <li>Click <strong>Search</strong>, then select your property</li>
          <li>Click <strong>"Download a copy of your tax bill"</strong></li>
          <li>Come back here and upload that PDF</li>
        </ol>

        <a
          href={treasurerSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: '600',
            color: 'white',
            backgroundColor: '#0ea5e9',
            border: 'none',
            borderRadius: '8px',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.2s'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="15,3 21,3 21,9" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="10" y1="14" x2="21" y2="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Open Cook County Treasurer
        </a>
      </div>

      {/* Tip for address format */}
      <div style={{
        padding: '12px',
        backgroundColor: '#fef3c7',
        border: '1px solid #fde68a',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#92400e',
        lineHeight: '1.5'
      }}>
        <strong>Tip:</strong> For "938 W Montana St", enter house number <strong>938</strong> and street <strong>Montana</strong> (no "W" or "St")
      </div>

      {/* Info Note */}
      <div style={{
        marginTop: '12px',
        padding: '12px',
        backgroundColor: '#f0fdf4',
        border: '1px solid #86efac',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#166534',
        lineHeight: '1.5'
      }}>
        <strong>Why property tax bills?</strong> They're publicly available, show your name and address, and prove homeownership. The City Clerk accepts them as valid proof of residency.
      </div>
    </div>
  )
}

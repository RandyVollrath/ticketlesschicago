import React from 'react'

interface AlternativeSection {
  ward: string
  section: string
  distance_type: 'same_ward' | 'adjacent_ward'
  street_boundaries?: string[]
  next_cleaning_date?: string | null
}

interface SimpleMapProps {
  alternatives: AlternativeSection[]
  userWard?: string
  userSection?: string
}

export default function SimpleMap({ alternatives, userWard, userSection }: SimpleMapProps) {
  return (
    <div style={{ 
      width: '100%', 
      height: '500px', 
      backgroundColor: '#f8fafc', 
      borderRadius: '0 0 12px 12px', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      border: '1px solid #e2e8f0',
      padding: '40px'
    }}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ 
          fontSize: '48px', 
          marginBottom: '16px',
          background: 'linear-gradient(135deg, #3b82f6, #10b981)',
          borderRadius: '50%',
          width: '80px',
          height: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto'
        }}>
          <span style={{ fontSize: '32px' }}>🗺️</span>
        </div>
        <h3 style={{ 
          fontSize: '18px', 
          fontWeight: '600',
          color: '#1f2937',
          marginBottom: '8px'
        }}>
          Interactive Map
        </h3>
        <p style={{ 
          color: '#6b7280', 
          fontSize: '14px', 
          margin: '0 0 16px 0',
          lineHeight: '1.5'
        }}>
          View {alternatives.length} alternative parking zones
          {userWard && userSection && (
            <span> near Ward {userWard}, Section {userSection}</span>
          )}
        </p>
        
        {alternatives.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px',
            marginTop: '16px',
            fontSize: '12px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              justifyContent: 'center'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                backgroundColor: '#10b981',
                borderRadius: '50%',
                border: '2px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }}></div>
              <span style={{ color: '#059669' }}>Same Ward</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              justifyContent: 'center'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                backgroundColor: '#f59e0b',
                borderRadius: '50%',
                border: '2px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }}></div>
              <span style={{ color: '#d97706' }}>Adjacent Ward</span>
            </div>
          </div>
        )}
        
        <div style={{
          marginTop: '20px',
          padding: '12px',
          backgroundColor: '#eff6ff',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#1e40af'
        }}>
          Full interactive map coming soon with detailed zone boundaries and real-time availability
        </div>
      </div>
    </div>
  )
}
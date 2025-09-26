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
      padding: '24px',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h3 style={{ 
          fontSize: '18px', 
          fontWeight: '600',
          color: '#1f2937',
          marginBottom: '8px',
          margin: 0
        }}>
          Alternative Parking Map
        </h3>
        <p style={{ 
          color: '#6b7280', 
          fontSize: '14px', 
          margin: '4px 0 0 0'
        }}>
          {alternatives.length} zones found near Ward {userWard}, Section {userSection}
        </p>
      </div>

      {/* Zone Grid */}
      {alternatives.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '12px',
          flex: 1
        }}>
          {alternatives.map((zone, index) => (
            <div
              key={`${zone.ward}-${zone.section}`}
              style={{
                backgroundColor: 'white',
                border: `2px solid ${zone.distance_type === 'same_ward' ? '#10b981' : '#f59e0b'}`,
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                height: 'fit-content'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '8px',
                gap: '8px'
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  backgroundColor: zone.distance_type === 'same_ward' ? '#10b981' : '#f59e0b',
                  borderRadius: '50%'
                }}></div>
                <strong style={{ color: '#1f2937' }}>
                  Ward {zone.ward}, Section {zone.section}
                </strong>
              </div>
              
              <div style={{
                fontSize: '11px',
                color: zone.distance_type === 'same_ward' ? '#059669' : '#d97706',
                marginBottom: '6px',
                fontWeight: '500'
              }}>
                {zone.distance_type === 'same_ward' ? '✓ Same Ward' : '→ Adjacent Ward'}
              </div>

              {zone.next_cleaning_date && (
                <div style={{ 
                  fontSize: '11px', 
                  color: '#666', 
                  marginBottom: '6px' 
                }}>
                  Next: {new Date(zone.next_cleaning_date).toLocaleDateString()}
                </div>
              )}

              {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                <div style={{ fontSize: '10px', color: '#6b7280' }}>
                  <div style={{ fontWeight: '500', marginBottom: '2px' }}>Boundaries:</div>
                  {zone.street_boundaries.slice(0, 2).map((boundary, i) => (
                    <div key={i} style={{ marginLeft: '4px' }}>• {boundary}</div>
                  ))}
                  {zone.street_boundaries.length > 2 && (
                    <div style={{ marginLeft: '4px', fontStyle: 'italic' }}>
                      +{zone.street_boundaries.length - 2} more...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ 
          textAlign: 'center', 
          color: '#6b7280', 
          fontSize: '14px',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          No alternative parking zones found
        </div>
      )}

      {/* Legend */}
      {alternatives.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '16px',
          marginTop: '16px',
          fontSize: '11px',
          paddingTop: '12px',
          borderTop: '1px solid #e2e8f0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%'
            }}></div>
            <span style={{ color: '#059669' }}>Same Ward (Preferred)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '8px', height: '8px', backgroundColor: '#f59e0b', borderRadius: '50%'
            }}></div>
            <span style={{ color: '#d97706' }}>Adjacent Ward</span>
          </div>
        </div>
      )}
    </div>
  )
}
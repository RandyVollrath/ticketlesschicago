import React from 'react'

interface AlternativeSection {
  ward: string
  section: string
  distance_type: 'same_ward' | 'adjacent_ward'
  street_boundaries?: string[]
  next_cleaning_date?: string | null
}

interface AlternativeParkingZonesProps {
  alternatives: AlternativeSection[]
  onZoneClick?: (ward: string, section: string) => void
}

const AlternativeParkingZones: React.FC<AlternativeParkingZonesProps> = ({ alternatives, onZoneClick }) => {
  if (!alternatives || alternatives.length === 0) {
    return null
  }

  return (
    <div style={{
      background: '#e7f3ff',
      border: '1px solid #b8daff',
      borderRadius: '8px',
      padding: '16px',
      marginTop: '16px'
    }}>
      <h4 style={{
        margin: '0 0 12px 0',
        color: '#004085',
        fontSize: '16px',
        fontWeight: '600'
      }}>
        🅿️ Park here instead - Safe parking zones nearby:
      </h4>
      
      <ul style={{
        margin: '0 0 12px 0',
        paddingLeft: '20px'
      }}>
        {alternatives.map((zone, index) => (
          <li
            key={`${zone.ward}-${zone.section}`}
            style={{
              marginBottom: '12px',
              color: '#004085',
              cursor: onZoneClick ? 'pointer' : 'default',
              padding: '8px',
              borderRadius: '4px',
              transition: 'background-color 0.2s ease'
            }}
            onClick={() => onZoneClick?.(zone.ward, zone.section)}
            onMouseEnter={(e) => {
              if (onZoneClick) {
                e.currentTarget.style.backgroundColor = '#cce7ff'
              }
            }}
            onMouseLeave={(e) => {
              if (onZoneClick) {
                e.currentTarget.style.backgroundColor = 'transparent'
              }
            }}
          >
            <div>
              <strong>Ward {zone.ward}, Section {zone.section}</strong>
              <span style={{
                display: 'inline-block',
                marginLeft: '8px',
                padding: '2px 6px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: '500',
                backgroundColor: zone.distance_type === 'same_ward' ? '#d4edda' : '#fff3cd',
                color: zone.distance_type === 'same_ward' ? '#155724' : '#856404'
              }}>
                {zone.distance_type === 'same_ward' ? 'Same Ward' : 'Adjacent Ward'}
              </span>
              {zone.next_cleaning_date && (
                <span style={{
                  display: 'block',
                  fontSize: '12px',
                  color: '#666',
                  marginTop: '4px'
                }}>
                  Next cleaning: {new Date(zone.next_cleaning_date).toLocaleDateString()}
                </span>
              )}
            </div>
            
            {zone.street_boundaries && zone.street_boundaries.length > 0 && (
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                <div style={{ fontWeight: '500', marginBottom: '2px' }}>Boundaries:</div>
                {zone.street_boundaries.map((boundary, i) => (
                  <div key={i} style={{ marginLeft: '8px' }}>• {boundary}</div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      
      <p style={{
        margin: '0',
        fontSize: '14px',
        color: '#004085',
        fontStyle: 'italic'
      }}>
        💡 These zones have different cleaning schedules. Always verify before parking.
      </p>
    </div>
  )
}

export default AlternativeParkingZones
import React from 'react';

export interface PermitZoneWarningProps {
  zones: Array<{
    zone: string;
    status: string;
    addressRange: string;
    ward: string;
  }>;
}

export function PermitZoneWarning({ zones }: PermitZoneWarningProps) {
  if (!zones || zones.length === 0) {
    return null;
  }

  return (
    <div style={{
      backgroundColor: '#fef3c7',
      border: '2px solid #fde68a',
      borderRadius: '12px',
      padding: '16px',
      marginTop: '12px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }}>
        <div style={{ fontSize: '24px', flexShrink: 0 }}>
          🅿️
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{
            fontSize: '15px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '8px',
            margin: '0 0 8px 0'
          }}>
            Permit Parking Zone Detected
          </h4>
          <p style={{
            fontSize: '14px',
            color: '#78350f',
            lineHeight: '1.6',
            margin: '0 0 12px 0'
          }}>
            This address is in a Chicago residential permit parking zone. If you don't have a permit, you may receive parking tickets even when following street cleaning rules.
          </p>
          {zones.map((zone, index) => (
            <div
              key={index}
              style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: index < zones.length - 1 ? '8px' : '0',
                border: '1px solid #fde68a'
              }}
            >
              <div style={{
                fontSize: '13px',
                color: '#92400e',
                lineHeight: '1.5'
              }}>
                <div><strong>Zone:</strong> {zone.zone}</div>
                <div><strong>Address Range:</strong> {zone.addressRange}</div>
                <div><strong>Ward:</strong> {zone.ward}</div>
              </div>
            </div>
          ))}
          <a
            href="https://www.chicago.gov/city/en/depts/cdot/provdrs/parking_and_transportation/svcs/parking_permits.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: '12px',
              fontSize: '13px',
              color: '#0052cc',
              textDecoration: 'none',
              fontWeight: '600'
            }}
          >
            Learn about Chicago parking permits →
          </a>
        </div>
      </div>
    </div>
  );
}

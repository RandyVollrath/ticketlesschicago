interface BetaBannerProps {
  city: string;
}

export default function BetaBanner({ city }: BetaBannerProps) {
  return (
    <div style={{
      backgroundColor: '#fff3cd',
      border: '1px solid #ffc107',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '20px'
    }}>
      <p style={{ margin: 0, fontSize: '14px', color: '#856404', lineHeight: '1.6' }}>
        <strong>⚠️ BETA:</strong> {city} street sweeping is in beta. Always verify schedules with posted signs on your block.
        {' '}
        <a
          href={`mailto:support@autopilotamerica.com?subject=${city} Schedule Error`}
          style={{ color: '#0052cc', textDecoration: 'underline' }}
        >
          Report error
        </a>
      </p>
    </div>
  );
}

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Footer from '../components/Footer';

const WardHeatMap = dynamic(() => import('../components/WardHeatMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '600px',
      backgroundColor: '#f3f4f6',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <p style={{ color: '#6b7280' }}>Loading map...</p>
    </div>
  )
});

interface WardData {
  ward: string;
  tickets_2024: number;
  risk_level: string;
  yoy_change: number;
  total_5yr: number;
  avg_per_year: number;
  trend: string;
}

interface HeatmapData {
  wards: WardData[];
  stats: {
    highest_risk: WardData;
    lowest_risk: WardData;
    avg_tickets: number;
    total_tickets_2024: number;
  };
}

export default function TicketHeatmap() {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Ward to neighborhood mapping (major neighborhoods)
  const wardNeighborhoods: { [key: string]: string } = {
    '01': 'Gold Coast',
    '02': 'Lincoln Park',
    '03': 'South Loop',
    '04': 'South Loop',
    '05': 'Hyde Park',
    '06': 'West Englewood',
    '07': 'Englewood',
    '08': 'Chatham',
    '09': 'South Chicago',
    '10': 'East Side',
    '11': 'Bridgeport',
    '12': 'Brighton Park',
    '13': 'West Lawn',
    '14': 'Archer Heights',
    '15': 'Gage Park',
    '16': 'Little Village',
    '17': 'North Lawndale',
    '18': 'Montclare',
    '19': 'Mount Greenwood',
    '20': 'Rogers Park',
    '21': 'Clearing',
    '22': 'Garfield Ridge',
    '23': 'Garfield Ridge',
    '24': 'Rogers Park',
    '25': 'West Town',
    '26': 'Humboldt Park',
    '27': 'West Loop',
    '28': 'Near West Side',
    '29': 'Austin',
    '30': 'Austin',
    '31': 'Portage Park',
    '32': 'Lakeview',
    '33': 'Uptown',
    '34': 'Edgewater',
    '35': 'Albany Park',
    '36': 'Irving Park',
    '37': 'Austin',
    '38': 'Jefferson Park',
    '39': 'Albany Park',
    '40': 'Lincoln Square',
    '41': 'Edison Park',
    '42': 'The Loop',
    '43': 'Lincoln Park',
    '44': 'Lakeview',
    '46': 'Uptown',
    '47': 'Lincoln Square',
    '48': 'Edgewater',
    '49': 'Rogers Park',
    '50': 'West Ridge'
  };

  useEffect(() => {
    fetch('/api/ticket-heatmap')
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'very_high': return '#dc2626'; // red-600
      case 'high': return '#ea580c'; // orange-600
      case 'medium': return '#f59e0b'; // amber-500
      case 'low': return '#10b981'; // emerald-500
      default: return '#6b7280'; // gray-500
    }
  };

  const getRiskLabel = (risk: string) => {
    switch (risk) {
      case 'very_high': return 'VERY HIGH';
      case 'high': return 'HIGH';
      case 'medium': return 'MEDIUM';
      case 'low': return 'LOW';
      default: return 'UNKNOWN';
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb'
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '18px', color: '#6b7280' }}>Loading ticket data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', padding: '40px 20px', backgroundColor: '#f9fafb' }}>
        <p style={{ textAlign: 'center', color: '#dc2626' }}>Error loading data</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Chicago Parking Ticket Heatmap | Autopilot America</title>
        <meta name="description" content="Interactive heatmap showing parking ticket risk by ward in Chicago" />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', paddingBottom: '60px' }}>
        {/* Header */}
        <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '20px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'none',
                border: 'none',
                color: '#0052cc',
                cursor: 'pointer',
                fontSize: '14px',
                marginBottom: '10px'
              }}
            >
              ← Back to Home
            </button>
            <h1 style={{ margin: '0', fontSize: '32px', fontWeight: 'bold', color: '#111827' }}>
              🎯 Chicago Parking Ticket Heatmap
            </h1>
            <p style={{ margin: '10px 0 0 0', color: '#6b7280', fontSize: '16px' }}>
              See which neighborhoods and wards have the highest parking ticket risk (2020-2024 data)
            </p>
          </div>
        </div>

        {/* Conversion CTAs */}
        <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
          {/* Consumer CTA */}
          <div style={{
            backgroundColor: '#eff6ff',
            border: '2px solid #3b82f6',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '24px', fontWeight: 'bold', color: '#1e40af' }}>
              💰 Chicago Paid $276M in Parking Tickets Last Year
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#1e40af' }}>
              Average driver could lose $1,000+/year to preventable tickets. Don't be a statistic.
            </p>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                marginRight: '12px'
              }}
            >
              Get Protection - $120/year
            </button>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'white',
                color: '#2563eb',
                border: '2px solid #2563eb',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Try Free Alerts First
            </button>
          </div>

          {/* Fleet Partner CTA */}
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '2px solid #86efac',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '30px',
            textAlign: 'center'
          }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '20px', fontWeight: 'bold', color: '#166534' }}>
              🚗 Fleet Operator? Prevent tickets with location-based alerts
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#166534' }}>
              API integration for car sharing, rental, and fleet management platforms
            </p>
            <button
              onClick={() => router.push('/partners')}
              style={{
                backgroundColor: '#16a34a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Learn About Fleet Partnerships →
            </button>
          </div>
        </div>

        {/* Stats Summary */}
        <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '20px',
            marginBottom: '30px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <p style={{ margin: '0', fontSize: '14px', color: '#6b7280', fontWeight: '600' }}>HIGHEST RISK</p>
              <p style={{ margin: '8px 0 4px 0', fontSize: '28px', fontWeight: 'bold', color: '#dc2626', lineHeight: '1.1' }}>
                {wardNeighborhoods[data.stats.highest_risk.ward] || `Ward ${data.stats.highest_risk.ward}`}
              </p>
              <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#9ca3af' }}>
                Ward {data.stats.highest_risk.ward}
              </p>
              <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>
                {data.stats.highest_risk.tickets_2024.toLocaleString()} tickets in 2024
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <p style={{ margin: '0', fontSize: '14px', color: '#6b7280', fontWeight: '600' }}>LOWEST RISK</p>
              <p style={{ margin: '8px 0 4px 0', fontSize: '28px', fontWeight: 'bold', color: '#10b981', lineHeight: '1.1' }}>
                {wardNeighborhoods[data.stats.lowest_risk.ward] || `Ward ${data.stats.lowest_risk.ward}`}
              </p>
              <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#9ca3af' }}>
                Ward {data.stats.lowest_risk.ward}
              </p>
              <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>
                {data.stats.lowest_risk.tickets_2024.toLocaleString()} tickets in 2024
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <p style={{ margin: '0', fontSize: '14px', color: '#6b7280', fontWeight: '600' }}>TOTAL TICKETS 2024</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>
                {(data.stats.total_tickets_2024 / 1000000).toFixed(1)}M
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
                Avg: {data.stats.avg_tickets.toLocaleString()} per ward
              </p>
            </div>
          </div>

          {/* Interactive Map */}
          <div style={{ marginBottom: '30px' }}>
            <h3 style={{
              fontSize: '24px',
              fontWeight: '700',
              color: '#111827',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Interactive Ward Map
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#6b7280',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Click on any ward to see ticket counts and risk level
            </p>
            <WardHeatMap wardsData={data.wards} />
          </div>

          {/* Risk Legend */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '30px'
          }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#111827' }}>RISK LEVELS</p>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {['very_high', 'high', 'medium', 'low'].map(risk => (
                <div key={risk} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    backgroundColor: getRiskColor(risk),
                    borderRadius: '4px'
                  }} />
                  <span style={{ fontSize: '14px', color: '#6b7280' }}>{getRiskLabel(risk)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Ward Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '16px'
          }}>
            {data.wards.map(ward => (
              <div
                key={ward.ward}
                style={{
                  backgroundColor: 'white',
                  padding: '16px',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  borderLeft: `4px solid ${getRiskColor(ward.risk_level)}`
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827', lineHeight: '1.2' }}>
                      {wardNeighborhoods[ward.ward] || `Ward ${ward.ward}`}
                    </div>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '2px' }}>
                      Ward {ward.ward}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: getRiskColor(ward.risk_level),
                    backgroundColor: `${getRiskColor(ward.risk_level)}15`,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    flexShrink: 0,
                    marginLeft: '8px'
                  }}>
                    {getRiskLabel(ward.risk_level)}
                  </span>
                </div>
                <p style={{ margin: '0', fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>
                  {ward.tickets_2024.toLocaleString()}
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                  tickets in 2024
                </p>
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0', fontSize: '12px', color: '#6b7280' }}>
                    {ward.yoy_change > 0 ? '📈' : ward.yoy_change < 0 ? '📉' : '➡️'}
                    {' '}{ward.yoy_change > 0 ? '+' : ''}{ward.yoy_change}% YoY
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#9ca3af' }}>
                    5yr avg: {ward.avg_per_year.toLocaleString()}/yr
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

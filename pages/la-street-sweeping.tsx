import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { LAStreetSweepingSchedule, getDayName } from '../lib/la-street-sweeping';

export default function LAStreetSweeping() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<LAStreetSweepingSchedule[]>([]);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSchedules([]);

    try {
      const response = await fetch(`/api/la-street-sweeping?address=${encodeURIComponent(address)}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || data.message || 'Failed to find address');
        return;
      }

      if (!data.schedules || data.schedules.length === 0) {
        setError('No street sweeping schedule found for this address. Los Angeles uses posted street sweeping routes. Your street may not be on a posted route.');
        return;
      }

      setSchedules(data.schedules);

    } catch (err) {
      console.error('Error searching address:', err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Los Angeles Street Sweeping Schedule | Autopilot America</title>
        <meta name="description" content="Check your street sweeping schedule in Los Angeles. Peace of Mind Parking starts here." />
      </Head>

      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '10px' }}>
          Los Angeles Street Sweeping
        </h1>
        <p style={{ fontSize: '16px', color: '#666', marginBottom: '30px' }}>
          Enter your address to find your street sweeping schedule and get reminders.
        </p>

        <form onSubmit={handleSearch} style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter your Los Angeles address"
              style={{
                flex: 1,
                padding: '12px 16px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '8px'
              }}
              required
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: '600',
                backgroundColor: loading ? '#ccc' : '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {error && (
          <div style={{
            padding: '16px',
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <p style={{ color: '#c00', margin: 0 }}>{error}</p>
          </div>
        )}

        {schedules.length > 0 && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '20px' }}>
              Street Sweeping Routes for Your Area
            </h2>

            <div style={{
              padding: '16px',
              backgroundColor: '#fff9e6',
              border: '1px solid #ffe066',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
                <strong>ℹ️ How LA Street Sweeping Works:</strong><br />
                Posted routes are swept on a biweekly basis - either the 1st & 3rd weeks OR the 2nd & 4th weeks of each month.
                Check the posted signs on your street for the exact schedule and side of street.
              </p>
            </div>

            {schedules.map((schedule, index) => (
              <div
                key={index}
                style={{
                  padding: '20px',
                  backgroundColor: '#f9f9f9',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  border: '1px solid #e0e0e0'
                }}
              >
                <div style={{ marginBottom: '12px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
                    Route {schedule.route_no}
                  </h3>
                  {schedule.day_of_week && (
                    <p style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#333' }}>
                      <strong>{getDayName(schedule.day_of_week)}s</strong> • {schedule.time_start} - {schedule.time_end}
                    </p>
                  )}
                  {!schedule.day_of_week && (
                    <p style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#333' }}>
                      <strong>Time:</strong> {schedule.time_start} - {schedule.time_end}
                    </p>
                  )}
                  <p style={{ margin: '0', fontSize: '14px', color: '#666' }}>
                    {schedule.boundaries}
                  </p>
                  {schedule.council_district && (
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#999' }}>
                      Council District {schedule.council_district}
                    </p>
                  )}
                </div>
              </div>
            ))}

            <div style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#f0f8ff',
              borderRadius: '8px',
              border: '1px solid #cce5ff'
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600' }}>
                Want Automatic Reminders?
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
                Sign up for free SMS and email reminders before every street cleaning day. Peace of Mind Parking!
              </p>
              <a
                href="/alerts/signup"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  backgroundColor: '#0052cc',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600'
                }}
              >
                Get Free Alerts
              </a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

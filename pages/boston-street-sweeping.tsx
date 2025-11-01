import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  BostonStreetSweepingSchedule,
  NextCleaningEvent,
  calculateNextCleaning,
  generateGoogleCalendarLink,
  formatNextCleaning,
  generateICSFile
} from '../lib/boston-street-sweeping';

export default function BostonStreetSweeping() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<BostonStreetSweepingSchedule[]>([]);
  const [nextCleanings, setNextCleanings] = useState<NextCleaningEvent[]>([]);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSchedules([]);
    setNextCleanings([]);

    try {
      const response = await fetch(`/api/boston-street-sweeping?address=${encodeURIComponent(address)}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to find address');
        return;
      }

      if (!data.schedules || data.schedules.length === 0) {
        setError('No street sweeping schedule found for this address. Make sure the address is in Boston.');
        return;
      }

      setSchedules(data.schedules);

      // Calculate next cleaning dates
      const nextEvents: NextCleaningEvent[] = [];
      for (const schedule of data.schedules) {
        const nextEvent = calculateNextCleaning(schedule);
        if (nextEvent) {
          nextEvents.push(nextEvent);
        }
      }

      // Sort by date
      nextEvents.sort((a, b) => a.date.getTime() - b.date.getTime());
      setNextCleanings(nextEvents);

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
        <title>Boston Street Sweeping Schedule | Autopilot America</title>
        <meta name="description" content="Check your street sweeping schedule in Boston and never get a ticket again." />
      </Head>

      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '10px' }}>
          Boston Street Sweeping
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
              placeholder="Enter your Boston address"
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

        {nextCleanings.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: '600', margin: 0 }}>
                Next Cleaning Dates
              </h2>
              <a
                href={generateICSFile(nextCleanings, address)}
                download={`boston-street-sweeping-${address.replace(/\s/g, '-')}.ics`}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#4285f4',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                📅 Download All Events
              </a>
            </div>

            {nextCleanings.map((event, index) => (
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
                      {formatNextCleaning(event)}
                      {event.side && (
                        <span style={{ fontSize: '14px', color: '#666', fontWeight: '400', marginLeft: '8px' }}>
                          ({event.side} side)
                        </span>
                      )}
                    </h3>
                    <p style={{ margin: '0', fontSize: '14px', color: '#666' }}>
                      📍 {event.streetName}
                    </p>
                  </div>
                  <a
                    href={generateGoogleCalendarLink(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#4285f4',
                      color: '#fff',
                      textDecoration: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '600',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Add to Calendar
                  </a>
                </div>
              </div>
            ))}

            <div style={{
              marginTop: '30px',
              padding: '20px',
              backgroundColor: '#f0f8ff',
              borderRadius: '8px',
              border: '1px solid #cce5ff'
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600' }}>
                🔔 Want Automatic Reminders?
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
                Sign up for free SMS and email reminders before every street cleaning day. Never get a $40 ticket again!
              </p>
              <a
                href="/signup"
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

        {schedules.length > 0 && nextCleanings.length === 0 && (
          <div style={{
            padding: '20px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px'
          }}>
            <p style={{ margin: 0, color: '#856404' }}>
              ℹ️ We found your street, but there are no upcoming cleaning dates this season. Boston street sweeping runs from April 1 to November 30.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

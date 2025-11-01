import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  SDStreetSweepingSchedule,
  NextCleaningEvent,
  calculateNextCleaning,
  generateGoogleCalendarLink,
  formatNextCleaning,
  generateICSFile
} from '../lib/sd-street-sweeping';

export default function SDStreetSweeping() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<SDStreetSweepingSchedule[]>([]);
  const [nextCleanings, setNextCleanings] = useState<NextCleaningEvent[]>([]);
  const [error, setError] = useState('');
  const [tripStartDate, setTripStartDate] = useState('');
  const [tripEndDate, setTripEndDate] = useState('');
  const [tripCleanings, setTripCleanings] = useState<NextCleaningEvent[]>([]);

  const handleTripCheck = () => {
    if (!tripStartDate || !tripEndDate) {
      return;
    }

    const start = new Date(tripStartDate);
    const end = new Date(tripEndDate);

    // Find all cleanings within the date range
    const cleaningsInRange: NextCleaningEvent[] = [];

    for (const schedule of schedules) {
      let checkDate = new Date(start);

      // Check every day in the range
      while (checkDate <= end) {
        const cleaning = calculateNextCleaning(schedule, checkDate);
        if (cleaning && cleaning.date >= start && cleaning.date <= end) {
          // Check if we already have this cleaning
          const exists = cleaningsInRange.some(c =>
            c.date.getTime() === cleaning.date.getTime() &&
            c.streetName === cleaning.streetName &&
            c.side === cleaning.side
          );
          if (!exists) {
            cleaningsInRange.push(cleaning);
          }
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
    }

    // Sort by date
    cleaningsInRange.sort((a, b) => a.date.getTime() - b.date.getTime());
    setTripCleanings(cleaningsInRange);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSchedules([]);
    setNextCleanings([]);
    setTripCleanings([]);

    try {
      const response = await fetch(`/api/sd-street-sweeping?address=${encodeURIComponent(address)}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to find address');
        return;
      }

      if (!data.schedules || data.schedules.length === 0) {
        setError('No street sweeping schedule found for this address. Make sure the address is in San Diego.');
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
        <title>San Diego Street Sweeping Schedule | Autopilot America</title>
        <meta name="description" content="Check your street sweeping schedule in San Diego and never get a ticket again." />
      </Head>

      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '10px' }}>
          San Diego Street Sweeping
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
              placeholder="Enter your San Diego address"
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
                download={`sd-street-sweeping-${address.replace(/\s/g, '-')}.ics`}
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
                Download all cleaning dates
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
              backgroundColor: '#fff9e6',
              borderRadius: '8px',
              border: '1px solid #ffe066'
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600' }}>
                ✈️ Going on a Trip?
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
                Check if there's street cleaning while you're away
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'end' }}>
                <div style={{ flex: '1', minWidth: '150px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={tripStartDate}
                    onChange={(e) => setTripStartDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div style={{ flex: '1', minWidth: '150px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px' }}>
                    End Date
                  </label>
                  <input
                    type="date"
                    value={tripEndDate}
                    onChange={(e) => setTripEndDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <button
                  onClick={handleTripCheck}
                  disabled={!tripStartDate || !tripEndDate}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: (!tripStartDate || !tripEndDate) ? '#ccc' : '#f59e0b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: (!tripStartDate || !tripEndDate) ? 'not-allowed' : 'pointer'
                  }}
                >
                  Check Dates
                </button>
              </div>

              {tripCleanings.length > 0 && (
                <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  backgroundColor: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '6px'
                }}>
                  <p style={{ margin: '0 0 12px 0', fontWeight: '600', color: '#c00' }}>
                    ⚠️ {tripCleanings.length} cleaning{tripCleanings.length > 1 ? 's' : ''} scheduled during your trip:
                  </p>
                  {tripCleanings.map((event, idx) => (
                    <div key={idx} style={{ marginBottom: idx < tripCleanings.length - 1 ? '8px' : '0' }}>
                      <p style={{ margin: '0', fontSize: '14px', color: '#333' }}>
                        • {formatNextCleaning(event)}
                        {event.side ? ` (${event.side} side)` : ''} - {event.streetName}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {tripStartDate && tripEndDate && tripCleanings.length === 0 && (
                <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  backgroundColor: '#efe',
                  border: '1px solid #cfc',
                  borderRadius: '6px'
                }}>
                  <p style={{ margin: '0', fontWeight: '600', color: '#060' }}>
                    ✅ No street cleaning during your trip - you're good to go!
                  </p>
                </div>
              )}
            </div>

            <div style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#f0f8ff',
              borderRadius: '8px',
              border: '1px solid #cce5ff'
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600' }}>
                🔔 Want Automatic Reminders?
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
                Sign up for free SMS and email reminders before every street cleaning day. Never get a ticket again!
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

        {schedules.length > 0 && nextCleanings.length === 0 && (
          <div style={{
            padding: '20px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px'
          }}>
            <p style={{ margin: 0, color: '#856404' }}>
              ℹ️ We found your street, but there are no upcoming cleaning dates soon. Check back later or sign up for automatic reminders.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

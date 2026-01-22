import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface Vehicle {
  license_plate: string;
  vehicle_type?: string;
  make?: string;
  model?: string;
  year?: string;
}

interface UpcomingCleaning {
  date: string;
  ward: string;
  section: string;
  time: string;
  daysUntil: number;
}

interface DashboardProps {
  user: any;
  profile: any;
}

// Icons
const Icons = {
  car: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  ),
  calendar: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  bell: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  ticket: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  ),
  plus: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  checkCircle: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  alertTriangle: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  arrowRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  dollarSign: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
};

export default function Dashboard({ user, profile }: DashboardProps) {
  const router = useRouter();
  const [upcomingCleanings, setUpcomingCleanings] = useState<UpcomingCleaning[]>([]);
  const [loadingCleanings, setLoadingCleanings] = useState(true);
  const [ticketsSaved, setTicketsSaved] = useState(0);

  // Extract vehicles from profile
  const vehicles: Vehicle[] = [];
  if (profile?.license_plate) {
    vehicles.push({
      license_plate: profile.license_plate,
      vehicle_type: profile.vehicle_type,
      make: profile.vehicle_make,
      model: profile.vehicle_model,
      year: profile.vehicle_year,
    });
  }
  if (profile?.second_license_plate) {
    vehicles.push({
      license_plate: profile.second_license_plate,
      vehicle_type: profile.second_vehicle_type,
    });
  }

  // Calculate protection stats
  const hasProtection = profile?.has_contesting || false;
  const memberSince = profile?.created_at ? new Date(profile.created_at) : null;
  const monthsActive = memberSince
    ? Math.floor((Date.now() - memberSince.getTime()) / (1000 * 60 * 60 * 24 * 30))
    : 0;

  // Estimate tickets saved (rough calculation based on average Chicago ticket rate)
  useEffect(() => {
    if (hasProtection && monthsActive > 0) {
      // Average Chicago driver gets ~2-3 street cleaning tickets per year
      // Protection helps avoid ~80% of those
      const estimatedTicketsSaved = Math.floor(monthsActive * 0.2); // ~2.4 per year / 12 months * 80%
      setTicketsSaved(estimatedTicketsSaved);
    }
  }, [hasProtection, monthsActive]);

  // Fetch upcoming cleaning dates
  useEffect(() => {
    async function fetchCleaningDates() {
      const ward = profile?.home_address_ward || profile?.ward;
      const section = profile?.home_address_section || profile?.section;

      if (!ward || !section) {
        setLoadingCleanings(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/get-cleaning-schedule?ward=${ward}&section=${section}`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.dates && data.dates.length > 0) {
            const now = new Date();
            const upcoming = data.dates
              .map((d: any) => ({
                date: d.date,
                ward: ward,
                section: section,
                time: d.time || '9:00 AM - 2:00 PM',
                daysUntil: Math.ceil((new Date(d.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
              }))
              .filter((d: UpcomingCleaning) => d.daysUntil >= 0 && d.daysUntil <= 14)
              .slice(0, 3);
            setUpcomingCleanings(upcoming);
          }
        }
      } catch (error) {
        console.error('Error fetching cleaning dates:', error);
      } finally {
        setLoadingCleanings(false);
      }
    }

    fetchCleaningDates();
  }, [profile?.home_address_ward, profile?.home_address_section, profile?.ward, profile?.section]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getUrgencyColor = (daysUntil: number) => {
    if (daysUntil <= 1) return COLORS.danger;
    if (daysUntil <= 3) return COLORS.warning;
    return COLORS.signal;
  };

  const getUrgencyBg = (daysUntil: number) => {
    if (daysUntil <= 1) return '#fef2f2';
    if (daysUntil <= 3) return '#fffbeb';
    return '#f0fdf4';
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Welcome Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{
          fontSize: '24px',
          fontWeight: '700',
          color: COLORS.graphite,
          margin: '0 0 4px 0',
          fontFamily: '"Space Grotesk", sans-serif',
          letterSpacing: '-0.5px',
        }}>
          Welcome back{profile?.first_name ? `, ${profile.first_name}` : ''}
        </h2>
        <p style={{ fontSize: '15px', color: COLORS.slate, margin: 0 }}>
          Here's what's happening with your vehicles
        </p>
      </div>

      {/* Stats Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        {/* Vehicle Info */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: `1px solid ${COLORS.border}`,
          padding: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: `${COLORS.regulatory}10`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.regulatory,
            }}>
              {Icons.car}
            </div>
            <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: '500' }}>Vehicle</span>
          </div>
          <p style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: 0 }}>
            {vehicles.length > 0 ? vehicles[0].license_plate : 'Not set'}
          </p>
        </div>

        {/* Protection Status */}
        <div style={{
          backgroundColor: hasProtection ? `${COLORS.signal}08` : 'white',
          borderRadius: '12px',
          border: `1px solid ${hasProtection ? `${COLORS.signal}30` : COLORS.border}`,
          padding: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: hasProtection ? `${COLORS.signal}15` : `${COLORS.slate}10`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: hasProtection ? COLORS.signal : COLORS.slate,
            }}>
              {Icons.shield}
            </div>
            <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: '500' }}>Protection</span>
          </div>
          <p style={{
            fontSize: '16px',
            fontWeight: '600',
            color: hasProtection ? COLORS.signal : COLORS.slate,
            margin: 0,
          }}>
            {hasProtection ? 'Active' : 'Not Active'}
          </p>
        </div>

        {/* Alerts Active */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: `1px solid ${COLORS.border}`,
          padding: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: `${COLORS.signal}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.signal,
            }}>
              {Icons.bell}
            </div>
            <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: '500' }}>Alerts</span>
          </div>
          <p style={{ fontSize: '16px', fontWeight: '600', color: COLORS.signal, margin: 0 }}>
            Active
          </p>
        </div>

        {/* Money Saved (only show if protection) */}
        {hasProtection && ticketsSaved > 0 && (
          <div style={{
            backgroundColor: `${COLORS.signal}08`,
            borderRadius: '12px',
            border: `1px solid ${COLORS.signal}30`,
            padding: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: `${COLORS.signal}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.signal,
              }}>
                {Icons.dollarSign}
              </div>
              <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: '500' }}>Est. Saved</span>
            </div>
            <p style={{ fontSize: '28px', fontWeight: '700', color: COLORS.signal, margin: 0 }}>
              ${ticketsSaved * 65}
            </p>
          </div>
        )}
      </div>

      {/* Upcoming Street Cleaning */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        border: `1px solid ${COLORS.border}`,
        padding: '20px',
        marginBottom: '20px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: `${COLORS.warning}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.warning,
            }}>
              {Icons.calendar}
            </div>
            <span style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite }}>
              Upcoming Street Cleaning
            </span>
          </div>
          <button
            onClick={() => {
              const ward = profile?.home_address_ward || profile?.ward;
              const section = profile?.home_address_section || profile?.section;
              if (ward && section) {
                router.push(`/check-your-street?ward=${ward}&section=${section}`);
              } else {
                router.push('/check-your-street');
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: COLORS.regulatory,
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            View Map {Icons.arrowRight}
          </button>
        </div>

        {loadingCleanings ? (
          <div style={{ padding: '20px', textAlign: 'center', color: COLORS.slate }}>
            Loading schedule...
          </div>
        ) : upcomingCleanings.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {upcomingCleanings.map((cleaning, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: getUrgencyBg(cleaning.daysUntil),
                  borderRadius: '10px',
                  border: `1px solid ${getUrgencyColor(cleaning.daysUntil)}20`,
                }}
              >
                <div>
                  <p style={{
                    fontSize: '15px',
                    fontWeight: '600',
                    color: COLORS.graphite,
                    margin: '0 0 2px 0',
                  }}>
                    {formatDate(cleaning.date)}
                  </p>
                  <p style={{ fontSize: '13px', color: COLORS.slate, margin: 0 }}>
                    {cleaning.time} - Ward {cleaning.ward}, Section {cleaning.section}
                  </p>
                </div>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: '100px',
                  fontSize: '12px',
                  fontWeight: '600',
                  color: getUrgencyColor(cleaning.daysUntil),
                  backgroundColor: 'white',
                  border: `1px solid ${getUrgencyColor(cleaning.daysUntil)}30`,
                }}>
                  {cleaning.daysUntil === 0 ? 'Today' :
                   cleaning.daysUntil === 1 ? 'Tomorrow' :
                   `${cleaning.daysUntil} days`}
                </span>
              </div>
            ))}
          </div>
        ) : (profile?.home_address_ward || profile?.ward) && (profile?.home_address_section || profile?.section) ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: COLORS.slate,
            backgroundColor: COLORS.concrete,
            borderRadius: '10px',
          }}>
            <span style={{ color: COLORS.signal }}>
              {Icons.checkCircle}
            </span>
            <p style={{ margin: '8px 0 0 0' }}>
              No street cleaning scheduled in the next 2 weeks
            </p>
          </div>
        ) : (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            backgroundColor: COLORS.concrete,
            borderRadius: '10px',
          }}>
            <p style={{ color: COLORS.slate, margin: '0 0 12px 0' }}>
              Add your address to see upcoming cleaning dates
            </p>
            <button
              onClick={() => document.getElementById('address-section')?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Add Address
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

// Quick Action Button
function QuickAction({
  icon,
  label,
  onClick,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '16px 12px',
        backgroundColor: highlight ? COLORS.regulatory : 'white',
        color: highlight ? 'white' : COLORS.graphite,
        border: `1px solid ${highlight ? COLORS.regulatory : COLORS.border}`,
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ color: highlight ? 'white' : COLORS.slate }}>{icon}</span>
      <span style={{ fontSize: '13px', fontWeight: '500' }}>{label}</span>
    </button>
  );
}

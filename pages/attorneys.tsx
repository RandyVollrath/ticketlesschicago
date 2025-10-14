import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

interface Attorney {
  id: string;
  full_name: string;
  law_firm: string | null;
  years_experience: number | null;
  win_rate: number | null;
  flat_fee_parking: number | null;
  average_rating: number | null;
  total_reviews: number;
  total_cases_handled: number;
  response_time_hours: number | null;
  specializations: string[];
  service_areas: string[];
  bio: string | null;
  badges: string[];
  relevant_expertise: any;
}

export default function Attorneys() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [attorneys, setAttorneys] = useState<Attorney[]>([]);
  const [selectedAttorney, setSelectedAttorney] = useState<Attorney | null>(null);
  const [showQuoteModal, setShowQuoteModal] = useState(false);

  // Filters
  const [violationCode, setViolationCode] = useState('');
  const [minWinRate, setMinWinRate] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('win_rate');

  useEffect(() => {
    checkAuthAndLoadAttorneys();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadAttorneys();
    }
  }, [violationCode, minWinRate, maxPrice, sortBy]);

  async function checkAuthAndLoadAttorneys() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/attorneys');
        return;
      }

      setUser(currentUser);
      await loadAttorneys();
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/attorneys');
    } finally {
      setLoading(false);
    }
  }

  async function loadAttorneys() {
    try {
      const params = new URLSearchParams();

      if (violationCode) params.append('violationCode', violationCode);
      if (minWinRate) params.append('minWinRate', minWinRate);
      if (maxPrice) params.append('maxPrice', maxPrice);
      params.append('sortBy', sortBy);

      const response = await fetch(`/api/attorneys/search?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        setAttorneys(result.attorneys);
      }
    } catch (error) {
      console.error('Error loading attorneys:', error);
    }
  }

  const getBadgeInfo = (badge: string) => {
    const badges: { [key: string]: { label: string; color: string } } = {
      verified: { label: '✓ Verified', color: '#10b981' },
      featured: { label: '⭐ Featured', color: '#f59e0b' },
      high_win_rate: { label: '🏆 High Win Rate', color: '#3b82f6' },
      highly_rated: { label: '⭐ Highly Rated', color: '#f59e0b' },
      fast_response: { label: '⚡ Fast Response', color: '#8b5cf6' },
      experienced: { label: '👨‍⚖️ Experienced', color: '#6b7280' }
    };

    return badges[badge] || { label: badge, color: '#6b7280' };
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6b7280' }}>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Find an Attorney - Ticketless America</title>
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000' }}>
              Ticketless
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: '#666',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            ← Back to Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '120px 16px 60px 16px'
      }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#111827',
            margin: '0 0 8px 0'
          }}>
            Attorney Marketplace
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
            Find experienced traffic attorneys to help contest your ticket
          </p>
        </div>

        {/* Filters */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Violation Code
              </label>
              <input
                type="text"
                value={violationCode}
                onChange={(e) => setViolationCode(e.target.value)}
                placeholder="e.g. 9-64-010"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Min Win Rate
              </label>
              <input
                type="number"
                value={minWinRate}
                onChange={(e) => setMinWinRate(e.target.value)}
                placeholder="e.g. 70"
                min="0"
                max="100"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Max Price
              </label>
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="e.g. 500"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              >
                <option value="win_rate">Win Rate</option>
                <option value="price">Price</option>
                <option value="rating">Rating</option>
                <option value="experience">Experience</option>
                {violationCode && <option value="relevance">Relevance</option>}
              </select>
            </div>
          </div>
        </div>

        {/* Attorney List */}
        {attorneys.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '48px 24px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>👨‍⚖️</div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
              No Attorneys Found
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
              Try adjusting your filters or search criteria
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {attorneys.map(attorney => (
              <div
                key={attorney.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  border: '1px solid #e5e7eb'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#111827', margin: 0 }}>
                        {attorney.full_name}
                      </h3>
                      {attorney.badges.map(badge => {
                        const badgeInfo = getBadgeInfo(badge);
                        return (
                          <span
                            key={badge}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: 'white',
                              backgroundColor: badgeInfo.color
                            }}
                          >
                            {badgeInfo.label}
                          </span>
                        );
                      })}
                    </div>

                    {attorney.law_firm && (
                      <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 12px 0' }}>
                        {attorney.law_firm}
                      </p>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', fontSize: '14px', marginBottom: '12px' }}>
                      {attorney.win_rate && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Win Rate: </span>
                          <strong style={{ color: '#10b981' }}>{attorney.win_rate}%</strong>
                        </div>
                      )}
                      {attorney.years_experience && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Experience: </span>
                          <strong>{attorney.years_experience} years</strong>
                        </div>
                      )}
                      {attorney.total_cases_handled > 0 && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Cases Handled: </span>
                          <strong>{attorney.total_cases_handled}</strong>
                        </div>
                      )}
                      {attorney.flat_fee_parking && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Parking Ticket Fee: </span>
                          <strong style={{ color: '#2563eb' }}>${attorney.flat_fee_parking}</strong>
                        </div>
                      )}
                      {attorney.average_rating && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Rating: </span>
                          <strong>{attorney.average_rating.toFixed(1)} ⭐ ({attorney.total_reviews} reviews)</strong>
                        </div>
                      )}
                      {attorney.response_time_hours && (
                        <div>
                          <span style={{ color: '#6b7280' }}>Response Time: </span>
                          <strong>{attorney.response_time_hours}h</strong>
                        </div>
                      )}
                    </div>

                    {attorney.bio && (
                      <p style={{ fontSize: '14px', color: '#374151', margin: '12px 0', lineHeight: '1.6' }}>
                        {attorney.bio.substring(0, 200)}{attorney.bio.length > 200 ? '...' : ''}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setSelectedAttorney(attorney);
                      setShowQuoteModal(true);
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#2563eb',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      marginLeft: '16px'
                    }}
                  >
                    Request Quote
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quote Request Modal */}
        {showQuoteModal && selectedAttorney && (
          <QuoteModal
            attorney={selectedAttorney}
            userId={user.id}
            onClose={() => {
              setShowQuoteModal(false);
              setSelectedAttorney(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

interface QuoteModalProps {
  attorney: Attorney;
  userId: string;
  onClose: () => void;
}

function QuoteModal({ attorney, userId, onClose }: QuoteModalProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    violationCode: '',
    ticketAmount: '',
    description: '',
    urgency: 'medium',
    preferredContact: 'email'
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessage('Please log in to continue');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/attorneys/request-quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          attorneyId: attorney.id,
          ...formData,
          ticketAmount: formData.ticketAmount ? parseFloat(formData.ticketAmount) : null
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send quote request');
      }

      setMessage('✅ Quote request sent! You should hear back within ' + (attorney.response_time_hours || 24) + ' hours.');

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: any) {
      console.error('Quote request error:', error);
      setMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', margin: '0 0 4px 0' }}>
              Request Quote
            </h2>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
              {attorney.full_name}{attorney.law_firm ? ` - ${attorney.law_firm}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280'
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Violation Code (Optional)
            </label>
            <input
              type="text"
              value={formData.violationCode}
              onChange={(e) => setFormData({ ...formData, violationCode: e.target.value })}
              placeholder="e.g. 9-64-010"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Ticket Amount (Optional)
            </label>
            <input
              type="number"
              value={formData.ticketAmount}
              onChange={(e) => setFormData({ ...formData, ticketAmount: e.target.value })}
              placeholder="e.g. 100"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Case Description *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              required
              placeholder="Describe your case and what help you need..."
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                resize: 'vertical'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Urgency *
            </label>
            <select
              value={formData.urgency}
              onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value="low">Low - No immediate deadline</option>
              <option value="medium">Medium - Within 2 weeks</option>
              <option value="high">High - Urgent, within days</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Preferred Contact Method *
            </label>
            <select
              value={formData.preferredContact}
              onChange={(e) => setFormData({ ...formData, preferredContact: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="both">Both</option>
            </select>
          </div>

          {message && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: message.includes('❌') ? '#fef2f2' : '#f0fdf4',
              color: message.includes('❌') ? '#dc2626' : '#166534',
              border: '1px solid',
              borderColor: message.includes('❌') ? '#fecaca' : '#bbf7d0',
              fontSize: '14px'
            }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: loading ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Sending...' : 'Send Quote Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

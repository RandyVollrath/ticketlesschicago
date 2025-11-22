import { useState } from 'react';
import Head from 'next/head';
import FOIATicketInsights from '../components/FOIATicketInsights';

/**
 * PUBLIC viral tool: Free ticket contest analyzer
 * No auth required - perfect for viral growth
 * Shows win rates from 1.2M FOIA records
 * Upsells to $3 letter download and $5 full submission
 */
export default function CheckTicket() {
  const [step, setStep] = useState<'entry' | 'analysis'>('entry');
  const [violationCode, setViolationCode] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [ticketAmount, setTicketAmount] = useState('');

  const handleAnalyze = () => {
    if (violationCode.trim()) {
      setStep('analysis');
      // TODO: Track analytics event here
    }
  };

  const handleReset = () => {
    setStep('entry');
    setViolationCode('');
    setTicketNumber('');
    setTicketAmount('');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Will Your Ticket Get Dismissed? Free Contest Analyzer | Ticketless Chicago</title>
        <meta name="description" content="Upload your Chicago parking ticket and instantly see your chances of winning. Based on 1.2M real contest outcomes. 100% free." />
      </Head>

      {/* Hero Section */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '60px 20px',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '42px', fontWeight: 'bold', marginBottom: '16px' }}>
            Will Your Ticket Get Dismissed?
          </h1>
          <p style={{ fontSize: '20px', opacity: 0.95, marginBottom: '12px' }}>
            Instantly see your chances based on 1.2 million real Chicago parking ticket contests
          </p>
          <p style={{ fontSize: '16px', opacity: 0.85 }}>
            100% Free • Takes 30 seconds • No signup required
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '900px', margin: '-40px auto 0', padding: '0 20px 60px' }}>

        {step === 'entry' && (
          <>
            {/* Social Proof Banner */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '32px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              textAlign: 'center'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#667eea' }}>1.2M+</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>Tickets Analyzed</div>
                </div>
                <div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#667eea' }}>75%</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>Average Win Rate</div>
                </div>
                <div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#667eea' }}>Free</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>No Credit Card</div>
                </div>
              </div>
            </div>

            {/* Entry Form */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '16px',
              padding: '40px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
            }}>
              <h2 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '8px', textAlign: 'center' }}>
                Enter Your Ticket Information
              </h2>
              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '32px', textAlign: 'center' }}>
                We'll instantly show you the historical dismissal rate for your violation type
              </p>

              {/* Violation Code Input */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
                  Violation Code *
                </label>
                <input
                  type="text"
                  value={violationCode}
                  onChange={(e) => setViolationCode(e.target.value.toUpperCase())}
                  placeholder="e.g., 0976160B"
                  style={{
                    width: '100%',
                    padding: '14px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    fontWeight: 'bold'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
                  Found on your ticket near the violation description. Usually 8 characters (letters and numbers).
                </p>
              </div>

              {/* Ticket Number Input (Optional) */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
                  Ticket Number (Optional)
                </label>
                <input
                  type="text"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.target.value)}
                  placeholder="e.g., 70234567"
                  style={{
                    width: '100%',
                    padding: '14px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Ticket Amount Input (Optional) */}
              <div style={{ marginBottom: '32px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
                  Ticket Amount (Optional)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '14px', top: '14px', fontSize: '16px', color: '#6b7280' }}>$</span>
                  <input
                    type="number"
                    value={ticketAmount}
                    onChange={(e) => setTicketAmount(e.target.value)}
                    placeholder="60.00"
                    step="0.01"
                    style={{
                      width: '100%',
                      padding: '14px 14px 14px 28px',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>

              {/* Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={!violationCode.trim()}
                style={{
                  width: '100%',
                  padding: '18px',
                  backgroundColor: violationCode.trim() ? '#667eea' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '18px',
                  fontWeight: '600',
                  cursor: violationCode.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  boxShadow: violationCode.trim() ? '0 4px 12px rgba(102, 126, 234, 0.4)' : 'none'
                }}
              >
                Analyze My Chances - Free
              </button>

              {/* Common Violations Quick Select */}
              <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#374151' }}>
                  Common Chicago Violations (Click to Select)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  {[
                    { code: '0976160B', name: 'Expired Plate' },
                    { code: '0964190A', name: 'Expired Meter' },
                    { code: '0964040B', name: 'Street Cleaning' },
                    { code: '0964125B', name: 'No City Sticker' },
                  ].map(({ code, name }) => (
                    <button
                      key={code}
                      onClick={() => setViolationCode(code)}
                      style={{
                        padding: '12px',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                        backgroundColor: violationCode === code ? '#eff6ff' : 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ fontWeight: '600', fontSize: '13px', color: '#374151' }}>{code}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{name}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* How It Works */}
            <div style={{ marginTop: '48px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '32px', color: '#374151' }}>
                How It Works
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px' }}>
                <div>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>📝</div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>1. Enter Ticket Info</h4>
                  <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                    Type in your violation code from your parking ticket
                  </p>
                </div>
                <div>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>2. See Your Chances</h4>
                  <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                    Instantly view historical dismissal rates from 1.2M real cases
                  </p>
                </div>
                <div>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>3. Get Help (Optional)</h4>
                  <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                    Download a pre-filled letter or let us submit for you
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {step === 'analysis' && (
          <>
            {/* Back Button */}
            <button
              onClick={handleReset}
              style={{
                marginBottom: '24px',
                padding: '12px 24px',
                backgroundColor: 'white',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                color: '#374151'
              }}
            >
              ← Analyze Another Ticket
            </button>

            {/* Ticket Summary */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#374151' }}>
                Your Ticket
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Violation Code</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', fontFamily: 'monospace', color: '#374151' }}>{violationCode}</div>
                </div>
                {ticketNumber && (
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Ticket Number</div>
                    <div style={{ fontSize: '16px', fontWeight: '600', fontFamily: 'monospace', color: '#374151' }}>{ticketNumber}</div>
                  </div>
                )}
                {ticketAmount && (
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Amount</div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151' }}>${ticketAmount}</div>
                  </div>
                )}
              </div>
            </div>

            {/* FOIA Insights */}
            <FOIATicketInsights violationCode={violationCode} />

            {/* Paid Tier CTAs */}
            <div style={{
              marginTop: '32px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px'
            }}>
              {/* $3 Letter Download */}
              <div style={{
                backgroundColor: '#fff',
                border: '3px solid #10b981',
                borderRadius: '16px',
                padding: '32px',
                textAlign: 'center',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  top: '-12px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: '#10b981',
                  color: 'white',
                  padding: '4px 16px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  MOST POPULAR
                </div>
                <div style={{ fontSize: '40px', marginBottom: '16px' }}>📄</div>
                <h3 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
                  Contest Letter
                </h3>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px' }}>
                  $3
                </div>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px', lineHeight: '1.6' }}>
                  Download a pre-filled professional contest letter with the best dismissal arguments based on historical data
                </p>
                <ul style={{ textAlign: 'left', fontSize: '14px', color: '#374151', marginBottom: '24px', lineHeight: '2', listStyle: 'none', padding: 0 }}>
                  <li>✅ Pre-filled with your ticket details</li>
                  <li>✅ Uses top dismissal reason from data</li>
                  <li>✅ Proper legal formatting</li>
                  <li>✅ Mailing instructions included</li>
                  <li>✅ Instant PDF download</li>
                </ul>
                <button
                  style={{
                    width: '100%',
                    padding: '16px',
                    backgroundColor: '#d1d5db',
                    color: '#6b7280',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'not-allowed'
                  }}
                >
                  Coming Soon
                </button>
              </div>

              {/* $5 Full Submission */}
              <div style={{
                backgroundColor: '#fff',
                border: '3px solid #667eea',
                borderRadius: '16px',
                padding: '32px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '40px', marginBottom: '16px' }}>🚀</div>
                <h3 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
                  Full Submission
                </h3>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#667eea', marginBottom: '8px' }}>
                  $5
                </div>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px', lineHeight: '1.6' }}>
                  We handle everything for you. Sit back and relax while we submit your contest
                </p>
                <ul style={{ textAlign: 'left', fontSize: '14px', color: '#374151', marginBottom: '24px', lineHeight: '2', listStyle: 'none', padding: 0 }}>
                  <li>✅ Everything in $3 tier</li>
                  <li>✅ We submit the contest for you</li>
                  <li>✅ Email confirmation + tracking</li>
                  <li>✅ Follow-up on outcome</li>
                  <li>✅ Zero effort on your part</li>
                </ul>
                <button
                  style={{
                    width: '100%',
                    padding: '16px',
                    backgroundColor: '#d1d5db',
                    color: '#6b7280',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'not-allowed'
                  }}
                >
                  Coming Soon
                </button>
              </div>
            </div>

            {/* Social Share */}
            <div style={{
              marginTop: '48px',
              padding: '32px',
              backgroundColor: '#f3f4f6',
              borderRadius: '12px',
              textAlign: 'center'
            }}>
              <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '12px', color: '#374151' }}>
                Help Others Save Money
              </h3>
              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '20px' }}>
                Share this free tool with friends who have parking tickets
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <a
                  href={`https://twitter.com/intent/tweet?text=I%20just%20checked%20my%20parking%20ticket%20-%20it%20has%20a%20${encodeURIComponent('75%')}%20chance%20of%20dismissal!%20Check%20yours%20for%20free&url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#1DA1F2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'inline-block'
                  }}
                >
                  Share on Twitter
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent('I just found out my parking ticket has a 75% chance of dismissal! Check yours for free: ' + (typeof window !== 'undefined' ? window.location.href : ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#25D366',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'inline-block'
                  }}
                >
                  Share on WhatsApp
                </a>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        backgroundColor: '#1f2937',
        color: 'white',
        padding: '40px 20px',
        textAlign: 'center'
      }}>
        <p style={{ fontSize: '14px', opacity: 0.8 }}>
          Data from 1.2M Chicago parking ticket contests (2019-present) via FOIA
        </p>
        <p style={{ fontSize: '12px', opacity: 0.6, marginTop: '8px' }}>
          This tool provides historical data only. Not legal advice. Past results don't guarantee future outcomes.
        </p>
      </div>
    </div>
  );
}

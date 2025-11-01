import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

interface ContestReason {
  reason: string;
  win_probability: number;
  evidence_needed: string;
  explanation: string;
}

interface ContestResult {
  violation_type: string;
  typical_fine: number;
  contest_difficulty: string;
  recommended_reason: ContestReason | null;
  all_reasons: ContestReason[];
  expected_savings: number;
  average_win_probability: string;
  recommendation: string;
}

export default function TicketContest() {
  const [violationDescription, setViolationDescription] = useState('');
  const [situationDescription, setSituationDescription] = useState('');
  const [result, setResult] = useState<ContestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const analyzeTicket = async () => {
    if (!violationDescription.trim()) {
      setError('Please describe your ticket');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/contest-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          violation_description: violationDescription,
          situation_description: situationDescription || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze ticket');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return '#10b981';
      case 'medium': return '#f59e0b';
      case 'hard': return '#dc2626';
      default: return '#6b7280';
    }
  };

  return (
    <>
      <Head>
        <title>Ticket Contest Assistant | Autopilot America</title>
        <meta name="description" content="AI-powered ticket contest advisor - find out if your parking ticket is worth fighting" />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', paddingBottom: '60px' }}>
        {/* Header */}
        <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '20px' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
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
              ⚖️ Ticket Contest Assistant
            </h1>
            <p style={{ margin: '10px 0 0 0', color: '#6b7280', fontSize: '16px' }}>
              AI-powered analysis to determine if your parking ticket is worth contesting
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ maxWidth: '900px', margin: '30px auto', padding: '0 20px' }}>
          {/* Input Form */}
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '30px'
          }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600', color: '#111827' }}>
              Tell us about your ticket
            </h2>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                Violation Type <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="e.g., Street cleaning, expired meter, no city sticker..."
                value={violationDescription}
                onChange={(e) => setViolationDescription(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                Your Situation (Optional)
              </label>
              <textarea
                placeholder="e.g., The street cleaning sign was covered by a tree branch..."
                value={situationDescription}
                onChange={(e) => setSituationDescription(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px',
                backgroundColor: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '14px',
                marginBottom: '20px'
              }}>
                {error}
              </div>
            )}

            <button
              onClick={analyzeTicket}
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: loading ? '#9ca3af' : '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Analyzing...' : 'Analyze Ticket'}
            </button>
          </div>

          {/* Results */}
          {result && (
            <>
              {/* Main Recommendation */}
              <div style={{
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                marginBottom: '20px',
                border: `3px solid ${result.recommendation.includes('STRONGLY') ? '#10b981' : result.recommendation.includes('RECOMMEND') ? '#f59e0b' : '#6b7280'}`
              }}>
                <h2 style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>
                  {result.violation_type}
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>TYPICAL FINE</p>
                    <p style={{ margin: '0', fontSize: '28px', fontWeight: 'bold', color: '#dc2626' }}>${result.typical_fine}</p>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>WIN PROBABILITY</p>
                    <p style={{ margin: '0', fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>{result.average_win_probability}</p>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>EXPECTED SAVINGS</p>
                    <p style={{ margin: '0', fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>${result.expected_savings}</p>
                  </div>
                </div>

                <div style={{
                  padding: '16px',
                  backgroundColor: result.recommendation.includes('STRONGLY') ? '#d1fae5' : result.recommendation.includes('RECOMMEND') ? '#fef3c7' : '#f3f4f6',
                  borderRadius: '8px',
                  marginBottom: '20px'
                }}>
                  <p style={{
                    margin: '0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: result.recommendation.includes('STRONGLY') ? '#065f46' : result.recommendation.includes('RECOMMEND') ? '#92400e' : '#374151'
                  }}>
                    {result.recommendation}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', color: '#6b7280' }}>Contest Difficulty:</span>
                  <span style={{
                    padding: '4px 12px',
                    backgroundColor: `${getDifficultyColor(result.contest_difficulty)}15`,
                    color: getDifficultyColor(result.contest_difficulty),
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: '600',
                    textTransform: 'uppercase'
                  }}>
                    {result.contest_difficulty}
                  </span>
                </div>
              </div>

              {/* Recommended Reason (if situation provided) */}
              {result.recommended_reason && (
                <div style={{
                  backgroundColor: 'white',
                  padding: '24px',
                  borderRadius: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  marginBottom: '20px',
                  border: '2px solid #3b82f6'
                }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                    🎯 Best Match for Your Situation
                  </h3>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <p style={{ margin: '0', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                      {result.recommended_reason.reason}
                    </p>
                    <span style={{
                      padding: '4px 12px',
                      backgroundColor: '#10b98115',
                      color: '#10b981',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontWeight: '600'
                    }}>
                      {(result.recommended_reason.win_probability * 100).toFixed(0)}% Win Rate
                    </span>
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#6b7280' }}>
                    {result.recommended_reason.explanation}
                  </p>
                  <div style={{ padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: '600', color: '#374151' }}>Evidence Needed:</p>
                    <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>{result.recommended_reason.evidence_needed}</p>
                  </div>
                </div>
              )}

              {/* All Contest Reasons */}
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                  All Contestable Reasons
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {result.all_reasons.map((reason, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px'
                      }}>
                        <p style={{ margin: '0', fontSize: '15px', fontWeight: '600', color: '#111827' }}>
                          {reason.reason}
                        </p>
                        <span style={{
                          padding: '3px 10px',
                          backgroundColor: reason.win_probability > 0.8 ? '#10b98115' : reason.win_probability > 0.6 ? '#f59e0b15' : '#6b728015',
                          color: reason.win_probability > 0.8 ? '#10b981' : reason.win_probability > 0.6 ? '#f59e0b' : '#6b7280',
                          borderRadius: '4px',
                          fontSize: '13px',
                          fontWeight: '600'
                        }}>
                          {(reason.win_probability * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#6b7280' }}>
                        {reason.explanation}
                      </p>
                      <p style={{ margin: '0', fontSize: '12px', color: '#9ca3af' }}>
                        <strong>Evidence needed:</strong> {reason.evidence_needed}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Footer />
    </>
  );
}

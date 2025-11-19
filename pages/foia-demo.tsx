import { useState } from 'react';
import Head from 'next/head';
import FOIATicketInsights from '../components/FOIATicketInsights';

/**
 * Public demo page to test FOIA integration
 * No auth required - for testing only
 */
export default function FOIADemo() {
  const [violationCode, setViolationCode] = useState('0976160B');

  const testCodes = [
    { code: '0976160B', name: 'Expired Plate', expectedWinRate: 'Real data' },
    { code: '0964190A', name: 'Expired Meter (Non-CBD)', expectedWinRate: 'Real data' },
    { code: '0964040B', name: 'Street Cleaning', expectedWinRate: 'Real data' },
    { code: '0964125B', name: 'No City Sticker', expectedWinRate: 'Real data' },
    { code: '9101020**', name: 'Speed Violation 11+', expectedWinRate: 'Real data' },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>FOIA Data Demo - Autopilot America</title>
        <meta name="description" content="Demo of FOIA contested ticket insights" />
      </Head>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '36px', fontWeight: 'bold', marginBottom: '12px' }}>
            🎯 FOIA Data Integration Demo
          </h1>
          <p style={{ fontSize: '18px', color: '#6b7280', marginBottom: '8px' }}>
            Testing 1.2M Chicago contested ticket records
          </p>
          <p style={{ fontSize: '14px', color: '#9ca3af', fontStyle: 'italic' }}>
            No login required - Public test page
          </p>
        </div>

        {/* Instructions */}
        <div style={{
          backgroundColor: '#eff6ff',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '32px'
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#1e40af', marginBottom: '16px' }}>
            📋 How to Test
          </h2>
          <ol style={{ color: '#1e3a8a', lineHeight: '1.8', marginLeft: '20px' }}>
            <li><strong>Click a violation code button below</strong> (or enter your own)</li>
            <li><strong>Look for the blue FOIA insights box</strong> to appear</li>
            <li><strong>Verify it shows:</strong>
              <ul style={{ marginTop: '8px', marginLeft: '20px' }}>
                <li>Win rate percentage (e.g., 57.2%)</li>
                <li>"Based on X real cases"</li>
                <li>Recommendation (green checkmark)</li>
                <li>Best contest method</li>
                <li>Top dismissal reasons</li>
              </ul>
            </li>
          </ol>
        </div>

        {/* Violation Code Selector */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e5e7eb',
          marginBottom: '32px'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Select Violation Code to Test
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            {testCodes.map(({ code, name, expectedWinRate }) => (
              <button
                key={code}
                onClick={() => setViolationCode(code)}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  border: violationCode === code ? '2px solid #3b82f6' : '2px solid #e5e7eb',
                  backgroundColor: violationCode === code ? '#eff6ff' : 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                  {code}
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                  {name}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
                  Expected: {expectedWinRate}
                </div>
              </button>
            ))}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>
              Or enter a violation code manually:
            </label>
            <input
              type="text"
              value={violationCode}
              onChange={(e) => setViolationCode(e.target.value.toUpperCase())}
              placeholder="e.g., 0976160B"
              style={{
                width: '100%',
                padding: '12px',
                border: '2px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '16px',
                fontFamily: 'monospace'
              }}
            />
          </div>
        </div>

        {/* FOIA Insights Component */}
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', textAlign: 'center' }}>
            ↓ FOIA Insights Should Appear Below ↓
          </h3>

          {violationCode ? (
            <FOIATicketInsights violationCode={violationCode} />
          ) : (
            <div style={{
              backgroundColor: '#fef3c7',
              border: '1px solid #fbbf24',
              borderRadius: '8px',
              padding: '16px',
              textAlign: 'center'
            }}>
              <p style={{ color: '#92400e' }}>
                Enter a violation code above to see insights
              </p>
            </div>
          )}
        </div>

        {/* Success Checklist */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            ✅ Success Checklist
          </h3>
          <div style={{ color: '#374151', lineHeight: '2' }}>
            <div>✅ Blue insights box appeared</div>
            <div>✅ Shows win rate percentage (e.g., 57.2%)</div>
            <div>✅ Shows "Based on X real cases"</div>
            <div>✅ Shows green recommendation badge</div>
            <div>✅ Shows best contest method (Mail vs In-Person)</div>
            <div>✅ Shows top 3 dismissal reasons</div>
            <div>✅ Shows data source "Chicago DOAH FOIA"</div>
          </div>
        </div>

        {/* What to Test */}
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: '8px',
          padding: '20px',
          marginTop: '24px'
        }}>
          <h4 style={{ fontSize: '16px', fontWeight: '600', color: '#166534', marginBottom: '12px' }}>
            🧪 Tests to Run
          </h4>
          <div style={{ color: '#166534', fontSize: '14px', lineHeight: '1.8' }}>
            <p><strong>Test 1:</strong> Code 0976160B → Shows win rate from ALL records for this violation</p>
            <p><strong>Test 2:</strong> Code 0964190A → Shows different win rate (different violation)</p>
            <p><strong>Test 3:</strong> Code FAKE123 → Should show "No data available"</p>
            <p><strong>Test 4:</strong> Switch between codes → Box should update with new data</p>
          </div>
        </div>

        {/* Debug Info */}
        <div style={{
          marginTop: '40px',
          padding: '16px',
          backgroundColor: '#f3f4f6',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          <strong>Debug Info:</strong>
          <div>Current violation code: <code>{violationCode || '(none)'}</code></div>
          <div>Component: FOIATicketInsights</div>
          <div>API endpoint: /api/foia/violation-stats-simple</div>
        </div>
      </div>
    </div>
  );
}

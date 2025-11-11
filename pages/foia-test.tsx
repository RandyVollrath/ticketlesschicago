import { useState } from 'react';
import FOIATicketInsights from '../components/FOIATicketInsights';

export default function FOIATestPage() {
  const [violationCode, setViolationCode] = useState('0976160B');

  // Common Chicago violation codes to test
  const testCodes = [
    { code: '0976160B', name: 'Expired Plate' },
    { code: '0964190A', name: 'Expired Meter (Non-CBD)' },
    { code: '0964190B', name: 'Expired Meter (CBD)' },
    { code: '0964040B', name: 'Street Cleaning' },
    { code: '0964125B', name: 'No City Sticker' },
    { code: '9101020**', name: 'Speed Violation 11+' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h1 className="text-3xl font-bold mb-2">FOIA Data Test Page</h1>
          <p className="text-gray-600 mb-6">
            Testing 1.2M contested ticket records from Chicago DOAH
          </p>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select a violation code to test:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {testCodes.map(({ code, name }) => (
                <button
                  key={code}
                  onClick={() => setViolationCode(code)}
                  className={`px-4 py-2 rounded border text-left ${
                    violationCode === code
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                  }`}
                >
                  <div className="font-medium">{code}</div>
                  <div className="text-xs opacity-75">{name}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or enter a violation code:
            </label>
            <input
              type="text"
              value={violationCode}
              onChange={(e) => setViolationCode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., 0976160B"
            />
          </div>
        </div>

        {/* The FOIA Insights Component */}
        <FOIATicketInsights violationCode={violationCode} />

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">What You're Seeing:</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Real win rates from 1,178,954 contested tickets (2019-present)</li>
            <li>Most common dismissal reasons for this violation</li>
            <li>Best contest method (Mail vs In-Person)</li>
            <li>Smart recommendation based on historical data</li>
            <li>No competitor has access to this data</li>
          </ul>
        </div>

        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold mb-4">API Response:</h3>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
            {`GET /api/foia/violation-stats-simple?violation_code=${violationCode}`}
          </pre>
          <p className="text-sm text-gray-600 mt-2">
            Open browser console to see full JSON response, or visit:{' '}
            <a
              href={`/api/foia/violation-stats-simple?violation_code=${violationCode}`}
              target="_blank"
              className="text-blue-600 hover:underline"
            >
              /api/foia/violation-stats-simple?violation_code={violationCode}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

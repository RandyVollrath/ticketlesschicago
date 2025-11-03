import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useRouter } from 'next/router';

export default function AddCourtOutcome() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [formData, setFormData] = useState({
    ticket_number: '',
    case_number: '',
    violation_code: '',
    violation_description: '',
    ticket_amount: '',
    ticket_location: '',
    ward: '',
    outcome: 'dismissed',
    contest_grounds: '',
    evidence_submitted: {
      photos: false,
      witnesses: false,
      documentation: false
    },
    ticket_date: '',
    hearing_date: '',
    notes: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      // Parse contest grounds (comma-separated)
      const groundsArray = formData.contest_grounds
        .split(',')
        .map(g => g.trim())
        .filter(g => g);

      // Calculate reduction percentage
      const originalAmount = parseFloat(formData.ticket_amount) || 0;
      const finalAmount = formData.outcome === 'dismissed' ? 0 : originalAmount;
      const reductionPct = formData.outcome === 'dismissed' ? 100 : 0;

      const outcome = {
        ticket_number: formData.ticket_number,
        case_number: formData.case_number,
        violation_code: formData.violation_code,
        violation_description: formData.violation_description,
        ticket_amount: originalAmount,
        ticket_location: formData.ticket_location,
        ward: formData.ward,
        outcome: formData.outcome,
        original_amount: originalAmount,
        final_amount: finalAmount,
        reduction_percentage: reductionPct,
        contest_grounds: groundsArray,
        evidence_submitted: formData.evidence_submitted,
        ticket_date: formData.ticket_date ? new Date(formData.ticket_date).toISOString() : null,
        hearing_date: formData.hearing_date ? new Date(formData.hearing_date).toISOString() : null,
        decision_date: new Date().toISOString(),
        data_source: 'manual_entry',
        verified: true,
        notes: formData.notes
      };

      const { error } = await supabase
        .from('court_case_outcomes')
        .insert(outcome);

      if (error) throw error;

      setMessage('✅ Court outcome added successfully!');

      // Reset form
      setFormData({
        ticket_number: '',
        case_number: '',
        violation_code: '',
        violation_description: '',
        ticket_amount: '',
        ticket_location: '',
        ward: '',
        outcome: 'dismissed',
        contest_grounds: '',
        evidence_submitted: {
          photos: false,
          witnesses: false,
          documentation: false
        },
        ticket_date: '',
        hearing_date: '',
        notes: ''
      });

      // Recalculate statistics
      await fetch('/api/admin/recalculate-win-rates', { method: 'POST' });

    } catch (error: any) {
      setMessage(`❌ Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow p-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Add Court Case Outcome</h1>
            <button
              onClick={() => router.push('/admin/contests')}
              className="text-blue-600 hover:text-blue-800"
            >
              ← Back to Admin
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
            <p className="text-sm text-blue-800">
              <strong>Purpose:</strong> Manually add successful (or unsuccessful) contest outcomes to improve letter quality.
              The system will use this data to generate better, evidence-based contest letters.
            </p>
          </div>

          {message && (
            <div className={`p-4 rounded mb-6 ${message.startsWith('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Ticket Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Ticket Number</label>
                  <input
                    type="text"
                    value={formData.ticket_number}
                    onChange={(e) => update('ticket_number', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="CHI123456"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Case/Docket Number</label>
                  <input
                    type="text"
                    value={formData.case_number}
                    onChange={(e) => update('case_number', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="24BT01234A"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Violation Code *</label>
                  <input
                    type="text"
                    value={formData.violation_code}
                    onChange={(e) => update('violation_code', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="9-64-010"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">e.g., 9-64-010 for street cleaning</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Ticket Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.ticket_amount}
                    onChange={(e) => update('ticket_amount', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="60.00"
                    required
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium mb-1">Violation Description</label>
                <input
                  type="text"
                  value={formData.violation_description}
                  onChange={(e) => update('violation_description', e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Street Cleaning Violation"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Location</label>
                  <input
                    type="text"
                    value={formData.ticket_location}
                    onChange={(e) => update('ticket_location', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="1500 N Clark St"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Ward</label>
                  <input
                    type="text"
                    value={formData.ward}
                    onChange={(e) => update('ward', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="43"
                  />
                </div>
              </div>
            </div>

            {/* Contest Details */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Contest Details</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Outcome *</label>
                <select
                  value={formData.outcome}
                  onChange={(e) => update('outcome', e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="dismissed">Dismissed (100% win)</option>
                  <option value="reduced">Reduced (partial win)</option>
                  <option value="upheld">Upheld (loss)</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Contest Grounds (comma-separated)</label>
                <textarea
                  value={formData.contest_grounds}
                  onChange={(e) => update('contest_grounds', e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="No visible signage, Street not actually cleaned, Vehicle moved before cleaning"
                />
                <p className="text-xs text-gray-500 mt-1">Separate multiple grounds with commas</p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Evidence Submitted</label>
                <div className="flex gap-6">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.evidence_submitted.photos}
                      onChange={(e) => update('evidence_submitted', { ...formData.evidence_submitted, photos: e.target.checked })}
                      className="mr-2"
                    />
                    Photos
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.evidence_submitted.witnesses}
                      onChange={(e) => update('evidence_submitted', { ...formData.evidence_submitted, witnesses: e.target.checked })}
                      className="mr-2"
                    />
                    Witnesses
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.evidence_submitted.documentation}
                      onChange={(e) => update('evidence_submitted', { ...formData.evidence_submitted, documentation: e.target.checked })}
                      className="mr-2"
                    />
                    Documentation
                  </label>
                </div>
              </div>
            </div>

            {/* Dates */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Dates</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Ticket Date</label>
                  <input
                    type="date"
                    value={formData.ticket_date}
                    onChange={(e) => update('ticket_date', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Hearing Date</label>
                  <input
                    type="date"
                    value={formData.hearing_date}
                    onChange={(e) => update('hearing_date', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">Notes (internal)</label>
              <textarea
                value={formData.notes}
                onChange={(e) => update('notes', e.target.value)}
                className="w-full border rounded px-3 py-2"
                rows={3}
                placeholder="Any additional context or details..."
              />
            </div>

            {/* Submit */}
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Add Court Outcome'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/admin/contests')}
                className="bg-gray-200 text-gray-800 px-6 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>

          <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-semibold text-yellow-900 mb-2">💡 Tips for Quality Data</h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Focus on successful contests (dismissed/reduced) - these improve letter quality the most</li>
              <li>• Be specific about contest grounds - exact wording helps</li>
              <li>• Note what evidence was submitted - photos vs witnesses vs documentation</li>
              <li>• Once you have 30+ cases for a violation code, statistics become reliable</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

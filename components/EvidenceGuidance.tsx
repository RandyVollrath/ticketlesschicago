import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import CameraTicketWarning from './CameraTicketWarning';
import { getOrdinanceByCode } from '../lib/chicago-ordinances';

interface EvidenceGuidanceProps {
  violationCode: string;
  fineAmount?: number;
  onEvidenceRecommendation?: (recommendations: EvidenceRecommendation[]) => void;
}

interface EvidenceRecommendation {
  type: 'sign_photos' | 'location_photos' | 'witness_statement' | 'permit' | 'receipt';
  label: string;
  description: string;
  successRateWith: number;
  successRateWithout: number;
  casesAnalyzed: number;
  priority: 'critical' | 'recommended' | 'optional';
  tips: string[];
}

// Type for court case outcomes from database view (not in generated types)
interface CourtCaseOutcome {
  violation_code: string;
  outcome: string;
  evidence_submitted?: {
    photos?: boolean;
    witnesses?: boolean;
    documentation?: boolean;
  };
  contest_ground?: string;
}

interface CourtDataResponse {
  hasData: boolean;
  stats: {
    win_rate: number;
    total_cases: number;
    dismissal_rate: number;
  };
  evidenceImpact: Array<{
    type: string;
    success_rate_with: number;
    success_rate_without: number;
    cases_with: number;
  }>;
  successfulGrounds: Array<{
    ground: string;
    success_rate: number;
    cases: number;
    required_evidence: string[];
  }>;
}

export default function EvidenceGuidance({ violationCode, fineAmount, onEvidenceRecommendation }: EvidenceGuidanceProps) {
  const [loading, setLoading] = useState(true);
  const [courtData, setCourtData] = useState<CourtDataResponse | null>(null);
  const [recommendations, setRecommendations] = useState<EvidenceRecommendation[]>([]);
  const [isCameraViolation, setIsCameraViolation] = useState(false);

  useEffect(() => {
    if (violationCode) {
      // Check if this is a camera violation
      const ordinance = getOrdinanceByCode(violationCode);
      const isCamera = ['9-102-020', '9-102-075', '9-102-076'].includes(violationCode);
      setIsCameraViolation(isCamera);

      loadCourtData();
    }
  }, [violationCode]);

  async function loadCourtData() {
    try {
      setLoading(true);

      // Get win rate statistics
      // @ts-expect-error - win_rate_statistics view not in generated types
      const { data: stats } = await supabase
        .from('win_rate_statistics')
        .select('*')
        .eq('stat_type', 'violation_code')
        .eq('stat_key', violationCode)
        .single() as { data: { win_rate: number; total_cases: number; dismissal_rate: number } | null };

      if (!stats) {
        setLoading(false);
        return;
      }

      // Get court outcomes to analyze evidence impact
      // @ts-expect-error - court_case_outcomes view not in generated types
      const { data: outcomes } = await supabase
        .from('court_case_outcomes')
        .select('*')
        .eq('violation_code', violationCode)
        .in('outcome', ['dismissed', 'reduced']) as { data: CourtCaseOutcome[] | null };

      if (!outcomes || outcomes.length === 0) {
        setLoading(false);
        return;
      }

      // Analyze evidence impact
      const evidenceImpact = analyzeEvidenceImpact(outcomes);

      // Get successful contest grounds
      const groundsAnalysis = analyzeContestGrounds(outcomes);

      const data: CourtDataResponse = {
        hasData: true,
        stats: {
          win_rate: stats.win_rate,
          total_cases: stats.total_cases,
          dismissal_rate: stats.dismissal_rate
        },
        evidenceImpact,
        successfulGrounds: groundsAnalysis
      };

      setCourtData(data);

      // Generate recommendations
      const recs = generateRecommendations(data);
      setRecommendations(recs);

      if (onEvidenceRecommendation) {
        onEvidenceRecommendation(recs);
      }

    } catch (error) {
      console.error('Error loading court data:', error);
    } finally {
      setLoading(false);
    }
  }

  function analyzeEvidenceImpact(cases: any[]) {
    const withPhotos = cases.filter(c => c.evidence_submitted?.photos);
    const withoutPhotos = cases.filter(c => !c.evidence_submitted?.photos);
    const withWitnesses = cases.filter(c => c.evidence_submitted?.witnesses);
    const withDocs = cases.filter(c => c.evidence_submitted?.documentation);

    return [
      {
        type: 'photos',
        success_rate_with: withPhotos.length > 0
          ? Math.round((withPhotos.filter(c => c.outcome === 'dismissed').length / withPhotos.length) * 100)
          : 0,
        success_rate_without: withoutPhotos.length > 0
          ? Math.round((withoutPhotos.filter(c => c.outcome === 'dismissed').length / withoutPhotos.length) * 100)
          : 0,
        cases_with: withPhotos.length
      },
      {
        type: 'witnesses',
        success_rate_with: withWitnesses.length > 0
          ? Math.round((withWitnesses.filter(c => c.outcome === 'dismissed').length / withWitnesses.length) * 100)
          : 0,
        cases_with: withWitnesses.length
      },
      {
        type: 'documentation',
        success_rate_with: withDocs.length > 0
          ? Math.round((withDocs.filter(c => c.outcome === 'dismissed').length / withDocs.length) * 100)
          : 0,
        cases_with: withDocs.length
      }
    ];
  }

  function analyzeContestGrounds(cases: any[]) {
    const groundsMap: Record<string, { success: number; total: number; evidence: string[] }> = {};

    cases.forEach(c => {
      if (c.contest_grounds && Array.isArray(c.contest_grounds)) {
        c.contest_grounds.forEach((ground: string) => {
          if (!groundsMap[ground]) {
            groundsMap[ground] = { success: 0, total: 0, evidence: [] };
          }
          groundsMap[ground].total++;
          if (c.outcome === 'dismissed') {
            groundsMap[ground].success++;
          }

          // Track evidence types used
          const evidence = c.evidence_submitted || {};
          if (evidence.photos) groundsMap[ground].evidence.push('photos');
          if (evidence.witnesses) groundsMap[ground].evidence.push('witnesses');
          if (evidence.documentation) groundsMap[ground].evidence.push('documentation');
        });
      }
    });

    return Object.entries(groundsMap)
      .map(([ground, data]) => ({
        ground,
        success_rate: Math.round((data.success / data.total) * 100),
        cases: data.total,
        required_evidence: [...new Set(data.evidence)]
      }))
      .filter(g => g.cases >= 3)
      .sort((a, b) => b.success_rate - a.success_rate);
  }

  function generateRecommendations(data: CourtDataResponse): EvidenceRecommendation[] {
    const recs: EvidenceRecommendation[] = [];

    // Photos recommendation
    const photoImpact = data.evidenceImpact.find(e => e.type === 'photos');
    if (photoImpact && photoImpact.cases_with >= 5) {
      const improvement = photoImpact.success_rate_with - photoImpact.success_rate_without;

      recs.push({
        type: 'sign_photos',
        label: 'Photos of Street Signs',
        description: 'Take clear photos of all street signs at the location',
        successRateWith: photoImpact.success_rate_with,
        successRateWithout: photoImpact.success_rate_without,
        casesAnalyzed: photoImpact.cases_with,
        priority: improvement >= 20 ? 'critical' : improvement >= 10 ? 'recommended' : 'optional',
        tips: [
          'Take photos even if a day late - still helps!',
          'Capture all visible signs within 50 feet',
          'Show obstructions (trees, poles) if applicable',
          'Include street name signs for context',
          'Take from driver\'s perspective'
        ]
      });

      recs.push({
        type: 'location_photos',
        label: 'Photos of the Actual Location',
        description: 'Document the street and surrounding area',
        successRateWith: photoImpact.success_rate_with,
        successRateWithout: photoImpact.success_rate_without,
        casesAnalyzed: photoImpact.cases_with,
        priority: improvement >= 15 ? 'recommended' : 'optional',
        tips: [
          'Show where your car was parked',
          'Include any relevant street markings',
          'Capture the full context of the area',
          'Timestamped photos are best (check phone metadata)'
        ]
      });
    }

    // Witness statement
    const witnessImpact = data.evidenceImpact.find(e => e.type === 'witnesses');
    if (witnessImpact && witnessImpact.cases_with >= 3) {
      recs.push({
        type: 'witness_statement',
        label: 'Witness Statement',
        description: 'Written statement from someone who can corroborate your account',
        successRateWith: witnessImpact.success_rate_with,
        successRateWithout: 0,
        casesAnalyzed: witnessImpact.cases_with,
        priority: witnessImpact.success_rate_with >= 70 ? 'recommended' : 'optional',
        tips: [
          'Must be from someone who was present',
          'Include their full name and contact info',
          'Have them describe what they witnessed',
          'Signed and dated statement works best'
        ]
      });
    }

    // Documentation
    const docImpact = data.evidenceImpact.find(e => e.type === 'documentation');
    if (docImpact && docImpact.cases_with >= 3) {
      recs.push({
        type: 'permit',
        label: 'Supporting Documentation',
        description: 'Permits, receipts, or other relevant documents',
        successRateWith: docImpact.success_rate_with,
        successRateWithout: 0,
        casesAnalyzed: docImpact.cases_with,
        priority: 'optional',
        tips: [
          'Parking permits if applicable',
          'Receipts showing you were elsewhere',
          'Repair/towing receipts if relevant',
          'Any official documents supporting your case'
        ]
      });
    }

    return recs;
  }

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span className="text-blue-800">Analyzing {courtData?.stats.total_cases || 'historical'} court cases...</span>
        </div>
      </div>
    );
  }

  if (!courtData || !courtData.hasData) {
    return (
      <div className="space-y-4">
        {/* Show camera warning even without court data */}
        {isCameraViolation && fineAmount && (
          <CameraTicketWarning
            violationCode={violationCode}
            fineAmount={fineAmount}
          />
        )}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <p className="text-gray-600">
            No historical data available for this violation type yet.
            We recommend gathering as much evidence as possible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Camera Ticket Warning - Show FIRST if this is a camera violation */}
      {isCameraViolation && fineAmount && (
        <CameraTicketWarning
          violationCode={violationCode}
          fineAmount={fineAmount}
        />
      )}
      {/* Low Win Rate Warning */}
      {courtData.stats.win_rate < 30 && !isCameraViolation && (
        <div className={`border-2 rounded-lg p-4 ${
          courtData.stats.win_rate < 15
            ? 'bg-red-50 border-red-400'
            : courtData.stats.win_rate < 20
            ? 'bg-orange-50 border-orange-400'
            : 'bg-yellow-50 border-yellow-400'
        }`}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h4 className={`font-bold mb-1 ${
                courtData.stats.win_rate < 15 ? 'text-red-900' : 'text-yellow-900'
              }`}>
                {courtData.stats.win_rate < 15
                  ? 'Very Low Success Rate'
                  : courtData.stats.win_rate < 20
                  ? 'Low Success Rate'
                  : 'Below Average Success Rate'
                }
              </h4>
              <p className={`text-sm ${
                courtData.stats.win_rate < 15 ? 'text-red-800' : 'text-yellow-800'
              }`}>
                Historical data shows only {courtData.stats.win_rate}% of similar cases succeed.
                {courtData.stats.win_rate < 15 && (
                  <span className="font-semibold"> Consider whether contesting is worth your time and effort.</span>
                )}
                {courtData.stats.win_rate >= 15 && courtData.stats.win_rate < 20 && (
                  <span> Make sure you have strong evidence before contesting.</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header with stats */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Evidence Recommendations
            </h3>
            <p className="text-sm text-gray-600">
              Based on analysis of {courtData.stats.total_cases} similar cases
            </p>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${
              courtData.stats.win_rate >= 50 ? 'text-green-600' :
              courtData.stats.win_rate >= 30 ? 'text-blue-600' :
              courtData.stats.win_rate >= 20 ? 'text-orange-600' :
              'text-red-600'
            }`}>
              {courtData.stats.win_rate}%
            </div>
            <div className="text-xs text-gray-600">Overall Win Rate</div>
            {courtData.stats.win_rate >= 50 && (
              <div className="text-xs text-green-600 font-medium mt-1">Strong chance ✓</div>
            )}
            {courtData.stats.win_rate < 30 && (
              <div className="text-xs text-red-600 font-medium mt-1">Difficult contest</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-blue-200">
          <div>
            <div className="text-sm text-gray-600">Dismissed</div>
            <div className="text-lg font-semibold text-green-600">
              {courtData.stats.dismissal_rate}%
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Cases Analyzed</div>
            <div className="text-lg font-semibold text-gray-900">
              {courtData.stats.total_cases}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Data Quality</div>
            <div className="text-lg font-semibold text-gray-900">
              {courtData.stats.total_cases >= 30 ? 'High' : courtData.stats.total_cases >= 10 ? 'Medium' : 'Low'}
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="space-y-3">
        {recommendations.map((rec, index) => (
          <div
            key={rec.type}
            className={`border-l-4 rounded-lg p-4 ${
              rec.priority === 'critical'
                ? 'bg-red-50 border-red-500'
                : rec.priority === 'recommended'
                ? 'bg-yellow-50 border-yellow-500'
                : 'bg-gray-50 border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-semibold text-gray-900">{rec.label}</h4>
                  {rec.priority === 'critical' && (
                    <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded">
                      CRITICAL
                    </span>
                  )}
                  {rec.priority === 'recommended' && (
                    <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded">
                      RECOMMENDED
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-3">{rec.description}</p>

                {/* Success rate comparison */}
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">With:</span>
                    <span className="font-semibold text-green-600">
                      {rec.successRateWith}%
                    </span>
                  </div>
                  {rec.successRateWithout > 0 && (
                    <>
                      <span className="text-gray-300">|</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Without:</span>
                        <span className="font-semibold text-red-600">
                          {rec.successRateWithout}%
                        </span>
                      </div>
                      <span className="text-gray-300">|</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Impact:</span>
                        <span className="font-semibold text-blue-600">
                          +{rec.successRateWith - rec.successRateWithout}%
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Tips */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                    Tips for collecting this evidence
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {rec.tips.map((tip, i) => (
                      <li key={i} className="text-gray-600">• {tip}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Most successful contest grounds */}
      {courtData.successfulGrounds.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-3">
            Most Successful Contest Arguments:
          </h4>
          <div className="space-y-2">
            {courtData.successfulGrounds.slice(0, 5).map((ground, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">"{ground.ground}"</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {ground.cases} cases
                  </span>
                  <span className="font-semibold text-green-600">
                    {ground.success_rate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isCameraViolation && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            <strong>💡 Pro Tip:</strong> Even if you're a day or two late, take photos anyway!
            Historical data shows that any photographic evidence significantly improves your chances.
          </p>
        </div>
      )}

      {isCameraViolation && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <p className="text-sm text-orange-900">
            <strong>⚠️ Camera Ticket Note:</strong> The evidence recommendations above are for
            regular parking/moving violations. Camera tickets require additional specialized
            evidence as detailed in the warning section above. Regular evidence alone rarely
            succeeds for camera violations.
          </p>
        </div>
      )}
    </div>
  );
}

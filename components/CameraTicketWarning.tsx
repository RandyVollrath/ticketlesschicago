import { useEffect, useState } from 'react';
import { getOrdinanceByCode } from '../lib/chicago-ordinances';

interface CameraTicketWarningProps {
  violationCode: string;
  fineAmount: number;
  onRecommendation?: (shouldContest: boolean, reason: string) => void;
}

interface CameraGuidance {
  isCameraViolation: boolean;
  winProbability: number;
  difficulty: 'very-hard' | 'hard' | 'medium' | 'easy';
  recommendContest: boolean;
  requiresAttorney: boolean;
  specializedEvidence: {
    type: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    howTo: string;
  }[];
  costBenefit: {
    fineAmount: number;
    estimatedTimeHours: number;
    estimatedCost: number;
    expectedValue: number;
  };
}

export default function CameraTicketWarning({
  violationCode,
  fineAmount,
  onRecommendation
}: CameraTicketWarningProps) {
  const [guidance, setGuidance] = useState<CameraGuidance | null>(null);

  useEffect(() => {
    analyzeViolation();
  }, [violationCode, fineAmount]);

  function analyzeViolation() {
    const ordinance = getOrdinanceByCode(violationCode);

    if (!ordinance) {
      setGuidance(null);
      return;
    }

    // Check if this is a camera violation
    const isCameraViolation = ['9-102-020', '9-102-075', '9-102-076'].includes(violationCode);

    if (!isCameraViolation) {
      setGuidance(null);
      return;
    }

    // Calculate specialized evidence requirements
    const specializedEvidence = [];

    if (violationCode === '9-102-020') {
      // Red Light Camera
      specializedEvidence.push(
        {
          type: 'Frame-by-Frame Video Analysis',
          description: 'Request video footage and analyze when vehicle entered intersection vs. light status',
          difficulty: 'hard' as const,
          howTo: 'FOIA request to City of Chicago for full video. Analyze frame-by-frame to prove yellow light entry.'
        },
        {
          type: 'Yellow Light Timing Calculation',
          description: 'Measure yellow light duration - must be 3.0-4.0 seconds minimum per federal standards',
          difficulty: 'hard' as const,
          howTo: 'Use video footage timestamp analysis. Calculate if light was too short (violation of standards).'
        },
        {
          type: 'Camera Calibration Records',
          description: 'Prove camera was not properly maintained or calibrated',
          difficulty: 'hard' as const,
          howTo: 'FOIA request for maintenance and calibration records for specific camera and date.'
        }
      );
    } else {
      // Speed Camera
      specializedEvidence.push(
        {
          type: 'Camera Calibration Records',
          description: 'Request calibration and maintenance records to challenge accuracy',
          difficulty: 'hard' as const,
          howTo: 'FOIA request to City of Chicago for camera ID and date. Look for missed calibrations.'
        },
        {
          type: 'Speedometer Calibration Certificate',
          description: 'Prove your speedometer was accurate and showed different speed',
          difficulty: 'medium' as const,
          howTo: 'Visit mechanic for speedometer calibration test. Get certificate showing accuracy.'
        },
        {
          type: 'Signage Documentation',
          description: 'Photograph all speed camera warning signs (or lack thereof)',
          difficulty: 'easy' as const,
          howTo: 'Visit location and photograph all signage. City must post clear warnings per ordinance.'
        },
        {
          type: 'School/Park Hours Documentation',
          description: 'Prove camera operated outside permitted hours (7am-7pm school days only)',
          difficulty: 'medium' as const,
          howTo: 'Check ticket time/date. Request school calendar. Prove violation was outside operating hours.'
        }
      );
    }

    // Calculate cost-benefit
    const estimatedTimeHours = violationCode === '9-102-020' ? 12 : 8; // Red light needs more work
    const estimatedCost = violationCode.includes('075') || violationCode.includes('076') ? 50 : 0;
    // Speed cameras may need speedometer calibration ($50), red light is just time
    const winProbability = ordinance.winProbability || 10;
    const expectedValue = (fineAmount * (winProbability / 100)) - estimatedCost;

    // Recommendation logic
    const requiresAttorney = fineAmount > 250 || violationCode === '9-102-020';
    const recommendContest = expectedValue > 0 || fineAmount > 200;

    const result: CameraGuidance = {
      isCameraViolation: true,
      winProbability,
      difficulty: winProbability < 15 ? 'very-hard' : 'hard',
      recommendContest,
      requiresAttorney,
      specializedEvidence,
      costBenefit: {
        fineAmount,
        estimatedTimeHours,
        estimatedCost,
        expectedValue
      }
    };

    setGuidance(result);

    if (onRecommendation) {
      let reason = '';
      if (!recommendContest) {
        reason = `Low expected value ($${expectedValue.toFixed(0)}). Contest costs more than likely savings.`;
      } else if (requiresAttorney) {
        reason = 'High fine amount justifies professional help. Camera cases are technical.';
      } else {
        reason = 'Worth contesting with proper evidence and documentation.';
      }
      onRecommendation(recommendContest, reason);
    }
  }

  if (!guidance || !guidance.isCameraViolation) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Critical Warning Banner */}
      <div className="bg-red-50 border-2 border-red-300 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="text-4xl">⚠️</div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-red-900 mb-2">
              Automated Camera Enforcement Violation
            </h3>
            <p className="text-red-800 mb-4">
              This is a camera ticket - significantly harder to contest than regular parking violations.
            </p>

            <div className="grid grid-cols-2 gap-4 bg-white rounded p-4 mb-4">
              <div>
                <div className="text-sm text-gray-600">Win Rate</div>
                <div className="text-2xl font-bold text-red-600">
                  {guidance.winProbability}%
                </div>
                <div className="text-xs text-gray-500">vs. 25-67% for parking</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Difficulty</div>
                <div className="text-xl font-bold text-orange-600 uppercase">
                  {guidance.difficulty.replace('-', ' ')}
                </div>
                <div className="text-xs text-gray-500">Requires specialized evidence</div>
              </div>
            </div>

            {/* Cost-Benefit Analysis */}
            <div className="bg-gray-50 rounded p-4 mb-4">
              <h4 className="font-semibold text-gray-900 mb-2">Cost-Benefit Analysis:</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Fine Amount:</span>
                  <span className="font-semibold">${guidance.costBenefit.fineAmount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Estimated Time to Contest:</span>
                  <span className="font-semibold">{guidance.costBenefit.estimatedTimeHours} hours</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Estimated Costs (calibration test, etc.):</span>
                  <span className="font-semibold">${guidance.costBenefit.estimatedCost}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Note: FOIA requests are free. Cost is for mechanic services if needed.
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-gray-900 font-semibold">Expected Value:</span>
                  <span className={`font-bold ${guidance.costBenefit.expectedValue > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${guidance.costBenefit.expectedValue.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            {guidance.recommendContest ? (
              <div className="bg-yellow-100 border border-yellow-300 rounded p-4">
                <p className="text-yellow-900 font-semibold mb-2">
                  ✓ Worth Contesting
                </p>
                {guidance.requiresAttorney && (
                  <p className="text-yellow-800 text-sm mb-2">
                    <strong>⚖️ Attorney Recommended:</strong> Camera cases are highly technical.
                    An experienced traffic attorney knows the defenses and can handle FOIA requests.
                    Cost: $200-400 typically.
                  </p>
                )}
                <p className="text-yellow-800 text-sm">
                  While camera tickets are difficult, the fine amount ({guidance.costBenefit.fineAmount})
                  and {guidance.winProbability}% success rate make this worth attempting with proper evidence.
                </p>
              </div>
            ) : (
              <div className="bg-red-100 border border-red-300 rounded p-4">
                <p className="text-red-900 font-semibold mb-2">
                  ⚠️ Consider Just Paying
                </p>
                <p className="text-red-800 text-sm">
                  Based on the fine amount (${guidance.costBenefit.fineAmount}), time required
                  ({guidance.costBenefit.estimatedTimeHours} hrs), and low win rate ({guidance.winProbability}%),
                  the expected value is negative (${guidance.costBenefit.expectedValue.toFixed(0)}).
                </p>
                <p className="text-red-800 text-sm mt-2">
                  <strong>It may cost you more to contest than to just pay the fine.</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Specialized Evidence Requirements */}
      {guidance.recommendContest && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Required Specialized Evidence
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Camera tickets require technical evidence most people don't have.
            Here's what you need to have a realistic chance:
          </p>

          <div className="space-y-4">
            {guidance.specializedEvidence.map((evidence, index) => (
              <div
                key={index}
                className={`border-l-4 rounded p-4 ${
                  evidence.difficulty === 'hard'
                    ? 'bg-red-50 border-red-500'
                    : evidence.difficulty === 'medium'
                    ? 'bg-yellow-50 border-yellow-500'
                    : 'bg-green-50 border-green-500'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-gray-900">{evidence.type}</h4>
                  <span className={`text-xs px-2 py-1 rounded ${
                    evidence.difficulty === 'hard'
                      ? 'bg-red-600 text-white'
                      : evidence.difficulty === 'medium'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-green-600 text-white'
                  }`}>
                    {evidence.difficulty.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-2">{evidence.description}</p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                    How to obtain this evidence
                  </summary>
                  <p className="mt-2 text-gray-600 bg-white p-3 rounded">
                    {evidence.howTo}
                  </p>
                </details>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-blue-100 border border-blue-300 rounded p-4">
            <p className="text-sm text-blue-900">
              <strong>💡 Reality Check:</strong> FOIA requests take 3-7 business days minimum.
              Frame-by-frame video analysis requires careful examination. Yellow light timing
              calculations need precise measurements. This is why camera tickets have such low win rates.
            </p>
          </div>
        </div>
      )}

      {/* When to Hire Attorney */}
      {guidance.requiresAttorney && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            ⚖️ Consider Hiring a Traffic Attorney
          </h3>
          <div className="space-y-2 text-sm text-gray-700">
            <p><strong>Why attorneys help with camera tickets:</strong></p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Know exactly what FOIA requests to file</li>
              <li>Can spot camera calibration issues professionals miss</li>
              <li>Understand yellow light timing calculations</li>
              <li>Have relationships with hearing officers</li>
              <li>Handle all paperwork and deadlines</li>
            </ul>
            <p className="mt-3">
              <strong>Typical cost:</strong> $200-400 for camera ticket defense<br/>
              <strong>For your ${guidance.costBenefit.fineAmount} fine:</strong> {
                guidance.costBenefit.fineAmount > 250
                  ? 'Strongly recommended - fine is high enough to justify'
                  : 'Optional but may improve your chances significantly'
              }
            </p>
          </div>
        </div>
      )}

      {/* Common Mistakes */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          ❌ Common Mistakes That Fail
        </h3>
        <div className="space-y-2 text-sm text-gray-700">
          <div><strong>"I didn't get enough notice"</strong> - Rarely works, city just needs to mail ticket</div>
          <div><strong>"Someone else was driving"</strong> - Vehicle owner is liable regardless of driver</div>
          <div><strong>"The photo is blurry"</strong> - Only matters if license plate is illegible</div>
          <div><strong>"I was in a hurry"</strong> - Not a valid legal defense</div>
          <div><strong>"First offense"</strong> - Not relevant to camera violations</div>
        </div>
        <p className="mt-3 text-orange-900 font-medium">
          Camera tickets only get dismissed for technical defects (calibration, signage, timing)
          or proof vehicle was stolen.
        </p>
      </div>
    </div>
  );
}

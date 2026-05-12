import { NextApiRequest, NextApiResponse } from 'next';
import { getOrdinanceByCode, getAverageWinProbability } from '../../../lib/chicago-ordinances';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Calculate win probability for contesting a ticket
 *
 * Factors considered:
 * - Base probability from historical data for violation type
 * - Quality and quantity of evidence
 * - Contest grounds selected
 * - Time since ticket issued
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      violationCode,
      contestGrounds,
      hasPhotos,
      hasWitnesses,
      hasDocumentation,
      daysSinceTicket
    } = req.body;

    // Get base probability from ordinance database
    const ordinance = violationCode ? getOrdinanceByCode(violationCode) : null;
    let baseProbability = ordinance?.winProbability || getAverageWinProbability();

    // Calculate modifiers
    let probability = baseProbability;

    // Evidence modifiers
    if (hasPhotos) {
      probability += 10; // Photos significantly increase win rate
    }

    if (hasWitnesses) {
      probability += 8; // Witnesses help
    }

    if (hasDocumentation) {
      probability += 7; // Official documentation is valuable
    }

    // Contest grounds modifiers
    const numGrounds = contestGrounds?.length || 0;
    if (numGrounds === 0) {
      probability -= 15; // No grounds significantly hurts chances
    } else if (numGrounds >= 3) {
      probability += 5; // Multiple grounds show thoroughness
    }

    // Time factor - fresher contests have slightly better odds
    if (daysSinceTicket !== undefined) {
      if (daysSinceTicket <= 7) {
        probability += 3; // Recent contest
      } else if (daysSinceTicket > 60) {
        probability -= 5; // Older tickets are harder to contest
      }
    }

    // Stolen-plate on a camera/missing-plate ticket is the single strongest
    // defense — § 9-102-050(c) dismisses the overwhelming majority. Worth far
    // more than the +12 a generic strong ground gets.
    const stolenPlateGround = contestGrounds?.some((g: string) =>
      /plate.*stolen|stolen.*plate|lost.*or used without/i.test(g)
    );
    const isCameraOrPlateCode =
      violationCode === '9-102-010' ||
      violationCode === '9-102-020' ||
      violationCode === '9-101-020' ||
      violationCode === '9-80-040';
    if (stolenPlateGround && isCameraOrPlateCode) {
      probability += 40; // case-dispositive defense
    }

    // Other strong codified-defense grounds (matches the new UI labels).
    // Substring matches keep this resilient to small wording tweaks.
    const strongGroundPatterns = [
      /signs?\s+(were|are)\s+missing|missing\s+or\s+obscured|obscured\s+(by\s+|or\s+missing)/i,
      /facts\s+alleged.*inconsistent|factual(ly)?\s+inconsistent/i,
      /affirmative\s+compliance/i,
      /not\s+the\s+owner\s+or\s+lessee/i,
      /sold\s+or\s+transferred\s+before/i,
      /valid\s+permit\s+was\s+displayed/i,
      /vehicle\s+was\s+moved\s+before/i,
      /meter\s+was\s+malfunction/i,
      /issued\s+in\s+error/i,
      /street\s+cleaning\s+did\s+not\s+actually\s+occur/i,
    ];
    const hasStrongGround = contestGrounds?.some((g: string) =>
      strongGroundPatterns.some(re => re.test(g))
    );
    if (hasStrongGround && !stolenPlateGround) {
      probability += 12; // Strong legal grounds
    }

    // Cap probability between 5% and 95%
    probability = Math.max(5, Math.min(95, probability));

    // Generate recommendation
    let recommendation = '';
    let recommendationColor = '';

    if (probability >= 70) {
      recommendation = 'Strong Case - High likelihood of success. Contest recommended.';
      recommendationColor = '#10b981'; // green
    } else if (probability >= 50) {
      recommendation = 'Moderate Case - Reasonable chance of success. Contest may be worthwhile.';
      recommendationColor = '#f59e0b'; // amber
    } else if (probability >= 30) {
      recommendation = 'Weak Case - Lower probability of success. Consider if ticket amount justifies effort.';
      recommendationColor = '#ef4444'; // red
    } else {
      recommendation = 'Very Weak Case - Low probability of success. May not be worth contesting unless high-value ticket.';
      recommendationColor = '#dc2626'; // dark red
    }

    // Generate improvement suggestions
    const suggestions = [];

    if (!hasPhotos) {
      suggestions.push('Add photographic evidence of the location, signage, and circumstances');
    }

    if (!hasWitnesses && probability < 60) {
      suggestions.push('Gather witness statements if available');
    }

    if (!hasDocumentation) {
      suggestions.push('Obtain any relevant official documentation (permits, receipts, police reports)');
    }

    if (numGrounds < 2) {
      suggestions.push('Consider additional contest grounds that may apply');
    }

    if (daysSinceTicket && daysSinceTicket > 30) {
      suggestions.push('Contest as soon as possible - fresher cases have better outcomes');
    }

    res.status(200).json({
      success: true,
      probability: Math.round(probability),
      baseProbability: Math.round(baseProbability),
      recommendation,
      recommendationColor,
      suggestions,
      breakdown: {
        base: Math.round(baseProbability),
        photoBoost: hasPhotos ? 10 : 0,
        witnessBoost: hasWitnesses ? 8 : 0,
        documentationBoost: hasDocumentation ? 7 : 0,
        groundsBoost: numGrounds >= 3 ? 5 : 0,
        stolenPlateBoost: stolenPlateGround && isCameraOrPlateCode ? 40 : 0,
        strongGroundBoost: hasStrongGround && !stolenPlateGround ? 12 : 0,
        timeModifier: daysSinceTicket && daysSinceTicket <= 7 ? 3 : (daysSinceTicket && daysSinceTicket > 60 ? -5 : 0)
      },
      ordinanceInfo: ordinance ? {
        code: ordinance.code,
        title: ordinance.title,
        category: ordinance.category
      } : null
    });

  } catch (error: any) {
    console.error('Win probability error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

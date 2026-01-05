// Neighborhood scoring algorithm
// Shared between frontend display and PDF generation

// Scoring weights for each category
export const SCORING_WEIGHTS = {
  crime: { weight: 0.30, label: 'Crime', negative: true, description: 'Violent and property crimes in the area' },
  crashes: { weight: 0.15, label: 'Traffic Safety', negative: true, description: 'Vehicle crashes and pedestrian safety' },
  violations: { weight: 0.15, label: 'Building Violations', negative: true, description: 'Code violations and property maintenance' },
  serviceRequests: { weight: 0.10, label: '311 Requests', negative: true, description: 'Infrastructure and sanitation issues' },
  cameras: { weight: 0.10, label: 'Enforcement Cameras', negative: true, description: 'Speed and red light cameras' },
  potholes: { weight: 0.05, label: 'Road Condition', negative: true, description: 'Pothole repairs needed' },
  permits: { weight: 0.075, label: 'Building Permits', negative: false, description: 'Investment and development activity' },
  licenses: { weight: 0.075, label: 'Business Activity', negative: false, description: 'Commercial vitality and services' },
};

// Chicago-wide averages per 0.1 mile radius for 12-MONTH period
// Based on analysis of typical Chicago neighborhoods
export const CHICAGO_AVERAGES = {
  crime: 25,          // crimes per year in 0.1mi radius (dense urban area)
  crashes: 15,        // crashes per year (busy streets)
  violations: 20,     // building violations per year (active enforcement)
  serviceRequests: 30, // 311 requests per year (engaged residents)
  cameras: 0.5,       // cameras nearby (not time-based)
  potholes: 8,        // pothole repairs per year
  permits: 10,        // building permits per year (healthy investment)
  licenses: 50,       // active business licenses (commercial area)
};

export interface CategoryScore {
  key: string;
  label: string;
  weight: number;
  rawValue: number;
  normalizedScore: number;
  weightedScore: number;
  grade: string;
  isPositive: boolean;
  description: string;
}

export interface ReportData {
  address: string;
  latitude: number;
  longitude: number;
  radius: number;
  crime: { total: number; violent: number; property: number };
  crashes: { total: number; injuries: number; fatal: number; hitAndRun: number };
  violations: { total: number; highRisk: number; open: number };
  serviceRequests: { total: number; recent: number };
  cameras: { total: number; speed: number; redLight: number };
  potholes: { total: number; filled: number };
  permits: { total: number; recent: number; cost: number };
  licenses: { total: number; active: number };
}

export function calculateCategoryScore(
  key: string,
  value: number,
  config: typeof SCORING_WEIGHTS[keyof typeof SCORING_WEIGHTS],
  average: number
): CategoryScore {
  // Normalize using a logarithmic scale for negative factors to prevent
  // extreme values from completely dominating the score.
  // Urban areas with high activity shouldn't be overly penalized.
  let normalizedScore: number;

  if (config.negative) {
    // Lower is better for negative factors
    // Use log scale to dampen the effect of very high values
    if (value <= average * 0.5) {
      normalizedScore = 100;
    } else if (value <= average) {
      // Between 50% and 100% of average = score 80-100
      normalizedScore = 80 + 20 * (1 - (value - average * 0.5) / (average * 0.5));
    } else if (value <= average * 2) {
      // 100% to 200% of average = score 60-80
      normalizedScore = 60 + 20 * (1 - (value - average) / average);
    } else if (value <= average * 5) {
      // 200% to 500% of average = score 40-60 (log dampening)
      const ratio = (value - average * 2) / (average * 3);
      normalizedScore = 60 - 20 * Math.min(1, ratio);
    } else {
      // Over 5x average = score 20-40 (severe but capped)
      const ratio = Math.min(1, (value - average * 5) / (average * 10));
      normalizedScore = 40 - 20 * ratio;
    }
    // Never go below 20 - no neighborhood is truly hopeless
    normalizedScore = Math.max(20, normalizedScore);
  } else {
    // Higher is better for positive factors
    if (value >= average * 3) {
      normalizedScore = 100;
    } else if (value >= average * 1.5) {
      normalizedScore = 90 + 10 * ((value - average * 1.5) / (average * 1.5));
    } else if (value >= average) {
      normalizedScore = 70 + 20 * ((value - average) / (average * 0.5));
    } else if (value > 0) {
      normalizedScore = 50 + 20 * (value / average);
    } else {
      normalizedScore = 40; // Some baseline even with no activity
    }
  }

  const weightedScore = normalizedScore * config.weight;
  const grade = getLetterGrade(normalizedScore);

  return {
    key,
    label: config.label,
    weight: config.weight,
    rawValue: value,
    normalizedScore: Math.round(normalizedScore),
    weightedScore: Math.round(weightedScore * 10) / 10,
    grade,
    isPositive: !config.negative,
    description: config.description,
  };
}

export function getLetterGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#22c55e'; // green
    case 'B': return '#84cc16'; // lime
    case 'C': return '#eab308'; // yellow
    case 'D': return '#f97316'; // orange
    case 'F': return '#ef4444'; // red
    default: return '#6b7280';
  }
}

export function getScoreDescription(score: number): string {
  if (score >= 90) {
    return 'Excellent neighborhood with very low crime, well-maintained infrastructure, and thriving business activity.';
  } else if (score >= 80) {
    return 'Good neighborhood with below-average safety concerns and positive development indicators.';
  } else if (score >= 70) {
    return 'Average neighborhood typical of Chicago, with some areas for improvement.';
  } else if (score >= 60) {
    return 'Below-average area with elevated safety concerns. Exercise increased awareness.';
  } else {
    return 'Area with significant safety and infrastructure concerns. Consider carefully before relocating.';
  }
}

export interface NeighborhoodScoreResult {
  overallScore: number;
  overallGrade: string;
  categoryScores: CategoryScore[];
}

export function calculateOverallScore(data: {
  crime: number;
  crashes: number;
  violations: number;
  serviceRequests: number;
  cameras: number;
  potholes: number;
  permits: number;
  licenses: number;
}): NeighborhoodScoreResult {
  const categoryScores: CategoryScore[] = [
    calculateCategoryScore('crime', data.crime, SCORING_WEIGHTS.crime, CHICAGO_AVERAGES.crime),
    calculateCategoryScore('crashes', data.crashes, SCORING_WEIGHTS.crashes, CHICAGO_AVERAGES.crashes),
    calculateCategoryScore('violations', data.violations, SCORING_WEIGHTS.violations, CHICAGO_AVERAGES.violations),
    calculateCategoryScore('serviceRequests', data.serviceRequests, SCORING_WEIGHTS.serviceRequests, CHICAGO_AVERAGES.serviceRequests),
    calculateCategoryScore('cameras', data.cameras, SCORING_WEIGHTS.cameras, CHICAGO_AVERAGES.cameras),
    calculateCategoryScore('potholes', data.potholes, SCORING_WEIGHTS.potholes, CHICAGO_AVERAGES.potholes),
    calculateCategoryScore('permits', data.permits, SCORING_WEIGHTS.permits, CHICAGO_AVERAGES.permits),
    calculateCategoryScore('licenses', data.licenses, SCORING_WEIGHTS.licenses, CHICAGO_AVERAGES.licenses),
  ];

  const overallScore = Math.round(categoryScores.reduce((sum, cat) => sum + cat.weightedScore, 0));
  const overallGrade = getLetterGrade(overallScore);

  return { overallScore, overallGrade, categoryScores };
}

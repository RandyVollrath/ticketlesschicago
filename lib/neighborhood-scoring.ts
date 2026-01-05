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

// Chicago-wide averages per 0.1 mile radius (approximate, based on city data)
export const CHICAGO_AVERAGES = {
  crime: 15,          // crimes per year in 0.1mi radius
  crashes: 8,         // crashes per year
  violations: 25,     // building violations per year
  serviceRequests: 40, // 311 requests per year
  cameras: 0.5,       // cameras nearby
  potholes: 10,       // pothole repairs
  permits: 8,         // building permits
  licenses: 12,       // business licenses
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
  // Normalize: 100 = at or below average, 0 = 3x average or worse
  // For positive factors, invert the logic
  let normalizedScore: number;

  if (config.negative) {
    // Lower is better for negative factors
    if (value <= average * 0.5) {
      normalizedScore = 100;
    } else if (value >= average * 3) {
      normalizedScore = 0;
    } else {
      // Linear interpolation
      normalizedScore = Math.max(0, Math.min(100, 100 - ((value - average * 0.5) / (average * 2.5)) * 100));
    }
  } else {
    // Higher is better for positive factors
    if (value >= average * 2) {
      normalizedScore = 100;
    } else if (value <= 0) {
      normalizedScore = 50; // Some activity is baseline
    } else {
      normalizedScore = Math.min(100, 50 + (value / average) * 25);
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

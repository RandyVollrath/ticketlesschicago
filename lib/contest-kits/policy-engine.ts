/**
 * Contest Policy Engine
 *
 * Evaluates a ticket against its contest kit to:
 * 1. Check eligibility
 * 2. Fetch weather data if relevant
 * 3. Select the best argument based on available evidence
 * 4. Calculate win probability
 * 5. Generate the filled argument text
 */

import {
  ContestKit,
  ContestEvaluation,
  TicketFacts,
  UserEvidence,
  ArgumentTemplate,
  EvidenceItem,
  ArgumentCondition,
} from './types';
import { getContestKit, hasContestKit } from './index';
import { getHistoricalWeather, HistoricalWeatherData } from '../weather-service';

/**
 * Main evaluation function - the entry point for the policy engine
 */
export async function evaluateContest(
  ticketFacts: TicketFacts,
  userEvidence: UserEvidence,
  selectedGrounds?: string[]
): Promise<ContestEvaluation> {
  const kit = getContestKit(ticketFacts.violationCode);

  if (!kit) {
    // No kit available - return a basic evaluation
    return createBasicEvaluation(ticketFacts, userEvidence);
  }

  // Step 1: Check eligibility
  const { eligible, warnings, disqualifyReasons } = checkEligibility(kit, ticketFacts);

  // Step 2: Check weather if relevant
  let weatherDefense = await checkWeatherDefense(kit, ticketFacts);

  // Step 3: Build context for argument selection
  const context: ArgumentContext = {
    ticketFacts,
    userEvidence,
    weatherDefense,
    selectedGrounds: selectedGrounds || [],
  };

  // Step 4: Select the best argument
  const { selectedArgument, backupArgument } = selectArguments(kit, context);

  // Step 5: Fill the argument template
  const filledArgument = fillArgumentTemplate(selectedArgument, context);

  // Step 6: Calculate estimated win rate
  const estimatedWinRate = calculateWinRate(kit, context, selectedArgument);

  // Step 7: Build evidence checklist
  const evidenceChecklist = buildEvidenceChecklist(kit, selectedArgument, userEvidence);

  return {
    recommend: eligible && estimatedWinRate >= 0.15,
    confidence: calculateConfidence(context, selectedArgument),
    estimatedWinRate,
    selectedArgument,
    backupArgument,
    filledArgument,
    weatherDefense: {
      applicable: weatherDefense?.canUse || false,
      data: weatherDefense?.data,
      paragraph: weatherDefense?.paragraph,
    },
    evidenceChecklist,
    warnings,
    disqualifyReasons,
  };
}

/**
 * Context object passed through the evaluation pipeline
 */
interface ArgumentContext {
  ticketFacts: TicketFacts;
  userEvidence: UserEvidence;
  weatherDefense: WeatherDefenseResult | null;
  selectedGrounds: string[];
}

interface WeatherDefenseResult {
  canUse: boolean;
  data: HistoricalWeatherData;
  paragraph: string | null;
}

/**
 * Check if the user should contest based on eligibility rules
 */
function checkEligibility(
  kit: ContestKit,
  facts: TicketFacts
): { eligible: boolean; warnings: string[]; disqualifyReasons: string[] } {
  const warnings: string[] = [];
  const disqualifyReasons: string[] = [];

  for (const rule of kit.eligibility.rules) {
    const passed = evaluateRule(rule.check, facts);

    if (!passed) {
      if (rule.failureAction === 'disqualify') {
        disqualifyReasons.push(rule.failureMessage);
      } else if (rule.failureAction === 'warn') {
        warnings.push(rule.failureMessage);
      }
    }
  }

  return {
    eligible: disqualifyReasons.length === 0,
    warnings,
    disqualifyReasons,
  };
}

/**
 * Simple rule evaluator - handles basic expressions
 */
function evaluateRule(check: string, facts: TicketFacts): boolean {
  // Handle common checks
  if (check.includes('daysSinceTicket')) {
    const match = check.match(/daysSinceTicket\s*(<=|>=|<|>|==)\s*(\d+)/);
    if (match) {
      const operator = match[1];
      const value = parseInt(match[2]);
      return compareValues(facts.daysSinceTicket, operator, value);
    }
  }

  // Default to true for complex checks we can't evaluate
  return true;
}

function compareValues(left: number, operator: string, right: number): boolean {
  switch (operator) {
    case '<=': return left <= right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '>': return left > right;
    case '==': return left === right;
    default: return true;
  }
}

/**
 * Check if weather can be used as a defense
 */
async function checkWeatherDefense(
  kit: ContestKit,
  facts: TicketFacts
): Promise<WeatherDefenseResult | null> {
  if (!kit.eligibility.weatherRelevance) {
    return null;
  }

  try {
    const weatherData = await getHistoricalWeather(facts.ticketDate);
    const relevanceType = kit.eligibility.weatherRelevance;

    // For PRIMARY relevance, weather must be defense-relevant (severe conditions)
    // For SUPPORTING/EMERGENCY, any adverse weather can help
    const canUse = relevanceType === 'primary'
      ? weatherData.defenseRelevant
      : weatherData.hasAdverseWeather;

    if (!canUse) {
      return {
        canUse: false,
        data: weatherData,
        paragraph: null,
      };
    }

    // Build defense paragraph based on relevance type
    const paragraph = buildWeatherDefenseParagraph(weatherData, facts, relevanceType);

    return {
      canUse: true,
      data: weatherData,
      paragraph,
    };
  } catch (error) {
    console.error('Failed to fetch weather data for policy evaluation:', error);
    return null;
  }
}

function buildWeatherDefenseParagraph(
  weather: HistoricalWeatherData,
  facts: TicketFacts,
  relevanceType: 'primary' | 'supporting' | 'emergency'
): string {
  const conditions = weather.conditions.join(', ');

  if (relevanceType === 'primary') {
    // Strong, direct weather defense
    return `According to official weather records, on ${weather.date}, Chicago experienced ${weather.weatherDescription}. ` +
      `${weather.defenseReason || ''} ` +
      `The documented conditions (${conditions}) would have made normal operations impractical or impossible. ` +
      `I respectfully submit that citations should not be issued when weather conditions prevent the purpose of the restriction.`;
  } else if (relevanceType === 'supporting') {
    // Weather as supporting context
    return `Weather records indicate that on ${weather.date}, Chicago experienced ${weather.weatherDescription}` +
      (conditions ? ` with ${conditions}` : '') + `. ` +
      `These conditions may have contributed to the circumstances of this situation, including reduced visibility, ` +
      `difficulty navigating safely, and challenges in promptly addressing the parking situation.`;
  } else {
    // Emergency context
    return `On ${weather.date}, Chicago experienced ${weather.weatherDescription}` +
      (conditions ? `, including ${conditions}` : '') + `. ` +
      `These adverse weather conditions created circumstances that made it unsafe or impractical to move my vehicle.`;
  }
}

/**
 * Select the best primary and backup arguments based on context
 */
function selectArguments(
  kit: ContestKit,
  context: ArgumentContext
): { selectedArgument: ArgumentTemplate; backupArgument: ArgumentTemplate | null } {
  const { weatherDefense, userEvidence, selectedGrounds } = context;

  // Collect all candidate arguments
  const candidates: ArgumentTemplate[] = [
    kit.arguments.primary,
    kit.arguments.secondary,
    ...(kit.arguments.situational || []),
  ];

  // Score each argument
  const scored = candidates
    .map(arg => ({
      argument: arg,
      score: scoreArgument(arg, context),
      meetsConditions: checkArgumentConditions(arg, context),
    }))
    .filter(item => item.meetsConditions)
    .sort((a, b) => b.score - a.score);

  // Special case: If weather defense is strong and available, prioritize it
  if (weatherDefense?.canUse) {
    const weatherArg = scored.find(s => s.argument.category === 'weather');
    if (weatherArg && weatherArg.score > 0) {
      const nonWeatherArgs = scored.filter(s => s.argument.category !== 'weather');
      return {
        selectedArgument: weatherArg.argument,
        backupArgument: nonWeatherArgs[0]?.argument || kit.arguments.fallback,
      };
    }
  }

  // Default selection
  if (scored.length >= 2) {
    return {
      selectedArgument: scored[0].argument,
      backupArgument: scored[1].argument,
    };
  } else if (scored.length === 1) {
    return {
      selectedArgument: scored[0].argument,
      backupArgument: kit.arguments.fallback,
    };
  }

  // Fallback
  return {
    selectedArgument: kit.arguments.fallback,
    backupArgument: null,
  };
}

/**
 * Score an argument based on context
 */
function scoreArgument(arg: ArgumentTemplate, context: ArgumentContext): number {
  let score = arg.winRate * 100; // Base score from win rate

  // Boost for having supporting evidence
  const evidenceBoost = arg.supportingEvidence.reduce((boost, evidenceId) => {
    if (hasEvidence(evidenceId, context.userEvidence)) {
      return boost + 10;
    }
    return boost;
  }, 0);
  score += evidenceBoost;

  // Boost for weather argument if weather defense applies
  if (arg.category === 'weather' && context.weatherDefense?.canUse) {
    score += 25;
  }

  // Boost if argument matches user's selected grounds
  if (context.selectedGrounds.some(g => arg.name.toLowerCase().includes(g.toLowerCase()))) {
    score += 15;
  }

  return score;
}

/**
 * Check if an argument's conditions are met
 */
function checkArgumentConditions(arg: ArgumentTemplate, context: ArgumentContext): boolean {
  if (!arg.conditions || arg.conditions.length === 0) {
    return true;
  }

  return arg.conditions.every(condition => evaluateCondition(condition, context));
}

function evaluateCondition(condition: ArgumentCondition, context: ArgumentContext): boolean {
  const { field, operator, value } = condition;

  // Special handling for common fields
  if (field === 'weatherDefenseApplicable') {
    const actual = context.weatherDefense?.canUse || false;
    return compareCondition(actual, operator, value);
  }

  // Check in ticket facts
  const factValue = (context.ticketFacts as any)[field];
  if (factValue !== undefined) {
    return compareCondition(factValue, operator, value);
  }

  // Check in user evidence
  const evidenceValue = (context.userEvidence as any)[field];
  if (evidenceValue !== undefined) {
    return compareCondition(evidenceValue, operator, value);
  }

  // Unknown field - default to true (don't block)
  return true;
}

function compareCondition(actual: any, operator: string, expected: any): boolean {
  switch (operator) {
    case 'equals': return actual === expected;
    case 'notEquals': return actual !== expected;
    case 'exists': return actual !== undefined && actual !== null;
    case 'notExists': return actual === undefined || actual === null;
    case 'greaterThan': return actual > expected;
    case 'lessThan': return actual < expected;
    case 'contains': return String(actual).includes(String(expected));
    default: return true;
  }
}

/**
 * Check if user has a specific type of evidence
 */
function hasEvidence(evidenceId: string, userEvidence: UserEvidence): boolean {
  switch (evidenceId) {
    case 'signage_photos':
    case 'location_photos':
    case 'meter_photo':
    case 'permit_photo':
    case 'sticker_photo':
      return userEvidence.hasPhotos;
    case 'witness_statement':
      return userEvidence.hasWitnesses;
    case 'weather_records':
      return true; // We fetch this automatically
    case 'purchase_receipt':
    case 'permit_receipt':
    case 'payment_receipt':
    case 'registration_docs':
    case 'bill_of_sale':
      return userEvidence.hasDocs || userEvidence.hasReceipts;
    case 'police_report':
      return userEvidence.hasPoliceReport;
    default:
      return false;
  }
}

/**
 * Fill an argument template with actual values
 */
function fillArgumentTemplate(arg: ArgumentTemplate, context: ArgumentContext): string {
  let filled = arg.template;
  const { ticketFacts, weatherDefense } = context;

  // Replace common placeholders
  const replacements: Record<string, string> = {
    '[TICKET_NUMBER]': ticketFacts.ticketNumber || '[TICKET NUMBER]',
    '[DATE]': ticketFacts.ticketDate || '[DATE]',
    '[LOCATION]': ticketFacts.location || '[LOCATION]',
    '[LICENSE_PLATE]': '[YOUR LICENSE PLATE]',
    '[VIOLATION_CODE]': ticketFacts.violationCode || '[VIOLATION CODE]',
    '[AMOUNT]': `$${ticketFacts.amount || 0}`,
    '[USER_GROUNDS]': context.selectedGrounds.map(g => `• ${g}`).join('\n') || '• [Your contest grounds]',
  };

  // Weather-specific replacements
  if (weatherDefense?.data) {
    replacements['[WEATHER_CONDITION]'] = weatherDefense.data.weatherDescription;
    replacements['[WEATHER_DATA]'] = weatherDefense.paragraph || '';
    replacements['[SNOWFALL_AMOUNT]'] = weatherDefense.data.snowfall?.toString() || 'minimal';
    replacements['[WEATHER_TYPE]'] = weatherDefense.data.conditions.join(', ') || 'adverse';
  }

  // Generic placeholders that need user input
  const userInputPlaceholders = [
    '[SIGNAGE_ISSUE]', '[SPECIFIC_SIGNAGE_PROBLEM]', '[EVIDENCE_REFERENCE]',
    '[PERMIT_NUMBER]', '[ZONE_NUMBER]', '[PERMIT_LOCATION]', '[PERMIT_EXPIRATION]',
    '[STICKER_STATUS]', '[REGISTRATION_ADDRESS]', '[MALFUNCTION_DESCRIPTION]',
    '[PAYMENT_METHOD]', '[PAYMENT_TIME]', '[PAYMENT_EXPIRATION]', '[TICKET_TIME]',
    '[TIME_COMPARISON]', '[SUPPORTING_INFO]', '[WEATHER_CONTEXT]',
  ];

  // Apply known replacements
  for (const [placeholder, value] of Object.entries(replacements)) {
    filled = filled.replace(new RegExp(placeholder.replace(/[[\]]/g, '\\$&'), 'g'), value);
  }

  // Mark remaining placeholders as needing user input
  for (const placeholder of userInputPlaceholders) {
    if (filled.includes(placeholder)) {
      filled = filled.replace(
        new RegExp(placeholder.replace(/[[\]]/g, '\\$&'), 'g'),
        placeholder // Keep as-is for LLM to fill
      );
    }
  }

  return filled;
}

/**
 * Calculate estimated win rate based on all factors
 */
function calculateWinRate(
  kit: ContestKit,
  context: ArgumentContext,
  selectedArgument: ArgumentTemplate
): number {
  let rate = selectedArgument.winRate;

  // Evidence boosts
  if (context.userEvidence.hasPhotos) {
    rate += 0.10;
  }
  if (context.userEvidence.hasWitnesses) {
    rate += 0.08;
  }
  if (context.userEvidence.hasDocs) {
    rate += 0.07;
  }

  // Weather defense boost
  if (context.weatherDefense?.canUse && selectedArgument.category === 'weather') {
    rate += 0.12;
  }

  // Time penalty for late contests
  if (context.ticketFacts.daysSinceTicket > 14) {
    rate -= 0.05;
  }
  if (context.ticketFacts.daysSinceTicket > 60) {
    rate -= 0.15;
  }

  // Cap between 5% and 95%
  return Math.min(0.95, Math.max(0.05, rate));
}

/**
 * Calculate confidence in our recommendation
 */
function calculateConfidence(context: ArgumentContext, selectedArgument: ArgumentTemplate): number {
  let confidence = 0.5; // Base confidence

  // More evidence = more confident
  if (context.userEvidence.hasPhotos) confidence += 0.15;
  if (context.userEvidence.hasDocs) confidence += 0.10;
  if (context.userEvidence.hasWitnesses) confidence += 0.10;

  // Higher win rate arguments = more confident
  if (selectedArgument.winRate > 0.40) confidence += 0.10;
  if (selectedArgument.winRate > 0.50) confidence += 0.10;

  // Weather data adds confidence
  if (context.weatherDefense?.canUse) confidence += 0.10;

  return Math.min(1.0, confidence);
}

/**
 * Build evidence checklist with status
 */
function buildEvidenceChecklist(
  kit: ContestKit,
  selectedArgument: ArgumentTemplate,
  userEvidence: UserEvidence
): Array<EvidenceItem & { provided: boolean }> {
  const allEvidence = [
    ...kit.evidence.required.map(e => ({ ...e, tier: 'required' as const })),
    ...kit.evidence.recommended.map(e => ({ ...e, tier: 'recommended' as const })),
    ...kit.evidence.optional.map(e => ({ ...e, tier: 'optional' as const })),
  ];

  // Prioritize evidence that supports the selected argument
  const prioritized = allEvidence.sort((a, b) => {
    const aSupports = selectedArgument.supportingEvidence.includes(a.id);
    const bSupports = selectedArgument.supportingEvidence.includes(b.id);
    if (aSupports && !bSupports) return -1;
    if (!aSupports && bSupports) return 1;
    return b.impactScore - a.impactScore;
  });

  return prioritized.map(e => ({
    ...e,
    provided: hasEvidence(e.id, userEvidence),
  }));
}

/**
 * Create a basic evaluation when no kit is available
 */
function createBasicEvaluation(
  facts: TicketFacts,
  evidence: UserEvidence
): ContestEvaluation {
  const fallbackArgument: ArgumentTemplate = {
    id: 'generic_contest',
    name: 'General Contest',
    template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION].

I believe this citation was issued in error and request the opportunity to present my case at a hearing.

[USER_GROUNDS]

Thank you for your consideration.`,
    requiredFacts: ['ticketNumber', 'date', 'location'],
    winRate: 0.15,
    supportingEvidence: [],
    category: 'procedural',
  };

  return {
    recommend: facts.daysSinceTicket <= 21,
    confidence: 0.3,
    estimatedWinRate: 0.15,
    selectedArgument: fallbackArgument,
    backupArgument: null,
    filledArgument: fallbackArgument.template
      .replace('[TICKET_NUMBER]', facts.ticketNumber || '[TICKET NUMBER]')
      .replace('[DATE]', facts.ticketDate || '[DATE]')
      .replace('[LOCATION]', facts.location || '[LOCATION]')
      .replace('[USER_GROUNDS]', '• [Your contest grounds]'),
    weatherDefense: { applicable: false },
    evidenceChecklist: [],
    warnings: ['No specific contest kit available for this violation type. Using generic template.'],
    disqualifyReasons: facts.daysSinceTicket > 21 ? ['Contest deadline has likely passed.'] : [],
  };
}

/**
 * Quick helper to get just the recommended argument for a violation
 */
export async function getRecommendedArgument(
  violationCode: string,
  ticketDate: string,
  userEvidence: UserEvidence
): Promise<{ argument: ArgumentTemplate; weatherApplies: boolean } | null> {
  const kit = getContestKit(violationCode);
  if (!kit) return null;

  const ticketFacts: TicketFacts = {
    ticketNumber: '',
    violationCode,
    violationDescription: kit.description,
    ticketDate,
    location: '',
    amount: kit.fineAmount,
    daysSinceTicket: Math.floor((Date.now() - new Date(ticketDate).getTime()) / (1000 * 60 * 60 * 24)),
  };

  const evaluation = await evaluateContest(ticketFacts, userEvidence);

  return {
    argument: evaluation.selectedArgument,
    weatherApplies: evaluation.weatherDefense.applicable,
  };
}

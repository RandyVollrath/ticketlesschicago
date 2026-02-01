/**
 * Contest Kit Type Definitions
 *
 * A Contest Kit is a structured template for contesting a specific ticket type.
 * It contains eligibility rules, evidence requirements, and argument templates
 * that have proven successful based on FOIA court data.
 */

export interface EligibilityRule {
  /** Rule identifier */
  id: string;
  /** Human-readable description of the rule */
  description: string;
  /** Function name or expression to evaluate (evaluated at runtime) */
  check: string;
  /** What happens if this rule fails */
  failureAction: 'disqualify' | 'warn' | 'suggest_alternative';
  /** Message to show user if rule fails */
  failureMessage: string;
}

export interface EvidenceItem {
  /** Unique identifier for this evidence type */
  id: string;
  /** Display name */
  name: string;
  /** Detailed description of what this evidence should show */
  description: string;
  /** How much this evidence improves win probability (0-1) */
  impactScore: number;
  /** Example of good evidence for this type */
  example?: string;
  /** Tips for gathering this evidence */
  tips?: string[];
}

export interface ArgumentTemplate {
  /** Unique identifier */
  id: string;
  /** Display name for the argument */
  name: string;
  /** The template text with placeholders like [LOCATION], [DATE], etc. */
  template: string;
  /** What facts/data are needed to fill this template */
  requiredFacts: string[];
  /** Historical win rate for this argument (0-1) */
  winRate: number;
  /** Conditions that must be true for this argument to be applicable */
  conditions?: ArgumentCondition[];
  /** Evidence that strengthens this argument */
  supportingEvidence: string[];
  /** Category of argument for organization */
  category: 'procedural' | 'signage' | 'emergency' | 'weather' | 'technical' | 'circumstantial' | 'visibility';
}

export interface ArgumentCondition {
  /** What to check */
  field: string;
  /** Comparison operator */
  operator: 'equals' | 'notEquals' | 'exists' | 'notExists' | 'greaterThan' | 'lessThan' | 'contains';
  /** Value to compare against (if applicable) */
  value?: string | number | boolean;
}

export interface OutcomeTrackingField {
  /** Field identifier */
  id: string;
  /** Display label */
  label: string;
  /** Field type for UI */
  type: 'text' | 'select' | 'boolean' | 'date' | 'number';
  /** Options for select fields */
  options?: string[];
  /** Whether this field is required for tracking */
  required: boolean;
}

export interface ContestKit {
  /** Violation code (e.g., '9-64-010') */
  violationCode: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Category of violation */
  category: 'parking' | 'moving' | 'equipment' | 'sticker' | 'camera';
  /** Base fine amount */
  fineAmount: number;
  /** Base win probability from historical data (0-1) */
  baseWinRate: number;

  /** Eligibility rules - when NOT to contest */
  eligibility: {
    /** Rules that determine if contesting is advisable */
    rules: EligibilityRule[];
    /**
     * How weather relates to this violation type:
     * - 'primary': Weather directly invalidates the ticket (cleaning cancelled, threshold not met)
     * - 'supporting': Weather can be a contributing factor (visibility, safety)
     * - 'emergency': Weather created unsafe conditions that prevented compliance
     * - false: Weather is not relevant to this violation
     */
    weatherRelevance: 'primary' | 'supporting' | 'emergency' | false;
    /** Maximum days after ticket date to contest (Chicago is typically 21 days) */
    maxContestDays: number;
  };

  /** Evidence requirements */
  evidence: {
    /** Evidence that is critical for a strong case */
    required: EvidenceItem[];
    /** Evidence that significantly improves chances */
    recommended: EvidenceItem[];
    /** Evidence that is nice to have but not critical */
    optional: EvidenceItem[];
  };

  /** Argument templates ordered by historical success rate */
  arguments: {
    /** Best argument for this violation type */
    primary: ArgumentTemplate;
    /** Backup argument if primary doesn't apply */
    secondary: ArgumentTemplate;
    /** Generic fallback argument */
    fallback: ArgumentTemplate;
    /** Additional arguments that may apply in specific situations */
    situational?: ArgumentTemplate[];
  };

  /** Fields to track for outcome analysis */
  tracking: {
    fields: OutcomeTrackingField[];
  };

  /** Pro tips specific to this violation type */
  tips: string[];

  /** Common mistakes to avoid */
  pitfalls: string[];
}

/**
 * Result of evaluating a contest kit against ticket facts
 */
export interface ContestEvaluation {
  /** Is this ticket worth contesting? */
  recommend: boolean;
  /** Confidence level in recommendation (0-1) */
  confidence: number;
  /** Estimated win probability based on available evidence */
  estimatedWinRate: number;
  /** Which argument was selected */
  selectedArgument: ArgumentTemplate;
  /** Backup argument if primary fails */
  backupArgument: ArgumentTemplate | null;
  /** Filled argument text */
  filledArgument: string;
  /** Weather defense data if applicable */
  weatherDefense: {
    applicable: boolean;
    data?: any;
    paragraph?: string;
  };
  /** Evidence checklist with status */
  evidenceChecklist: Array<EvidenceItem & { provided: boolean; }>;
  /** Any eligibility warnings */
  warnings: string[];
  /** Reasons if not recommending contest */
  disqualifyReasons: string[];
}

/**
 * Facts extracted from a ticket needed for contest evaluation
 */
export interface TicketFacts {
  ticketNumber: string;
  violationCode: string;
  violationDescription: string;
  ticketDate: string;
  ticketTime?: string;
  location: string;
  ward?: string;
  amount: number;

  // Extracted contextual facts
  hasSignageIssue?: boolean;
  signageIssueType?: string;
  hasEmergency?: boolean;
  emergencyType?: string;
  vehicleWasMoved?: boolean;
  meterWasBroken?: boolean;
  permitWasDisplayed?: boolean;

  // Time-based calculations
  daysSinceTicket: number;
  isWeekend?: boolean;
  isHoliday?: boolean;
}

/**
 * User's available evidence for the contest
 */
export interface UserEvidence {
  hasPhotos: boolean;
  photoTypes: string[];
  hasWitnesses: boolean;
  witnessCount?: number;
  hasDocs: boolean;
  docTypes: string[];
  hasReceipts: boolean;
  hasPoliceReport: boolean;
  hasMedicalDocs: boolean;
  /** Whether GPS parking/departure evidence is available from the mobile app */
  hasLocationEvidence?: boolean;
}

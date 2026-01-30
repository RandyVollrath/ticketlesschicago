/**
 * Tow Alert Service
 *
 * Evaluates parking restrictions and generates urgent alerts
 * for tow risks and imminent violations.
 *
 * Alert Severity:
 * - critical: Active violation or < 15 minutes to restriction
 * - warning: 15-60 minutes to restriction
 * - info: 1-2 hours to restriction
 */

import { Restriction, StreetSegment } from '../parking-map/types';
import { isRestrictionActive } from '../parking-map/compute';

// =============================================================================
// Types
// =============================================================================

export type TowAlertType =
  | 'street-cleaning-imminent'
  | 'snow-emergency-declared'
  | 'tow-zone-active'
  | 'permit-zone-active'
  | 'meter-expiring'
  | 'winter-ban-starting'
  | 'event-restriction'
  | 'alternate-side-starting'
  | 'overnight-ban-starting';

export interface TowAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  type: TowAlertType;
  message: string;
  actionRequired: string;
  deadline?: Date;
  towRisk: boolean;
  estimatedFine?: number;
  estimatedTowCost?: number;
  segment?: StreetSegment;
  restriction?: Restriction;
}

export interface Location {
  latitude: number;
  longitude: number;
}

export interface UserContext {
  permits?: string[];
  hasDisabledPlacard?: boolean;
}

// =============================================================================
// Alert Time Thresholds (in minutes)
// =============================================================================

const ALERT_THRESHOLDS = {
  critical: 15, // < 15 min = critical
  warning: 60, // < 60 min = warning
  info: 120, // < 2 hours = info
};

// =============================================================================
// Tow Alert Service
// =============================================================================

class TowAlertService {
  private alertCallbacks: Array<(alert: TowAlert) => void> = [];

  /**
   * Check for tow risks at a location
   */
  async checkForTowRisks(
    location: Location,
    userContext: UserContext
  ): Promise<TowAlert[]> {
    const alerts: TowAlert[] = [];
    const now = new Date();

    // Find the segment at this location
    const segment = await this.findSegmentAtLocation(location);
    if (!segment) {
      return alerts;
    }

    const restrictions = segment.properties.restrictions;

    for (const restriction of restrictions) {
      const alert = await this.evaluateRestriction(
        restriction,
        segment,
        now,
        userContext
      );
      if (alert) {
        alerts.push(alert);
      }
    }

    // Sort by severity and deadline
    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      if (a.severity !== b.severity) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      if (a.deadline && b.deadline) {
        return a.deadline.getTime() - b.deadline.getTime();
      }
      return 0;
    });
  }

  /**
   * Evaluate a single restriction and generate alert if needed
   */
  private async evaluateRestriction(
    restriction: Restriction,
    segment: StreetSegment,
    now: Date,
    userContext: UserContext
  ): Promise<TowAlert | null> {
    // Check if user is exempt (has permit)
    if (this.isUserExempt(restriction, userContext)) {
      return null;
    }

    const status = this.getRestrictionStatus(restriction, now);

    if (status.isActive) {
      // CRITICAL: Parked illegally RIGHT NOW
      return this.createCriticalAlert(restriction, segment);
    }

    if (status.startsInMinutes !== null) {
      if (status.startsInMinutes <= ALERT_THRESHOLDS.critical) {
        // CRITICAL: < 15 minutes
        return this.createImminentAlert(restriction, segment, status.startsInMinutes);
      } else if (status.startsInMinutes <= ALERT_THRESHOLDS.warning) {
        // WARNING: < 60 minutes
        return this.createWarningAlert(restriction, segment, status.startsInMinutes);
      } else if (status.startsInMinutes <= ALERT_THRESHOLDS.info) {
        // INFO: < 2 hours
        return this.createInfoAlert(restriction, segment, status.startsInMinutes);
      }
    }

    return null;
  }

  /**
   * Check if user is exempt from a restriction
   */
  private isUserExempt(
    restriction: Restriction,
    userContext: UserContext
  ): boolean {
    // Permit zone - check if user has permit
    if (restriction.type === 'permit-zone' && restriction.schedule.permitZone) {
      if (userContext.permits?.includes(restriction.schedule.permitZone)) {
        return true;
      }
    }

    // Note: SF tow zones have NO disabled placard exemption
    // This is handled by noExemptions flag in restriction

    return false;
  }

  /**
   * Get status of a restriction (active now? starts in X minutes?)
   */
  private getRestrictionStatus(
    restriction: Restriction,
    now: Date
  ): { isActive: boolean; startsInMinutes: number | null } {
    const isActive = isRestrictionActive(restriction, now);

    if (isActive) {
      return { isActive: true, startsInMinutes: null };
    }

    // Calculate when restriction starts
    const startsAt = this.getNextRestrictionStart(restriction, now);
    if (startsAt) {
      const startsInMs = startsAt.getTime() - now.getTime();
      const startsInMinutes = Math.round(startsInMs / 60000);
      return { isActive: false, startsInMinutes };
    }

    return { isActive: false, startsInMinutes: null };
  }

  /**
   * Get next time restriction becomes active
   */
  private getNextRestrictionStart(restriction: Restriction, from: Date): Date | null {
    const schedule = restriction.schedule;
    if (!schedule.daysOfWeek || !schedule.startTime) {
      return null;
    }

    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const current = new Date(from);

    // Check next 7 days
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(current);
      checkDate.setDate(checkDate.getDate() + i);
      const day = checkDate.getDay();

      if (schedule.daysOfWeek.includes(day)) {
        const candidate = new Date(checkDate);
        candidate.setHours(startHour, startMinute, 0, 0);

        if (candidate > from) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Create a critical alert (violation in progress)
   */
  private createCriticalAlert(
    restriction: Restriction,
    segment: StreetSegment
  ): TowAlert {
    return {
      id: this.generateAlertId(),
      severity: 'critical',
      type: this.getAlertType(restriction),
      message: this.getCriticalMessage(restriction),
      actionRequired: 'MOVE YOUR CAR IMMEDIATELY',
      towRisk: this.hasTowRisk(restriction),
      estimatedFine: this.getEstimatedFine(restriction),
      estimatedTowCost: this.hasTowRisk(restriction) ? this.getEstimatedTowCost(restriction) : undefined,
      segment,
      restriction,
    };
  }

  /**
   * Create an imminent alert (< 15 min)
   */
  private createImminentAlert(
    restriction: Restriction,
    segment: StreetSegment,
    minutesUntil: number
  ): TowAlert {
    const deadline = new Date(Date.now() + minutesUntil * 60000);

    return {
      id: this.generateAlertId(),
      severity: 'critical',
      type: this.getAlertType(restriction),
      message: this.getImminentMessage(restriction, minutesUntil),
      actionRequired: `Move your car within ${minutesUntil} minutes`,
      deadline,
      towRisk: this.hasTowRisk(restriction),
      estimatedFine: this.getEstimatedFine(restriction),
      segment,
      restriction,
    };
  }

  /**
   * Create a warning alert (15-60 min)
   */
  private createWarningAlert(
    restriction: Restriction,
    segment: StreetSegment,
    minutesUntil: number
  ): TowAlert {
    const deadline = new Date(Date.now() + minutesUntil * 60000);

    return {
      id: this.generateAlertId(),
      severity: 'warning',
      type: this.getAlertType(restriction),
      message: this.getWarningMessage(restriction, minutesUntil),
      actionRequired: `Plan to move by ${this.formatTime(deadline)}`,
      deadline,
      towRisk: this.hasTowRisk(restriction),
      estimatedFine: this.getEstimatedFine(restriction),
      segment,
      restriction,
    };
  }

  /**
   * Create an info alert (1-2 hours)
   */
  private createInfoAlert(
    restriction: Restriction,
    segment: StreetSegment,
    minutesUntil: number
  ): TowAlert {
    const deadline = new Date(Date.now() + minutesUntil * 60000);
    const hoursUntil = Math.round(minutesUntil / 60);

    return {
      id: this.generateAlertId(),
      severity: 'info',
      type: this.getAlertType(restriction),
      message: this.getInfoMessage(restriction, hoursUntil),
      actionRequired: `Move before ${this.formatTime(deadline)}`,
      deadline,
      towRisk: false,
      segment,
      restriction,
    };
  }

  // =============================================================================
  // Message Templates
  // =============================================================================

  private getCriticalMessage(restriction: Restriction): string {
    switch (restriction.type) {
      case 'street-cleaning':
        return 'STREET CLEANING IN PROGRESS - Your car will be ticketed!';
      case 'snow-emergency':
      case 'snow-route':
        return 'SNOW EMERGENCY ACTIVE - Tow trucks are dispatching!';
      case 'tow-away':
        return 'TOW ZONE ACTIVE - Your car may already be hooked!';
      case 'permit-zone':
        return "PERMIT REQUIRED - You don't have a permit for this zone!";
      case 'alternate-side':
        return 'ALTERNATE SIDE PARKING IN EFFECT - Move to other side!';
      case 'winter-ban':
      case 'overnight-ban':
        return 'OVERNIGHT PARKING BAN ACTIVE - Move immediately!';
      default:
        return 'PARKING VIOLATION - Move your car immediately!';
    }
  }

  private getImminentMessage(restriction: Restriction, minutes: number): string {
    switch (restriction.type) {
      case 'street-cleaning':
        return `Street cleaning starts in ${minutes} min!`;
      case 'snow-emergency':
      case 'snow-route':
        return `Snow route ban starts in ${minutes} min!`;
      case 'tow-away':
        return `TOW ZONE activates in ${minutes} min - MOVE NOW!`;
      case 'permit-zone':
        return `Permit-only parking starts in ${minutes} min!`;
      case 'alternate-side':
        return `Alternate side parking in ${minutes} min!`;
      case 'winter-ban':
      case 'overnight-ban':
        return `Overnight ban starts in ${minutes} min!`;
      default:
        return `Parking restriction in ${minutes} min!`;
    }
  }

  private getWarningMessage(restriction: Restriction, minutes: number): string {
    const timeStr = minutes >= 60 ? `${Math.round(minutes / 60)} hour` : `${minutes} minutes`;

    switch (restriction.type) {
      case 'street-cleaning':
        return `Street cleaning starts in ${timeStr}`;
      case 'tow-away':
        return `Tow zone activates in ${timeStr}`;
      case 'alternate-side':
        return `Alternate side parking in ${timeStr}`;
      default:
        return `Parking restriction in ${timeStr}`;
    }
  }

  private getInfoMessage(restriction: Restriction, hours: number): string {
    switch (restriction.type) {
      case 'street-cleaning':
        return `Street cleaning in ${hours} hours`;
      case 'alternate-side':
        return `Alternate side parking in ${hours} hours`;
      default:
        return `Parking restriction in ${hours} hours`;
    }
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private getAlertType(restriction: Restriction): TowAlertType {
    switch (restriction.type) {
      case 'street-cleaning':
        return 'street-cleaning-imminent';
      case 'snow-emergency':
      case 'snow-route':
        return 'snow-emergency-declared';
      case 'tow-away':
        return 'tow-zone-active';
      case 'permit-zone':
        return 'permit-zone-active';
      case 'metered':
        return 'meter-expiring';
      case 'winter-ban':
        return 'winter-ban-starting';
      case 'alternate-side':
        return 'alternate-side-starting';
      case 'overnight-ban':
        return 'overnight-ban-starting';
      case 'event':
        return 'event-restriction';
      default:
        return 'tow-zone-active';
    }
  }

  private hasTowRisk(restriction: Restriction): boolean {
    const towRiskTypes = [
      'snow-emergency',
      'snow-route',
      'tow-away',
      'winter-ban',
    ];
    return towRiskTypes.includes(restriction.type);
  }

  private getEstimatedFine(_restriction: Restriction): number {
    // Would come from city-specific config
    return 65; // Default
  }

  private getEstimatedTowCost(_restriction: Restriction): number {
    // Would come from city-specific config
    return 250; // Default
  }

  private async findSegmentAtLocation(_location: Location): Promise<StreetSegment | null> {
    // In production, query local segment database
    return null;
  }

  private generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Subscribe to alert events
   */
  onAlert(callback: (alert: TowAlert) => void): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      this.alertCallbacks = this.alertCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Dispatch an alert to all listeners
   */
  dispatchAlert(alert: TowAlert): void {
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        console.error('[TowAlertService] Callback error:', error);
      }
    }
  }
}

// Singleton instance
export const towAlertService = new TowAlertService();

export default towAlertService;

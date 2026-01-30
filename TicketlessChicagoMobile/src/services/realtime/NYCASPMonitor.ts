/**
 * NYC Alternate Side Parking (ASP) Monitor
 *
 * Monitors ASP suspension status for New York City.
 * Checks @NYCASP Twitter and official NYC.gov for daily status.
 *
 * NYC suspends ASP on 30+ holidays per year, making this
 * a critical feature for NYC drivers.
 */

import { pushNotificationService } from '../alerts/PushNotificationService';
import { isASPSuspended, NYC_ASP_CALENDAR_2026 } from '../../cities/nyc/holidays';

// =============================================================================
// Types
// =============================================================================

export interface ASPSuspensionStatus {
  isSuspended: boolean;
  date: Date;
  holiday?: string;
  source: string;
  lastChecked: Date;
  nextSuspension?: {
    date: string;
    holiday: string;
  };
}

export interface ASPMonitorConfig {
  checkIntervalMs: number;
  sources: string[];
  notifyOnSuspension: boolean;
  notifyDayBefore: boolean;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ASPMonitorConfig = {
  checkIntervalMs: 60 * 60 * 1000, // 1 hour
  sources: [
    '@NYCASP', // Official Twitter
    'https://www.nyc.gov/asp', // Official site
  ],
  notifyOnSuspension: true,
  notifyDayBefore: true,
};

// =============================================================================
// NYC ASP Monitor
// =============================================================================

class NYCASPMonitor {
  private isMonitoring = false;
  private config: ASPMonitorConfig = DEFAULT_CONFIG;
  private currentStatus: ASPSuspensionStatus | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private statusCallbacks: Array<(status: ASPSuspensionStatus) => void> = [];

  /**
   * Initialize with configuration
   */
  initialize(config?: Partial<ASPMonitorConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[NYCASPMonitor] Initialized');
  }

  /**
   * Start monitoring ASP status
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('[NYCASPMonitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;

    // Check immediately
    await this.checkStatus();

    // Then check at interval
    this.checkInterval = setInterval(async () => {
      await this.checkStatus();
    }, this.config.checkIntervalMs);

    console.log(
      '[NYCASPMonitor] Started monitoring, interval:',
      this.config.checkIntervalMs / 1000 / 60,
      'minutes'
    );
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isMonitoring = false;
    console.log('[NYCASPMonitor] Stopped monitoring');
  }

  /**
   * Get current status
   */
  getStatus(): ASPSuspensionStatus | null {
    return this.currentStatus;
  }

  /**
   * Check if ASP is suspended today
   */
  isASPSuspendedToday(): boolean {
    return this.currentStatus?.isSuspended ?? false;
  }

  /**
   * Get today's suspension reason (if any)
   */
  getTodaySuspensionReason(): string | undefined {
    return this.currentStatus?.holiday;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (status: ASPSuspensionStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Force a status check
   */
  async forceCheck(): Promise<ASPSuspensionStatus> {
    return this.checkStatus();
  }

  /**
   * Get upcoming ASP suspension holidays
   */
  getUpcomingHolidays(count: number = 5): Array<{ date: string; holiday: string }> {
    const today = new Date();
    const todayStr = this.formatDateYYYYMMDD(today);

    return NYC_ASP_CALENDAR_2026.filter((h) => h.date > todayStr && h.aspSuspended)
      .slice(0, count)
      .map((h) => ({ date: h.date, holiday: h.holiday }));
  }

  /**
   * Get total suspension days per year
   */
  getTotalSuspensionDays(): number {
    return NYC_ASP_CALENDAR_2026.filter((h) => h.aspSuspended).length;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Check ASP suspension status
   */
  private async checkStatus(): Promise<ASPSuspensionStatus> {
    console.log('[NYCASPMonitor] Checking status...');

    try {
      const newStatus = await this.fetchASPStatus();

      // Status changed?
      if (this.statusChanged(newStatus)) {
        await this.handleStatusChange(newStatus);
      }

      this.currentStatus = newStatus;
      return newStatus;
    } catch (error) {
      console.error('[NYCASPMonitor] Error checking status:', error);

      // Return last known status or check calendar
      return this.currentStatus || this.checkCalendar();
    }
  }

  /**
   * Fetch ASP status from sources
   */
  private async fetchASPStatus(): Promise<ASPSuspensionStatus> {
    // In production, this would:
    // 1. Try official NYC API
    // 2. Scrape @NYCASP Twitter for today's announcement
    // 3. Fall back to known holiday calendar

    // For now, use the calendar
    return this.checkCalendar();
  }

  /**
   * Check the known holiday calendar
   */
  private checkCalendar(): ASPSuspensionStatus {
    const today = new Date();
    const holiday = isASPSuspended(today);

    // Find next suspension
    const upcoming = this.getUpcomingHolidays(1)[0];

    return {
      isSuspended: holiday?.aspSuspended ?? false,
      date: today,
      holiday: holiday?.holiday,
      source: 'calendar',
      lastChecked: new Date(),
      nextSuspension: upcoming,
    };
  }

  /**
   * Check if status has changed
   */
  private statusChanged(newStatus: ASPSuspensionStatus): boolean {
    if (!this.currentStatus) return true;

    // Check if it's a new day
    const currentDate = this.formatDateYYYYMMDD(this.currentStatus.date);
    const newDate = this.formatDateYYYYMMDD(newStatus.date);

    if (currentDate !== newDate) return true;

    return this.currentStatus.isSuspended !== newStatus.isSuspended;
  }

  /**
   * Handle status change
   */
  private async handleStatusChange(newStatus: ASPSuspensionStatus): Promise<void> {
    console.log(
      '[NYCASPMonitor] Status changed:',
      this.currentStatus?.isSuspended,
      '->',
      newStatus.isSuspended
    );

    // Notify listeners
    for (const callback of this.statusCallbacks) {
      try {
        callback(newStatus);
      } catch (error) {
        console.error('[NYCASPMonitor] Callback error:', error);
      }
    }

    // Send notification
    if (this.config.notifyOnSuspension) {
      await this.sendASPNotification(newStatus);
    }
  }

  /**
   * Send ASP notification
   */
  private async sendASPNotification(status: ASPSuspensionStatus): Promise<void> {
    await pushNotificationService.sendASPSuspensionAlert(
      status.isSuspended,
      status.holiday || ''
    );

    console.log('[NYCASPMonitor] Sent ASP notification');
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDateYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// Singleton instance
export const nycASPMonitor = new NYCASPMonitor();

export default nycASPMonitor;

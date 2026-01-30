/**
 * Snow Emergency Monitor
 *
 * Monitors snow emergency status for Chicago and other cities
 * with similar snow emergency systems.
 *
 * Checks official sources and sends urgent notifications when
 * snow emergencies are declared.
 */

import { pushNotificationService } from '../alerts/PushNotificationService';

// =============================================================================
// Types
// =============================================================================

export interface SnowEmergencyStatus {
  isActive: boolean;
  cityId: string;
  declaredAt?: Date;
  enforcementStart?: Date;
  expectedEnd?: Date;
  snowfallAmount?: string; // e.g., "3 inches"
  source: string;
  lastChecked: Date;
  affectedRoutes?: string;
}

export interface SnowEmergencyConfig {
  cityId: string;
  checkIntervalMs: number;
  sources: string[];
  alertWhenDeclared: boolean;
  checkUserLocation: boolean;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: SnowEmergencyConfig = {
  cityId: 'chicago',
  checkIntervalMs: 5 * 60 * 1000, // 5 minutes
  sources: [
    'https://www.chicago.gov/snow',
    '@ChicagoDOT',
  ],
  alertWhenDeclared: true,
  checkUserLocation: true,
};

// =============================================================================
// Snow Emergency Monitor
// =============================================================================

class SnowEmergencyMonitor {
  private isMonitoring = false;
  private config: SnowEmergencyConfig = DEFAULT_CONFIG;
  private currentStatus: SnowEmergencyStatus | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private statusCallbacks: Array<(status: SnowEmergencyStatus) => void> = [];

  /**
   * Initialize with city configuration
   */
  initialize(config?: Partial<SnowEmergencyConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[SnowEmergencyMonitor] Initialized for', this.config.cityId);
  }

  /**
   * Start monitoring snow emergency status
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('[SnowEmergencyMonitor] Already monitoring');
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
      '[SnowEmergencyMonitor] Started monitoring, interval:',
      this.config.checkIntervalMs / 1000,
      'seconds'
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
    console.log('[SnowEmergencyMonitor] Stopped monitoring');
  }

  /**
   * Get current status
   */
  getStatus(): SnowEmergencyStatus | null {
    return this.currentStatus;
  }

  /**
   * Check if snow emergency is currently active
   */
  isSnowEmergencyActive(): boolean {
    return this.currentStatus?.isActive ?? false;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (status: SnowEmergencyStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Force a status check
   */
  async forceCheck(): Promise<SnowEmergencyStatus> {
    return this.checkStatus();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Check snow emergency status
   */
  private async checkStatus(): Promise<SnowEmergencyStatus> {
    console.log('[SnowEmergencyMonitor] Checking status...');

    try {
      const newStatus = await this.fetchSnowEmergencyStatus();

      // Status changed?
      if (this.statusChanged(newStatus)) {
        await this.handleStatusChange(newStatus);
      }

      this.currentStatus = newStatus;
      return newStatus;
    } catch (error) {
      console.error('[SnowEmergencyMonitor] Error checking status:', error);

      // Return last known status
      return (
        this.currentStatus || {
          isActive: false,
          cityId: this.config.cityId,
          source: 'error',
          lastChecked: new Date(),
        }
      );
    }
  }

  /**
   * Fetch snow emergency status from sources
   */
  private async fetchSnowEmergencyStatus(): Promise<SnowEmergencyStatus> {
    // In production, this would:
    // 1. Try official city API
    // 2. Fall back to scraping official website
    // 3. Check Twitter/X for @ChicagoDOT announcements

    // For now, return a stub
    const status: SnowEmergencyStatus = {
      isActive: false,
      cityId: this.config.cityId,
      source: 'stub',
      lastChecked: new Date(),
    };

    // Simulate checking based on season (winter months)
    const now = new Date();
    const month = now.getMonth() + 1;
    const isWinterSeason = month >= 12 || month <= 3;

    if (isWinterSeason) {
      console.log('[SnowEmergencyMonitor] Winter season - active monitoring');
    }

    return status;
  }

  /**
   * Check if status has changed
   */
  private statusChanged(newStatus: SnowEmergencyStatus): boolean {
    if (!this.currentStatus) return true;
    return this.currentStatus.isActive !== newStatus.isActive;
  }

  /**
   * Handle status change
   */
  private async handleStatusChange(newStatus: SnowEmergencyStatus): Promise<void> {
    console.log(
      '[SnowEmergencyMonitor] Status changed:',
      this.currentStatus?.isActive,
      '->',
      newStatus.isActive
    );

    // Notify listeners
    for (const callback of this.statusCallbacks) {
      try {
        callback(newStatus);
      } catch (error) {
        console.error('[SnowEmergencyMonitor] Callback error:', error);
      }
    }

    // Send notification if newly declared
    if (newStatus.isActive && !this.currentStatus?.isActive) {
      await this.sendSnowEmergencyNotification(newStatus);
    }
  }

  /**
   * Send snow emergency notification
   */
  private async sendSnowEmergencyNotification(status: SnowEmergencyStatus): Promise<void> {
    if (!this.config.alertWhenDeclared) return;

    let message = `Snow emergency declared in ${this.formatCityName(status.cityId)}!`;

    if (status.snowfallAmount) {
      message += ` ${status.snowfallAmount} of snow reported.`;
    }

    if (status.enforcementStart) {
      message += ` Enforcement begins ${this.formatTime(status.enforcementStart)}.`;
    }

    message += ' Move your car off snow routes!';

    await pushNotificationService.sendSnowEmergencyAlert(
      message,
      status.enforcementStart || new Date()
    );

    console.log('[SnowEmergencyMonitor] Sent snow emergency notification');
  }

  /**
   * Format city name for display
   */
  private formatCityName(cityId: string): string {
    const names: Record<string, string> = {
      chicago: 'Chicago',
      boston: 'Boston',
      denver: 'Denver',
      minneapolis: 'Minneapolis',
    };
    return names[cityId] || cityId;
  }

  /**
   * Format time for display
   */
  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}

// Singleton instance
export const snowEmergencyMonitor = new SnowEmergencyMonitor();

export default snowEmergencyMonitor;

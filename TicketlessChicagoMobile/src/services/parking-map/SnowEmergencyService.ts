/**
 * Snow Emergency Status Service
 *
 * Monitors Chicago snow emergency status for the 2" parking ban.
 * In a real implementation, this would poll city sources.
 */

import { SnowEmergencyStatus, WeatherConditions } from './types';

const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

class SnowEmergencyService {
  private static instance: SnowEmergencyService;
  private cachedStatus: SnowEmergencyStatus | null = null;
  private cacheTime: number = 0;

  private constructor() {}

  public static getInstance(): SnowEmergencyService {
    if (!SnowEmergencyService.instance) {
      SnowEmergencyService.instance = new SnowEmergencyService();
    }
    return SnowEmergencyService.instance;
  }

  /**
   * Get current snow emergency status
   * Uses cache to avoid excessive API calls
   */
  public async getStatus(): Promise<SnowEmergencyStatus> {
    // Check cache
    if (this.cachedStatus && Date.now() - this.cacheTime < CACHE_DURATION_MS) {
      return this.cachedStatus;
    }

    try {
      const status = await this.fetchSnowEmergencyStatus();
      this.cachedStatus = status;
      this.cacheTime = Date.now();
      return status;
    } catch (error) {
      console.error('[SnowEmergency] Failed to fetch status:', error);
      // Return cached or default
      return (
        this.cachedStatus || {
          isActive: false,
          source: 'City of Chicago OEMC',
          lastChecked: new Date(),
        }
      );
    }
  }

  /**
   * Get full weather conditions for parking status computation
   */
  public async getWeatherConditions(): Promise<WeatherConditions> {
    const snowStatus = await this.getStatus();
    const now = new Date();

    // Check if winter ban period (Dec 1 - Apr 1)
    const month = now.getMonth() + 1;
    const isWinterPeriod = month === 12 || month <= 3 || (month === 4 && now.getDate() === 1);

    return {
      snowEmergencyActive: snowStatus.isActive,
      winterBanActive: isWinterPeriod,
    };
  }

  /**
   * Fetch snow emergency status from city sources
   *
   * In production, this would:
   * 1. Check Chicago OEMC alerts API
   * 2. Scrape chicago.gov/snow
   * 3. Monitor @ChicagoDOT Twitter
   */
  private async fetchSnowEmergencyStatus(): Promise<SnowEmergencyStatus> {
    // TODO: Implement actual API integration
    // For now, return default (no emergency)

    // Placeholder for future implementation:
    // const response = await fetch('https://api.chicago.gov/snow-emergency-status');
    // const data = await response.json();

    return {
      isActive: false,
      source: 'City of Chicago OEMC',
      lastChecked: new Date(),
    };
  }

  /**
   * Subscribe to snow emergency notifications
   * Returns unsubscribe function
   */
  public subscribe(callback: (status: SnowEmergencyStatus) => void): () => void {
    // In production, this would set up a polling interval or push notification listener
    const intervalId = setInterval(async () => {
      const status = await this.getStatus();
      callback(status);
    }, CACHE_DURATION_MS);

    return () => clearInterval(intervalId);
  }

  /**
   * Force refresh of status (bypass cache)
   */
  public async refresh(): Promise<SnowEmergencyStatus> {
    this.cachedStatus = null;
    this.cacheTime = 0;
    return this.getStatus();
  }

  /**
   * Check if currently in snow emergency
   */
  public async isSnowEmergencyActive(): Promise<boolean> {
    const status = await this.getStatus();
    return status.isActive;
  }

  /**
   * Manually set snow emergency status (for testing/admin)
   */
  public setManualStatus(isActive: boolean, declaredAt?: Date): void {
    this.cachedStatus = {
      isActive,
      declaredAt,
      source: 'Manual override',
      lastChecked: new Date(),
    };
    this.cacheTime = Date.now();
  }
}

export const snowEmergencyService = SnowEmergencyService.getInstance();
export default SnowEmergencyService;

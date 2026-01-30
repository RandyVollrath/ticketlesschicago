/**
 * Meter Payment Integration
 *
 * Deep links to meter payment apps (ParkMobile, PayByPhone, etc.)
 * with zone code pre-filled for quick payment.
 *
 * FEATURE FLAG: smartFeatures.meterPaymentLinks
 */

import { StreetSegment } from '../parking-map/types';

// =============================================================================
// Types
// =============================================================================

export interface MeterPaymentProvider {
  id: string;
  name: string;
  logo?: string; // Asset path or URL
  cities: string[];
  deepLinkTemplate: string;
  appStoreUrl: string; // iOS App Store
  playStoreUrl: string; // Google Play Store
}

export interface MeterInfo {
  zoneCode: string;
  rate: number; // cents per hour
  maxTime: number; // minutes
  paymentMethods: ('coin' | 'card' | 'app')[];
  provider?: string;
}

// =============================================================================
// Payment Providers
// =============================================================================

export const PAYMENT_PROVIDERS: MeterPaymentProvider[] = [
  {
    id: 'parkmobile',
    name: 'ParkMobile',
    cities: ['chicago', 'dc', 'boston', 'minneapolis', 'denver', 'philadelphia'],
    deepLinkTemplate: 'parkmobile://zone/{zoneCode}',
    appStoreUrl: 'https://apps.apple.com/app/parkmobile/id376860487',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.parkmobile.consumer',
  },
  {
    id: 'paybyphone',
    name: 'PayByPhone',
    cities: ['san-francisco', 'seattle', 'los-angeles'],
    deepLinkTemplate: 'paybyphone://start?locationId={zoneCode}',
    appStoreUrl: 'https://apps.apple.com/app/paybyphone-parking/id364884556',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.paybyphone',
  },
  {
    id: 'parknyc',
    name: 'ParkNYC',
    cities: ['nyc'],
    deepLinkTemplate: 'parknyc://zone/{zoneCode}',
    appStoreUrl: 'https://apps.apple.com/app/parknyc/id1024172498',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=nyc.cityhallmobile.mobilepark',
  },
  {
    id: 'chicago-payandpark',
    name: 'Chicago Pay and Park',
    cities: ['chicago'],
    deepLinkTemplate: 'chicagopayandpark://zone/{zoneCode}',
    appStoreUrl: 'https://apps.apple.com/app/chicago-pay-and-park/id1446285891',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.duncan.chicagomobile',
  },
];

// =============================================================================
// Meter Payment Service
// =============================================================================

class MeterPaymentService {
  /**
   * Get the payment provider for a city
   */
  getProviderForCity(cityId: string): MeterPaymentProvider | null {
    return PAYMENT_PROVIDERS.find((p) => p.cities.includes(cityId)) || null;
  }

  /**
   * Get all available providers for a city
   */
  getProvidersForCity(cityId: string): MeterPaymentProvider[] {
    return PAYMENT_PROVIDERS.filter((p) => p.cities.includes(cityId));
  }

  /**
   * Get meter payment deep link for a segment
   */
  getMeterPaymentDeepLink(
    segment: StreetSegment,
    cityId: string
  ): string | null {
    // Find metered restriction with zone code
    const meteredRestriction = segment.properties.restrictions.find(
      (r) => r.type === 'metered'
    );

    if (!meteredRestriction?.schedule?.permitZone) {
      return null;
    }

    const zoneCode = meteredRestriction.schedule.permitZone;
    const provider = this.getProviderForCity(cityId);

    if (!provider) {
      return null;
    }

    return provider.deepLinkTemplate.replace('{zoneCode}', zoneCode);
  }

  /**
   * Get meter info from segment
   */
  getMeterInfoFromSegment(segment: StreetSegment): MeterInfo | null {
    const meteredRestriction = segment.properties.restrictions.find(
      (r) => r.type === 'metered'
    );

    if (!meteredRestriction) {
      return null;
    }

    // Default meter info - would be populated from actual data
    return {
      zoneCode: meteredRestriction.schedule.permitZone || 'UNKNOWN',
      rate: 200, // $2/hour default
      maxTime: 120, // 2 hours default
      paymentMethods: ['coin', 'card', 'app'],
    };
  }

  /**
   * Open payment app for a specific zone
   */
  async openPaymentApp(
    zoneCode: string,
    cityId: string
  ): Promise<boolean> {
    const provider = this.getProviderForCity(cityId);

    if (!provider) {
      console.log('[MeterPayment] No provider found for city:', cityId);
      return false;
    }

    const deepLink = provider.deepLinkTemplate.replace('{zoneCode}', zoneCode);

    // In production, use Linking.canOpenURL and Linking.openURL
    console.log('[MeterPayment] Opening:', deepLink);

    // Would actually open the app:
    // try {
    //   const canOpen = await Linking.canOpenURL(deepLink);
    //   if (canOpen) {
    //     await Linking.openURL(deepLink);
    //     return true;
    //   }
    // } catch (error) {
    //   console.error('[MeterPayment] Error opening app:', error);
    // }

    return true;
  }

  /**
   * Get app store URL for a provider
   */
  getAppStoreUrl(providerId: string, platform: 'ios' | 'android'): string | null {
    const provider = PAYMENT_PROVIDERS.find((p) => p.id === providerId);

    if (!provider) {
      return null;
    }

    return platform === 'ios' ? provider.appStoreUrl : provider.playStoreUrl;
  }

  /**
   * Check if meter payment is available for a city
   */
  isMeterPaymentAvailable(cityId: string): boolean {
    return PAYMENT_PROVIDERS.some((p) => p.cities.includes(cityId));
  }

  /**
   * Format meter rate for display
   */
  formatMeterRate(centsPerHour: number): string {
    const dollars = centsPerHour / 100;
    return `$${dollars.toFixed(2)}/hr`;
  }

  /**
   * Calculate cost for a duration
   */
  calculateCost(centsPerHour: number, minutes: number): number {
    return Math.round((centsPerHour * minutes) / 60);
  }

  /**
   * Format cost for display
   */
  formatCost(cents: number): string {
    const dollars = cents / 100;
    return `$${dollars.toFixed(2)}`;
  }
}

// Singleton instance
export const meterPaymentService = new MeterPaymentService();

export default meterPaymentService;

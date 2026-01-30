/**
 * Feature Flags System
 *
 * Controls which features are enabled for each city.
 * ALL NEW CITIES DEFAULT TO FALSE - hidden from users until manually enabled.
 *
 * To enable a city:
 * 1. Environment variable: CITY_{CITYID}_ENABLED=true
 * 2. Or modify the flags directly (for testing)
 */

export interface CityFeatureFlags {
  streetCleaning: boolean;
  ticketContesting: boolean;
  mobileApp: boolean;
  registration: boolean;
}

export interface MapFeatureFlags {
  parkingMap: boolean;
  layers: {
    streetCleaning: boolean;
    snowRoutes: boolean;
    winterBan: boolean;
    permitZones: boolean;
    meters: boolean;
    towZones: boolean;
    loadingZones: boolean;
  };
  timeSlider: boolean;
  crowdsourcedCorrections: boolean;
}

// Smart features that rival SpotAngels/ParkWhiz
export interface SmartFeatureFlags {
  bluetoothDetection: boolean;
  findMyCar: boolean;
  meterPaymentLinks: boolean;
  crowdsourcedReports: boolean;
  garageSuggestions: boolean;
  eventAwareness: boolean;
  sweeperTracking: boolean;
}

export interface FeatureFlags {
  cities: {
    [cityId: string]: CityFeatureFlags;
  };
  map: {
    [cityId: string]: MapFeatureFlags;
  };
  smartFeatures: SmartFeatureFlags;
}

// Default map feature flags - DISABLED until data is ready
const defaultMapFlags: { [cityId: string]: MapFeatureFlags } = {
  chicago: {
    parkingMap: false, // DISABLED - Not visible to users until enabled
    layers: {
      streetCleaning: true,
      snowRoutes: true,
      winterBan: true,
      permitZones: true,
      meters: true,
      towZones: true,
      loadingZones: false,
    },
    timeSlider: true,
    crowdsourcedCorrections: false, // Future feature
  },
};

// Default smart feature flags - ALL DISABLED
const defaultSmartFeatures: SmartFeatureFlags = {
  bluetoothDetection: false,
  findMyCar: false,
  meterPaymentLinks: false,
  crowdsourcedReports: false,
  garageSuggestions: false,
  eventAwareness: false,
  sweeperTracking: false,
};

// Default flags - ONLY Chicago is enabled
const defaultFlags: FeatureFlags = {
  map: defaultMapFlags,
  smartFeatures: defaultSmartFeatures,
  cities: {
    chicago: {
      streetCleaning: true,
      ticketContesting: true,
      mobileApp: true,
      registration: true,
    },
    nyc: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    'los-angeles': {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    philadelphia: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    boston: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    'san-francisco': {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    'washington-dc': {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    seattle: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    denver: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    minneapolis: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
    portland: {
      streetCleaning: false,
      ticketContesting: false,
      mobileApp: false,
      registration: false,
    },
  },
};

class FeatureFlagService {
  private flags: FeatureFlags;

  constructor() {
    this.flags = {
      ...defaultFlags,
      map: { ...defaultMapFlags },
    };
    this.loadEnvironmentOverrides();
  }

  /**
   * Load feature flag overrides from environment variables
   * Format: CITY_{CITYID}_{FEATURE}_ENABLED=true
   */
  private loadEnvironmentOverrides(): void {
    // In React Native, we'd use a config or dotenv approach
    // For now, this is a placeholder for env-based overrides
    const envOverrides: Record<string, boolean> = {};

    // Example: process.env.CITY_NYC_STREET_CLEANING_ENABLED
    // This would be loaded from app config in production
  }

  /**
   * Check if a specific feature is enabled for a city
   */
  isEnabled(cityId: string, feature: keyof CityFeatureFlags): boolean {
    const cityFlags = this.flags.cities[cityId];
    if (!cityFlags) {
      return false;
    }
    return cityFlags[feature] ?? false;
  }

  /**
   * Check if any feature is enabled for a city
   */
  isCityEnabled(cityId: string): boolean {
    const cityFlags = this.flags.cities[cityId];
    if (!cityFlags) {
      return false;
    }
    return Object.values(cityFlags).some(enabled => enabled);
  }

  /**
   * Get all enabled cities
   */
  getEnabledCities(): string[] {
    return Object.entries(this.flags.cities)
      .filter(([_, flags]) => Object.values(flags).some(enabled => enabled))
      .map(([cityId]) => cityId);
  }

  /**
   * Get flags for a specific city
   */
  getCityFlags(cityId: string): CityFeatureFlags | null {
    return this.flags.cities[cityId] ?? null;
  }

  /**
   * Enable a feature for a city (admin use only)
   */
  enableFeature(cityId: string, feature: keyof CityFeatureFlags): void {
    if (!this.flags.cities[cityId]) {
      this.flags.cities[cityId] = {
        streetCleaning: false,
        ticketContesting: false,
        mobileApp: false,
        registration: false,
      };
    }
    this.flags.cities[cityId][feature] = true;
  }

  /**
   * Disable a feature for a city
   */
  disableFeature(cityId: string, feature: keyof CityFeatureFlags): void {
    if (this.flags.cities[cityId]) {
      this.flags.cities[cityId][feature] = false;
    }
  }

  /**
   * Get all flags (for debugging)
   */
  getAllFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Check if parking map is enabled for a city
   */
  isParkingMapEnabled(cityId: string): boolean {
    return this.flags.map[cityId]?.parkingMap ?? false;
  }

  /**
   * Get map feature flags for a city
   */
  getMapFlags(cityId: string): MapFeatureFlags | null {
    return this.flags.map[cityId] ?? null;
  }

  /**
   * Enable parking map for a city (admin use)
   */
  enableParkingMap(cityId: string): void {
    if (!this.flags.map[cityId]) {
      this.flags.map[cityId] = {
        parkingMap: true,
        layers: {
          streetCleaning: true,
          snowRoutes: true,
          winterBan: true,
          permitZones: true,
          meters: true,
          towZones: true,
          loadingZones: false,
        },
        timeSlider: true,
        crowdsourcedCorrections: false,
      };
    } else {
      this.flags.map[cityId].parkingMap = true;
    }
  }

  /**
   * Check if a smart feature is enabled
   */
  isSmartFeatureEnabled(feature: keyof SmartFeatureFlags): boolean {
    return this.flags.smartFeatures[feature] ?? false;
  }

  /**
   * Get all smart feature flags
   */
  getSmartFeatures(): SmartFeatureFlags {
    return { ...this.flags.smartFeatures };
  }

  /**
   * Enable a smart feature (admin use)
   */
  enableSmartFeature(feature: keyof SmartFeatureFlags): void {
    this.flags.smartFeatures[feature] = true;
  }

  /**
   * Disable a smart feature
   */
  disableSmartFeature(feature: keyof SmartFeatureFlags): void {
    this.flags.smartFeatures[feature] = false;
  }
}

export const featureFlags = new FeatureFlagService();

/**
 * Get current feature flags
 */
export function getFeatureFlags(): FeatureFlags {
  return featureFlags.getAllFlags();
}

export default featureFlags;

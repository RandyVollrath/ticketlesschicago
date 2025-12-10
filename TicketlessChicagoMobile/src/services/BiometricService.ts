/**
 * BiometricService
 *
 * Provides biometric authentication functionality (Face ID, Touch ID, fingerprint).
 * Uses react-native-biometrics for cross-platform biometric support.
 *
 * Setup required:
 * 1. Install: npm install react-native-biometrics
 * 2. For iOS: Add NSFaceIDUsageDescription to Info.plist
 * 3. For Android: Add USE_BIOMETRIC permission to AndroidManifest.xml
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('BiometricService');

// Biometric types
export enum BiometricType {
  FACE_ID = 'FaceID',
  TOUCH_ID = 'TouchID',
  FINGERPRINT = 'Fingerprint',
  IRIS = 'Iris',
  NONE = 'None',
}

// Storage key for biometric preference
const BIOMETRIC_ENABLED_KEY = 'biometricAuthEnabled';

// Biometrics interface (matches react-native-biometrics API)
interface ReactNativeBiometrics {
  isSensorAvailable(): Promise<{
    available: boolean;
    biometryType?: string;
    error?: string;
  }>;
  simplePrompt(options: { promptMessage: string; cancelButtonText?: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  createKeys(): Promise<{ publicKey: string }>;
  deleteKeys(): Promise<{ keysDeleted: boolean }>;
  biometricKeysExist(): Promise<{ keysExist: boolean }>;
  createSignature(options: {
    promptMessage: string;
    payload: string;
    cancelButtonText?: string;
  }): Promise<{ success: boolean; signature?: string; error?: string }>;
}

let biometrics: ReactNativeBiometrics | null = null;

// Try to load react-native-biometrics
async function loadBiometrics(): Promise<ReactNativeBiometrics | null> {
  try {
    const module = await import('react-native-biometrics');
    // react-native-biometrics exports a class that needs to be instantiated
    const ReactNativeBiometrics = module.default;
    return new ReactNativeBiometrics({ allowDeviceCredentials: true });
  } catch (error) {
    log.warn('react-native-biometrics not available', error);
    return null;
  }
}

class BiometricServiceClass {
  private isInitialized = false;
  private _isAvailable = false;
  private _biometricType: BiometricType = BiometricType.NONE;
  private _isEnabled = false;

  /**
   * Initialize the biometric service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Load biometrics module
    biometrics = await loadBiometrics();

    if (biometrics) {
      // Check sensor availability
      const result = await biometrics.isSensorAvailable();
      this._isAvailable = result.available;

      if (result.biometryType) {
        this._biometricType = this.mapBiometryType(result.biometryType);
      }

      log.info('Biometric availability:', {
        available: this._isAvailable,
        type: this._biometricType,
      });
    }

    // Load user preference
    await this.loadPreference();

    this.isInitialized = true;
    log.info('BiometricService initialized');
  }

  /**
   * Map biometry type string to enum
   */
  private mapBiometryType(type: string): BiometricType {
    switch (type.toLowerCase()) {
      case 'faceid':
        return BiometricType.FACE_ID;
      case 'touchid':
        return BiometricType.TOUCH_ID;
      case 'fingerprint':
        return BiometricType.FINGERPRINT;
      case 'iris':
        return BiometricType.IRIS;
      default:
        return BiometricType.NONE;
    }
  }

  /**
   * Load biometric preference from storage
   */
  private async loadPreference(): Promise<void> {
    try {
      const enabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
      this._isEnabled = enabled === 'true';
    } catch (error) {
      log.error('Error loading biometric preference', error);
    }
  }

  /**
   * Check if biometric authentication is available on this device
   */
  isAvailable(): boolean {
    return this._isAvailable;
  }

  /**
   * Get the type of biometric available
   */
  getBiometricType(): BiometricType {
    return this._biometricType;
  }

  /**
   * Get a friendly name for the biometric type
   */
  getBiometricName(): string {
    switch (this._biometricType) {
      case BiometricType.FACE_ID:
        return 'Face ID';
      case BiometricType.TOUCH_ID:
        return 'Touch ID';
      case BiometricType.FINGERPRINT:
        return 'Fingerprint';
      case BiometricType.IRIS:
        return 'Iris';
      default:
        return 'Biometric';
    }
  }

  /**
   * Check if biometric authentication is enabled by the user
   */
  isEnabled(): boolean {
    return this._isEnabled && this._isAvailable;
  }

  /**
   * Enable biometric authentication
   */
  async enable(): Promise<boolean> {
    if (!this._isAvailable) {
      log.warn('Cannot enable biometrics - not available');
      return false;
    }

    // Verify biometrics work before enabling
    const verified = await this.authenticate('Verify your identity to enable biometric login');
    if (!verified) {
      return false;
    }

    try {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
      this._isEnabled = true;
      log.info('Biometric authentication enabled');
      return true;
    } catch (error) {
      log.error('Error enabling biometric authentication', error);
      return false;
    }
  }

  /**
   * Disable biometric authentication
   */
  async disable(): Promise<void> {
    try {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'false');
      this._isEnabled = false;
      log.info('Biometric authentication disabled');
    } catch (error) {
      log.error('Error disabling biometric authentication', error);
    }
  }

  /**
   * Authenticate using biometrics
   */
  async authenticate(
    promptMessage: string = 'Authenticate to continue'
  ): Promise<boolean> {
    if (!biometrics || !this._isAvailable) {
      log.warn('Biometrics not available for authentication');
      return false;
    }

    try {
      const result = await biometrics.simplePrompt({
        promptMessage,
        cancelButtonText: 'Cancel',
      });

      if (result.success) {
        log.info('Biometric authentication successful');
        return true;
      } else {
        log.warn('Biometric authentication failed', result.error);
        return false;
      }
    } catch (error) {
      log.error('Biometric authentication error', error);
      return false;
    }
  }

  /**
   * Authenticate for app access (if enabled)
   * Returns true if authentication succeeds or biometrics are disabled
   */
  async authenticateForAccess(): Promise<boolean> {
    if (!this.isEnabled()) {
      // Biometrics not enabled, allow access
      return true;
    }

    return this.authenticate('Authenticate to access Ticketless Chicago');
  }

  /**
   * Create biometric keys for secure operations
   */
  async createKeys(): Promise<string | null> {
    if (!biometrics || !this._isAvailable) {
      return null;
    }

    try {
      const result = await biometrics.createKeys();
      log.info('Biometric keys created');
      return result.publicKey;
    } catch (error) {
      log.error('Error creating biometric keys', error);
      return null;
    }
  }

  /**
   * Delete biometric keys
   */
  async deleteKeys(): Promise<boolean> {
    if (!biometrics) {
      return false;
    }

    try {
      const result = await biometrics.deleteKeys();
      log.info('Biometric keys deleted');
      return result.keysDeleted;
    } catch (error) {
      log.error('Error deleting biometric keys', error);
      return false;
    }
  }

  /**
   * Create a signature for secure operations
   */
  async createSignature(
    payload: string,
    promptMessage: string = 'Sign to continue'
  ): Promise<string | null> {
    if (!biometrics || !this._isAvailable) {
      return null;
    }

    try {
      const result = await biometrics.createSignature({
        promptMessage,
        payload,
        cancelButtonText: 'Cancel',
      });

      if (result.success && result.signature) {
        return result.signature;
      }

      return null;
    } catch (error) {
      log.error('Error creating signature', error);
      return null;
    }
  }

  /**
   * Get status information
   */
  getStatus(): {
    available: boolean;
    enabled: boolean;
    type: BiometricType;
    typeName: string;
  } {
    return {
      available: this._isAvailable,
      enabled: this._isEnabled,
      type: this._biometricType,
      typeName: this.getBiometricName(),
    };
  }
}

// Export singleton instance
export const BiometricService = new BiometricServiceClass();

export default BiometricService;

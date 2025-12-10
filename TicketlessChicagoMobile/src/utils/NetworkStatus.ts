/**
 * Network status utility for offline detection and handling
 *
 * Usage:
 * - Call NetworkStatus.isConnected() to check current status
 * - Call NetworkStatus.addListener() to subscribe to changes
 * - The utility automatically initializes when first used
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import Logger from './Logger';

const log = Logger.createLogger('NetworkStatus');

type NetworkListener = (isConnected: boolean) => void;

class NetworkStatusClass {
  private isOnline: boolean = true;
  private listeners: NetworkListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private isInitialized: boolean = false;

  /**
   * Initialize network status monitoring
   */
  initialize(): void {
    if (this.isInitialized) return;

    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOnline = this.isOnline;
      this.isOnline = state.isConnected ?? false;

      if (wasOnline !== this.isOnline) {
        log.info(`Network status changed: ${this.isOnline ? 'online' : 'offline'}`);
        this.notifyListeners();
      }
    });

    this.isInitialized = true;
    log.debug('Network status monitoring initialized');
  }

  /**
   * Check if the device is currently connected to the internet
   */
  async isConnected(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      this.isOnline = state.isConnected ?? false;
      return this.isOnline;
    } catch (error) {
      log.error('Error checking network status', error);
      return this.isOnline;
    }
  }

  /**
   * Get the current cached connection status (synchronous)
   * Note: Use isConnected() for the most accurate status
   */
  isConnectedSync(): boolean {
    return this.isOnline;
  }

  /**
   * Add a listener for network status changes
   */
  addListener(listener: NetworkListener): () => void {
    // Auto-initialize if not already done
    if (!this.isInitialized) {
      this.initialize();
    }

    this.listeners.push(listener);

    // Immediately notify with current status
    listener(this.isOnline);

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.isOnline);
      } catch (error) {
        log.error('Error in network listener', error);
      }
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners = [];
    this.isInitialized = false;
  }
}

export default new NetworkStatusClass();

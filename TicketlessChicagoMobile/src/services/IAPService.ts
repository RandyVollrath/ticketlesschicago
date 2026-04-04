/**
 * In-App Purchase Service for iOS
 *
 * Handles StoreKit purchases for users who sign up directly in the iOS app.
 * Users who signed up on the website already have active accounts and skip this.
 *
 * Product: Non-consumable "autopilot_annual" at $119.99
 * Apple takes 15% (~$18), we net ~$102 (Small Business Program rate).
 */

import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Product,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import ApiClient from '../utils/ApiClient';
import AuthService from './AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('IAPService');

const PRODUCT_ID = 'autopilot_annual';

type PurchaseCallback = (success: boolean, error?: string) => void;

class IAPService {
  private connected = false;
  private product: Product | null = null;
  private purchaseUpdateSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
  private purchaseErrorSubscription: ReturnType<typeof purchaseErrorListener> | null = null;
  private pendingCallback: PurchaseCallback | null = null;

  /**
   * Initialize IAP connection and fetch product info.
   * Only runs on iOS — no-ops on Android.
   */
  async initialize(): Promise<void> {
    if (Platform.OS !== 'ios') return;

    try {
      await initConnection();
      this.connected = true;
      log.info('IAP connection established');

      // Fetch product details from App Store
      const products = await fetchProducts({ skus: [PRODUCT_ID] });
      if (products && products.length > 0) {
        this.product = products[0];
        log.info(`IAP product loaded: ${this.product.displayPrice}`);
      } else {
        log.warn('IAP product not found in App Store — is it configured in App Store Connect?');
      }

      // Listen for purchase events
      this.purchaseUpdateSubscription = purchaseUpdatedListener(
        async (purchase: Purchase) => {
          log.info('Purchase update received', { productId: purchase.productId });
          await this.handlePurchaseUpdate(purchase);
        },
      );

      this.purchaseErrorSubscription = purchaseErrorListener(
        (error: PurchaseError) => {
          log.error('Purchase error', error);
          const message = error.code === 'E_USER_CANCELLED'
            ? 'Purchase cancelled'
            : error.message || 'Purchase failed';
          this.pendingCallback?.(false, message);
          this.pendingCallback = null;
        },
      );
    } catch (error) {
      log.error('Failed to initialize IAP', error);
    }
  }

  /**
   * Get the localized price string (e.g. "$139.99") for display.
   */
  getPrice(): string | null {
    return this.product?.displayPrice ?? null;
  }

  /**
   * Whether IAP is available (connected + product loaded).
   */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && this.connected && this.product !== null;
  }

  /**
   * Initiate a purchase. Returns via callback when complete.
   */
  async purchase(callback: PurchaseCallback): Promise<void> {
    if (!this.isAvailable()) {
      callback(false, 'In-App Purchase is not available');
      return;
    }

    this.pendingCallback = callback;

    try {
      await requestPurchase({
        request: {
          apple: { sku: PRODUCT_ID },
        },
        type: 'in-app',
      });
    } catch (error: any) {
      log.error('requestPurchase failed', error);
      this.pendingCallback = null;
      callback(false, error?.message || 'Purchase failed');
    }
  }

  /**
   * Handle a successful purchase: verify receipt on backend, activate account.
   */
  private async handlePurchaseUpdate(purchase: Purchase): Promise<void> {
    try {
      const userId = AuthService.getUser()?.id;
      if (!userId) {
        log.error('No authenticated user during purchase completion');
        this.pendingCallback?.(false, 'Not authenticated');
        this.pendingCallback = null;
        return;
      }

      // Send the purchase token (JWS on iOS) to backend for validation
      const response = await ApiClient.authPost<{ activated: boolean }>(
        '/api/iap/verify-receipt',
        {
          purchaseToken: purchase.purchaseToken,
          productId: purchase.productId,
          transactionId: purchase.id,
        },
      );

      if (response.success && response.data?.activated) {
        // Finish the transaction with Apple (acknowledge delivery)
        await finishTransaction({ purchase, isConsumable: false });
        log.info('Purchase verified and account activated');
        this.pendingCallback?.(true);
      } else {
        log.error('Backend rejected receipt', response.error);
        this.pendingCallback?.(false, 'Could not verify purchase. Please contact support.');
      }
    } catch (error) {
      log.error('Error processing purchase', error);
      this.pendingCallback?.(false, 'Error processing purchase. Please contact support.');
    } finally {
      this.pendingCallback = null;
    }
  }

  /**
   * Clean up IAP listeners and connection.
   */
  async cleanup(): Promise<void> {
    this.purchaseUpdateSubscription?.remove();
    this.purchaseErrorSubscription?.remove();
    this.purchaseUpdateSubscription = null;
    this.purchaseErrorSubscription = null;

    if (this.connected) {
      await endConnection();
      this.connected = false;
    }
  }
}

export default new IAPService();

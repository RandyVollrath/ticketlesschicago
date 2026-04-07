/**
 * In-App Purchase Service for iOS
 *
 * Handles StoreKit purchases for users who sign up directly in the iOS app.
 * Users who signed up on the website already have active accounts and skip this.
 *
 * Products:
 *   - "autopilot_annual" — $119.99/year (non-consumable, legacy)
 *   - "autopilot_monthly" — $14.99/month (auto-renewable subscription)
 *
 * Apple takes 15% (Small Business Program rate).
 */

import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Subscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import ApiClient from '../utils/ApiClient';
import AuthService from './AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('IAPService');

const PRODUCT_ID_ANNUAL = 'autopilot_annual_v2';
const PRODUCT_ID_MONTHLY = 'autopilot_monthly_v2';

export type BillingPlan = 'annual' | 'monthly';

type PurchaseCallback = (success: boolean, error?: string) => void;

class IAPService {
  private connected = false;
  private annualSubscription: Subscription | null = null;
  private monthlySubscription: Subscription | null = null;
  private purchaseUpdateSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
  private purchaseErrorSubscription: ReturnType<typeof purchaseErrorListener> | null = null;
  private pendingCallback: PurchaseCallback | null = null;
  private lastInitError: string | null = null;

  /**
   * Get the last initialization error (if any) for diagnostics.
   */
  getLastError(): string | null {
    return this.lastInitError;
  }

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

      // Fetch both subscriptions
      try {
        const subs = await getSubscriptions({ skus: [PRODUCT_ID_ANNUAL, PRODUCT_ID_MONTHLY] });
        log.info(`IAP getSubscriptions returned ${subs.length} products`, {
          productIds: subs.map((s) => s.productId),
        });
        for (const sub of subs) {
          if (sub.productId === PRODUCT_ID_ANNUAL) {
            this.annualSubscription = sub;
            log.info(`IAP annual subscription loaded: ${sub.displayPrice}`);
          } else if (sub.productId === PRODUCT_ID_MONTHLY) {
            this.monthlySubscription = sub;
            log.info(`IAP monthly subscription loaded: ${sub.displayPrice}`);
          }
        }
        if (!this.annualSubscription) {
          log.warn('IAP annual subscription not found in App Store');
          this.lastInitError = `Annual subscription "${PRODUCT_ID_ANNUAL}" not found. getSubscriptions returned ${subs.length} products: [${subs.map((s) => s.productId).join(', ')}]`;
        }
        if (!this.monthlySubscription) {
          log.warn('IAP monthly subscription not found in App Store');
          if (!this.lastInitError) {
            this.lastInitError = `Monthly subscription "${PRODUCT_ID_MONTHLY}" not found. getSubscriptions returned ${subs.length} products: [${subs.map((s) => s.productId).join(', ')}]`;
          }
        }
      } catch (subError: any) {
        log.warn('Failed to fetch subscriptions', subError);
        this.lastInitError = `getSubscriptions threw: ${subError?.message || String(subError)}`;
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
    } catch (error: any) {
      log.error('Failed to initialize IAP', error);
      this.lastInitError = `initConnection failed: ${error?.message || String(error)}`;
    }
  }

  /**
   * Get the localized price string for a plan.
   */
  getPrice(plan: BillingPlan = 'annual'): string | null {
    if (plan === 'monthly') {
      return this.monthlySubscription?.displayPrice ?? null;
    }
    return this.annualSubscription?.displayPrice ?? null;
  }

  /**
   * Whether IAP is available for a given plan.
   */
  isAvailable(plan: BillingPlan = 'annual'): boolean {
    if (Platform.OS !== 'ios' || !this.connected) return false;
    if (plan === 'monthly') return this.monthlySubscription !== null;
    return this.annualSubscription !== null;
  }

  /**
   * Whether monthly subscription is available in the store.
   */
  isMonthlyAvailable(): boolean {
    return this.isAvailable('monthly');
  }

  /**
   * Initiate a purchase. Returns via callback when complete.
   */
  async purchase(callback: PurchaseCallback, plan: BillingPlan = 'annual'): Promise<void> {
    if (!this.isAvailable(plan)) {
      callback(false, 'In-App Purchase is not available');
      return;
    }

    this.pendingCallback = callback;

    try {
      const sku = plan === 'monthly' ? PRODUCT_ID_MONTHLY : PRODUCT_ID_ANNUAL;
      await requestSubscription({
        request: {
          apple: { sku },
        },
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

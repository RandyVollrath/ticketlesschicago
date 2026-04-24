/**
 * In-App Purchase Service for iOS
 *
 * Handles StoreKit purchases for users who sign up directly in the iOS app.
 * Users who signed up on the website already have active accounts and skip this.
 *
 * Products:
 *   - "autopilot_annual_v3" — $79/year (auto-renewable subscription)
 *   - "autopilot_monthly_v3" — $9/month (auto-renewable subscription)
 *
 * Apple takes 15% (Small Business Program rate).
 *
 * Uses react-native-iap v14 API: fetchProducts({type: 'subs'}) + requestPurchase({type: 'subs'}).
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
} from 'react-native-iap';
import ApiClient from '../utils/ApiClient';
import AuthService from './AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('IAPService');

const PRODUCT_ID_ANNUAL = 'autopilot_annual_v3';
const PRODUCT_ID_MONTHLY = 'autopilot_monthly_v3';

export type BillingPlan = 'annual' | 'monthly';

type PurchaseCallback = (success: boolean, error?: string) => void;

class IAPService {
  private connected = false;
  private annualSubscription: any | null = null;
  private monthlySubscription: any | null = null;
  private purchaseUpdateSubscription: any = null;
  private purchaseErrorSubscription: any = null;
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

      // Fetch both subscriptions (v14 API: fetchProducts with type 'subs')
      try {
        const subs = await fetchProducts({
          skus: [PRODUCT_ID_ANNUAL, PRODUCT_ID_MONTHLY],
          type: 'subs',
        });
        const subsArray = (subs ?? []) as any[];
        log.info(`IAP fetchProducts returned ${subsArray.length} products`, {
          productIds: subsArray.map((s) => s?.id ?? s?.productId),
        });
        for (const sub of subsArray) {
          const productId = sub?.id ?? sub?.productId;
          if (productId === PRODUCT_ID_ANNUAL) {
            this.annualSubscription = sub;
            log.info(`IAP annual subscription loaded: ${sub?.displayPrice ?? sub?.localizedPrice}`);
          } else if (productId === PRODUCT_ID_MONTHLY) {
            this.monthlySubscription = sub;
            log.info(`IAP monthly subscription loaded: ${sub?.displayPrice ?? sub?.localizedPrice}`);
          }
        }
        if (!this.annualSubscription) {
          log.warn('IAP annual subscription not found in App Store');
          this.lastInitError = `Annual subscription "${PRODUCT_ID_ANNUAL}" not found. fetchProducts returned ${subsArray.length} products: [${subsArray.map((s) => s?.id ?? s?.productId).join(', ')}]`;
        }
        if (!this.monthlySubscription) {
          log.warn('IAP monthly subscription not found in App Store');
          if (!this.lastInitError) {
            this.lastInitError = `Monthly subscription "${PRODUCT_ID_MONTHLY}" not found. fetchProducts returned ${subsArray.length} products: [${subsArray.map((s) => s?.id ?? s?.productId).join(', ')}]`;
          }
        }
      } catch (subError: any) {
        log.warn('Failed to fetch subscriptions', subError);
        this.lastInitError = `fetchProducts threw: ${subError?.message || String(subError)}`;
      }

      // Listen for purchase events
      this.purchaseUpdateSubscription = purchaseUpdatedListener(
        async (purchase: any) => {
          log.info('Purchase update received', { productId: purchase?.productId ?? purchase?.id });
          await this.handlePurchaseUpdate(purchase);
        },
      );

      this.purchaseErrorSubscription = purchaseErrorListener(
        (error: any) => {
          log.error('Purchase error', error);
          const message = error?.code === 'E_USER_CANCELLED'
            ? 'Purchase cancelled'
            : error?.message || 'Purchase failed';
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
    const sub = plan === 'monthly' ? this.monthlySubscription : this.annualSubscription;
    return sub?.displayPrice ?? sub?.localizedPrice ?? null;
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
      // v14 API: requestPurchase with type 'subs' for subscriptions
      await requestPurchase({
        request: {
          apple: { sku },
        },
        type: 'subs',
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
  private async handlePurchaseUpdate(purchase: any): Promise<void> {
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
          purchaseToken: purchase?.purchaseToken ?? purchase?.jwsRepresentationIos,
          productId: purchase?.productId ?? purchase?.id,
          transactionId: purchase?.id ?? purchase?.transactionId,
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
    this.purchaseUpdateSubscription?.remove?.();
    this.purchaseErrorSubscription?.remove?.();
    this.purchaseUpdateSubscription = null;
    this.purchaseErrorSubscription = null;

    if (this.connected) {
      await endConnection();
      this.connected = false;
    }
  }
}

export default new IAPService();

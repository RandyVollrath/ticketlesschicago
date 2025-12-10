/**
 * Global error handler for unhandled errors and promise rejections
 *
 * This module sets up global error handling to catch:
 * - Unhandled JavaScript errors
 * - Unhandled promise rejections
 *
 * Usage: Call setupGlobalErrorHandler() once at app startup
 */

import { Alert } from 'react-native';
import Logger from './Logger';
import { CrashReporting } from '../services/CrashReportingService';

const log = Logger.createLogger('GlobalError');

let isErrorHandlerSetup = false;

/**
 * Handle an unhandled error
 */
function handleError(error: Error, isFatal: boolean): void {
  log.error(`Unhandled ${isFatal ? 'fatal ' : ''}error`, {
    message: error.message,
    stack: error.stack,
    isFatal,
  });

  // Send to crash reporting service in production
  if (!__DEV__) {
    CrashReporting.recordError(error, isFatal ? 'fatal_error' : 'unhandled_error');
  }

  // Show alert for fatal errors in production
  if (isFatal && !__DEV__) {
    Alert.alert(
      'Unexpected Error',
      'The app encountered an unexpected error and needs to restart. Please reopen the app.',
      [{ text: 'OK' }]
    );
  }
}

/**
 * Handle an unhandled promise rejection
 */
function handlePromiseRejection(reason: any): void {
  const error = reason instanceof Error ? reason : new Error(String(reason));

  log.error('Unhandled promise rejection', {
    message: error.message,
    stack: error.stack,
  });

  // Send to crash reporting service in production
  if (!__DEV__) {
    CrashReporting.recordError(error, 'unhandled_promise_rejection');
  }
}

/**
 * Setup global error handlers
 * Call this once when the app starts
 */
export function setupGlobalErrorHandler(): void {
  if (isErrorHandlerSetup) {
    log.debug('Global error handler already setup');
    return;
  }

  // Get the default error handler
  const defaultHandler = ErrorUtils.getGlobalHandler();

  // Set custom error handler
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    handleError(error, isFatal ?? false);

    // Call the default handler in development for better debugging
    if (__DEV__ && defaultHandler) {
      defaultHandler(error, isFatal);
    }
  });

  // Handle unhandled promise rejections using React Native's tracking API
  // This is the correct way to handle unhandled promise rejections in React Native
  if (typeof global !== 'undefined') {
    // React Native exposes HermesInternal for promise rejection tracking
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (id: number, rejection: any) => {
        handlePromiseRejection(rejection);
      },
      onHandled: () => {
        // Promise was handled after being rejected - no action needed
      },
    });
  }

  isErrorHandlerSetup = true;
  log.info('Global error handler setup complete');
}

/**
 * Manually report an error (useful for caught errors you want to track)
 */
export function reportError(error: Error, context?: Record<string, any>): void {
  log.error('Reported error', {
    message: error.message,
    stack: error.stack,
    ...context,
  });

  // Send to crash reporting service in production
  if (!__DEV__) {
    // Log context as breadcrumb before recording error
    if (context) {
      CrashReporting.logMessage(`Error context: ${JSON.stringify(context)}`);
    }
    CrashReporting.recordError(error, 'reported_error');
  }
}

export default {
  setup: setupGlobalErrorHandler,
  report: reportError,
};

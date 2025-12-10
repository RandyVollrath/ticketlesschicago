/**
 * API Client with retry logic, timeout handling, and error management
 */

import { Alert, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Config from '../config/config';
import AuthService from '../services/AuthService';

// Retry configuration
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY = 1000; // ms
const DEFAULT_TIMEOUT = 15000; // ms

// Error types for better handling
export enum ApiErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ApiError {
  type: ApiErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
  originalError?: Error;
}

export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  requireAuth?: boolean;
  showErrorAlert?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * Categorize error based on status code and error type
 */
function categorizeError(statusCode?: number, error?: Error): ApiError {
  // Network connectivity errors
  if (error?.message?.includes('Network request failed') || error?.message?.includes('Failed to fetch')) {
    return {
      type: ApiErrorType.NETWORK_ERROR,
      message: 'No internet connection. Please check your network settings.',
      retryable: true,
      originalError: error,
    };
  }

  // Timeout errors
  if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
    return {
      type: ApiErrorType.TIMEOUT_ERROR,
      message: 'Request timed out. Please try again.',
      retryable: true,
      originalError: error,
    };
  }

  // HTTP status code based errors
  if (statusCode) {
    if (statusCode === 401 || statusCode === 403) {
      return {
        type: ApiErrorType.AUTH_ERROR,
        message: 'Authentication failed. Please log in again.',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 404) {
      return {
        type: ApiErrorType.NOT_FOUND_ERROR,
        message: 'The requested resource was not found.',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 422 || statusCode === 400) {
      return {
        type: ApiErrorType.VALIDATION_ERROR,
        message: 'Invalid request. Please check your input.',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 429) {
      return {
        type: ApiErrorType.RATE_LIMIT_ERROR,
        message: 'Too many requests. Please wait a moment.',
        statusCode,
        retryable: true,
      };
    }

    if (statusCode >= 500) {
      return {
        type: ApiErrorType.SERVER_ERROR,
        message: 'Server error. Please try again later.',
        statusCode,
        retryable: true,
      };
    }
  }

  return {
    type: ApiErrorType.UNKNOWN_ERROR,
    message: error?.message || 'An unexpected error occurred.',
    statusCode,
    retryable: true,
    originalError: error,
  };
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number, baseDelay: number): number {
  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

/**
 * Check network connectivity
 */
async function checkConnectivity(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  } catch {
    return true; // Assume connected if we can't check
  }
}

/**
 * Main API request function with retry logic
 */
async function apiRequest<T>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRY_COUNT,
    retryDelay = DEFAULT_RETRY_DELAY,
    requireAuth = false,
    showErrorAlert = false,
  } = config;

  // Check connectivity first
  const isConnected = await checkConnectivity();
  if (!isConnected) {
    const error = categorizeError(undefined, new Error('Network request failed'));
    if (showErrorAlert) {
      Alert.alert('No Connection', error.message);
    }
    return { success: false, error };
  }

  // Build URL
  const url = endpoint.startsWith('http') ? endpoint : `${Config.API_BASE_URL}${endpoint}`;

  // Build headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Platform': Platform.OS,
    'X-App-Version': '1.0.0',
    ...headers,
  };

  // Add auth header if required
  if (requireAuth) {
    const token = AuthService.getToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    } else {
      const error: ApiError = {
        type: ApiErrorType.AUTH_ERROR,
        message: 'Authentication required',
        retryable: false,
      };
      return { success: false, error };
    }
  }

  // Retry loop
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response
      let data: T | undefined;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        try {
          data = await response.json();
        } catch {
          // JSON parse error
        }
      }

      // Check for success
      if (response.ok) {
        return { success: true, data };
      }

      // Handle error response
      const error = categorizeError(response.status);

      // Extract error message from response if available
      if (data && typeof data === 'object' && 'error' in data) {
        error.message = (data as any).error;
      }

      // Handle 401 errors with token refresh
      if (response.status === 401 && requireAuth && attempt === 0) {
        console.log('Received 401, attempting token refresh');
        const refreshed = await AuthService.handleAuthError();
        if (refreshed) {
          // Update the auth header with new token and retry
          const newToken = AuthService.getToken();
          if (newToken) {
            requestHeaders.Authorization = `Bearer ${newToken}`;
            continue; // Retry with new token
          }
        }
        // If refresh failed, return auth error
        if (showErrorAlert) {
          Alert.alert('Session Expired', 'Please log in again.');
        }
        return { success: false, error };
      }

      // Don't retry non-retryable errors
      if (!error.retryable) {
        if (showErrorAlert) {
          Alert.alert('Error', error.message);
        }
        return { success: false, error };
      }

      lastError = error;

    } catch (err) {
      const error = categorizeError(undefined, err as Error);
      lastError = error;

      // Don't retry non-retryable errors
      if (!error.retryable) {
        if (showErrorAlert) {
          Alert.alert('Error', error.message);
        }
        return { success: false, error };
      }
    }

    // Wait before retry (if not the last attempt)
    if (attempt < retries) {
      const delay = getRetryDelay(attempt, retryDelay);
      console.log(`API request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
    }
  }

  // All retries exhausted
  if (showErrorAlert && lastError) {
    Alert.alert('Error', lastError.message);
  }

  return { success: false, error: lastError };
}

/**
 * Convenience methods for common HTTP verbs
 */
export const ApiClient = {
  get: <T>(endpoint: string, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'GET' }),

  post: <T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'POST', body }),

  put: <T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'PUT', body }),

  patch: <T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'PATCH', body }),

  delete: <T>(endpoint: string, config?: Omit<RequestConfig, 'method'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'DELETE' }),

  // Authenticated requests
  authGet: <T>(endpoint: string, config?: Omit<RequestConfig, 'method' | 'body' | 'requireAuth'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'GET', requireAuth: true }),

  authPost: <T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body' | 'requireAuth'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'POST', body, requireAuth: true }),

  authPut: <T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body' | 'requireAuth'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'PUT', body, requireAuth: true }),

  authDelete: <T>(endpoint: string, config?: Omit<RequestConfig, 'method' | 'requireAuth'>) =>
    apiRequest<T>(endpoint, { ...config, method: 'DELETE', requireAuth: true }),
};

export default ApiClient;

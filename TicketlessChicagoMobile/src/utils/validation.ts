/**
 * Input validation utilities
 *
 * Provides validation functions for various input types used throughout the app.
 */

import { Coordinates } from '../services/LocationService';

// Chicago approximate bounding box (generous range)
const CHICAGO_BOUNDS = {
  minLat: 41.6,
  maxLat: 42.1,
  minLng: -88.0,
  maxLng: -87.4,
};

/**
 * Validate that coordinates are valid numbers within reasonable ranges
 */
export function validateCoordinates(coords: Coordinates): {
  valid: boolean;
  error?: string;
} {
  // Check if coordinates exist
  if (!coords || typeof coords !== 'object') {
    return { valid: false, error: 'Coordinates are required' };
  }

  const { latitude, longitude } = coords;

  // Check if values are numbers
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, error: 'Latitude and longitude must be numbers' };
  }

  // Check for NaN or Infinity
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { valid: false, error: 'Invalid coordinate values' };
  }

  // Check global valid ranges
  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' };
  }

  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' };
  }

  return { valid: true };
}

/**
 * Validate that coordinates are within Chicago area
 */
export function validateChicagoCoordinates(coords: Coordinates): {
  valid: boolean;
  error?: string;
  warning?: string;
} {
  const basicValidation = validateCoordinates(coords);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  const { latitude, longitude } = coords;

  // Check if within Chicago bounds (warning only, not error)
  const isInChicago =
    latitude >= CHICAGO_BOUNDS.minLat &&
    latitude <= CHICAGO_BOUNDS.maxLat &&
    longitude >= CHICAGO_BOUNDS.minLng &&
    longitude <= CHICAGO_BOUNDS.maxLng;

  if (!isInChicago) {
    return {
      valid: true,
      warning: 'Location appears to be outside Chicago. Parking rules may not be accurate.',
    };
  }

  return { valid: true };
}

/**
 * Validate email format
 */
export function validateEmail(email: string): {
  valid: boolean;
  error?: string;
} {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Email cannot be empty' };
  }

  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  return { valid: true };
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  valid: boolean;
  error?: string;
  strength: 'weak' | 'medium' | 'strong';
} {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required', strength: 'weak' };
  }

  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters', strength: 'weak' };
  }

  // Calculate strength
  let strength: 'weak' | 'medium' | 'strong' = 'weak';

  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const isLong = password.length >= 12;

  const score =
    (hasUpperCase ? 1 : 0) +
    (hasLowerCase ? 1 : 0) +
    (hasNumbers ? 1 : 0) +
    (hasSpecial ? 1 : 0) +
    (isLong ? 1 : 0);

  if (score >= 4) {
    strength = 'strong';
  } else if (score >= 2) {
    strength = 'medium';
  }

  return { valid: true, strength };
}

/**
 * Validate API response structure
 */
export function validateParkingApiResponse(response: any): {
  valid: boolean;
  error?: string;
} {
  if (!response || typeof response !== 'object') {
    return { valid: false, error: 'Invalid API response' };
  }

  // Check for expected fields
  // Note: The response can have various optional fields, so we only validate structure
  if (response.error && typeof response.error === 'string') {
    return { valid: false, error: response.error };
  }

  return { valid: true };
}

/**
 * Sanitize string input (remove potentially dangerous characters)
 */
export function sanitizeString(input: string, maxLength: number = 500): string {
  if (typeof input !== 'string') return '';

  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, ''); // Remove angle brackets to prevent injection
}

/**
 * Validate Bluetooth device ID format
 */
export function validateBluetoothDeviceId(deviceId: string): {
  valid: boolean;
  error?: string;
} {
  if (!deviceId || typeof deviceId !== 'string') {
    return { valid: false, error: 'Device ID is required' };
  }

  // Bluetooth device IDs are typically MAC addresses or UUIDs
  // MAC: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
  // UUID: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  const uuidRegex = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

  if (!macRegex.test(deviceId) && !uuidRegex.test(deviceId)) {
    // On some platforms, device IDs may have different formats
    // Allow any non-empty string as fallback
    if (deviceId.length < 3 || deviceId.length > 100) {
      return { valid: false, error: 'Invalid device ID format' };
    }
  }

  return { valid: true };
}

export default {
  coordinates: validateCoordinates,
  chicagoCoordinates: validateChicagoCoordinates,
  email: validateEmail,
  password: validatePassword,
  parkingApiResponse: validateParkingApiResponse,
  sanitize: sanitizeString,
  bluetoothDeviceId: validateBluetoothDeviceId,
};

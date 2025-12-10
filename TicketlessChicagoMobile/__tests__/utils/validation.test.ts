/**
 * Unit tests for validation utilities
 */

import {
  validateCoordinates,
  validateChicagoCoordinates,
  validateEmail,
  validatePassword,
  validateParkingApiResponse,
  sanitizeString,
  validateBluetoothDeviceId,
} from '../../src/utils/validation';

describe('validateCoordinates', () => {
  it('should accept valid coordinates', () => {
    const result = validateCoordinates({ latitude: 41.8781, longitude: -87.6298 });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject null coordinates', () => {
    const result = validateCoordinates(null as any);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject undefined coordinates', () => {
    const result = validateCoordinates(undefined as any);
    expect(result.valid).toBe(false);
  });

  it('should reject non-numeric latitude', () => {
    const result = validateCoordinates({ latitude: 'invalid' as any, longitude: -87.6298 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('number');
  });

  it('should reject NaN values', () => {
    const result = validateCoordinates({ latitude: NaN, longitude: -87.6298 });
    expect(result.valid).toBe(false);
  });

  it('should reject Infinity values', () => {
    const result = validateCoordinates({ latitude: Infinity, longitude: -87.6298 });
    expect(result.valid).toBe(false);
  });

  it('should reject latitude out of range (too high)', () => {
    const result = validateCoordinates({ latitude: 91, longitude: -87.6298 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Latitude');
  });

  it('should reject latitude out of range (too low)', () => {
    const result = validateCoordinates({ latitude: -91, longitude: -87.6298 });
    expect(result.valid).toBe(false);
  });

  it('should reject longitude out of range (too high)', () => {
    const result = validateCoordinates({ latitude: 41.8781, longitude: 181 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Longitude');
  });

  it('should reject longitude out of range (too low)', () => {
    const result = validateCoordinates({ latitude: 41.8781, longitude: -181 });
    expect(result.valid).toBe(false);
  });

  it('should accept edge case coordinates', () => {
    expect(validateCoordinates({ latitude: 0, longitude: 0 }).valid).toBe(true);
    expect(validateCoordinates({ latitude: 90, longitude: 180 }).valid).toBe(true);
    expect(validateCoordinates({ latitude: -90, longitude: -180 }).valid).toBe(true);
  });
});

describe('validateChicagoCoordinates', () => {
  it('should accept coordinates in Chicago', () => {
    // Willis Tower
    const result = validateChicagoCoordinates({ latitude: 41.8789, longitude: -87.6359 });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('should warn for coordinates outside Chicago', () => {
    // New York City
    const result = validateChicagoCoordinates({ latitude: 40.7128, longitude: -74.0060 });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('outside Chicago');
  });

  it('should reject invalid coordinates', () => {
    const result = validateChicagoCoordinates({ latitude: 'bad' as any, longitude: -87 });
    expect(result.valid).toBe(false);
  });
});

describe('validateEmail', () => {
  it('should accept valid email', () => {
    expect(validateEmail('test@example.com').valid).toBe(true);
    expect(validateEmail('user.name@domain.co.uk').valid).toBe(true);
    expect(validateEmail('user+tag@gmail.com').valid).toBe(true);
  });

  it('should reject empty email', () => {
    expect(validateEmail('').valid).toBe(false);
    expect(validateEmail('   ').valid).toBe(false);
  });

  it('should reject null/undefined', () => {
    expect(validateEmail(null as any).valid).toBe(false);
    expect(validateEmail(undefined as any).valid).toBe(false);
  });

  it('should reject invalid format', () => {
    expect(validateEmail('invalid').valid).toBe(false);
    expect(validateEmail('invalid@').valid).toBe(false);
    expect(validateEmail('@domain.com').valid).toBe(false);
    expect(validateEmail('invalid@domain').valid).toBe(false);
  });
});

describe('validatePassword', () => {
  it('should accept valid password', () => {
    const result = validatePassword('Password123!');
    expect(result.valid).toBe(true);
    expect(result.strength).toBe('strong');
  });

  it('should reject short password', () => {
    const result = validatePassword('12345');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('6 characters');
  });

  it('should reject empty password', () => {
    expect(validatePassword('').valid).toBe(false);
    expect(validatePassword(null as any).valid).toBe(false);
  });

  it('should calculate strength correctly', () => {
    // Weak: just lowercase
    expect(validatePassword('password').strength).toBe('weak');

    // Medium: mixed case
    expect(validatePassword('Password').strength).toBe('medium');

    // Strong: mixed case, numbers, special chars
    expect(validatePassword('Password123!').strength).toBe('strong');
  });
});

describe('validateParkingApiResponse', () => {
  it('should accept valid response', () => {
    expect(validateParkingApiResponse({ address: '123 Main St' }).valid).toBe(true);
    expect(validateParkingApiResponse({ streetCleaning: { hasRestriction: false } }).valid).toBe(true);
  });

  it('should reject null/undefined', () => {
    expect(validateParkingApiResponse(null).valid).toBe(false);
    expect(validateParkingApiResponse(undefined).valid).toBe(false);
  });

  it('should extract error from response', () => {
    const result = validateParkingApiResponse({ error: 'Invalid location' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid location');
  });
});

describe('sanitizeString', () => {
  it('should trim whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('should remove angle brackets', () => {
    expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(600);
    expect(sanitizeString(longString, 100).length).toBe(100);
  });

  it('should handle non-string input', () => {
    expect(sanitizeString(null as any)).toBe('');
    expect(sanitizeString(undefined as any)).toBe('');
    expect(sanitizeString(123 as any)).toBe('');
  });
});

describe('validateBluetoothDeviceId', () => {
  it('should accept valid MAC address', () => {
    expect(validateBluetoothDeviceId('AA:BB:CC:DD:EE:FF').valid).toBe(true);
    expect(validateBluetoothDeviceId('aa:bb:cc:dd:ee:ff').valid).toBe(true);
    expect(validateBluetoothDeviceId('AA-BB-CC-DD-EE-FF').valid).toBe(true);
  });

  it('should accept valid UUID', () => {
    expect(validateBluetoothDeviceId('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
  });

  it('should accept other valid device IDs', () => {
    // Some platforms use different formats
    expect(validateBluetoothDeviceId('device123456').valid).toBe(true);
  });

  it('should reject empty/null', () => {
    expect(validateBluetoothDeviceId('').valid).toBe(false);
    expect(validateBluetoothDeviceId(null as any).valid).toBe(false);
  });

  it('should reject too short IDs', () => {
    expect(validateBluetoothDeviceId('ab').valid).toBe(false);
  });
});

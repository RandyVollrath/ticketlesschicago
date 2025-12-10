/**
 * Storage utility functions for managing app data
 *
 * Provides typed access to AsyncStorage with proper error handling
 * and utility functions for clearing data on logout.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys, LOGOUT_CLEAR_KEYS, StorageKey } from '../constants/StorageKeys';
import Logger from './Logger';

const log = Logger.createLogger('Storage');

/**
 * Get a typed value from storage
 */
export async function getStorageItem<T>(key: StorageKey): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    log.error(`Error reading storage key: ${key}`, error);
    return null;
  }
}

/**
 * Get a raw string value from storage
 */
export async function getStorageString(key: StorageKey): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (error) {
    log.error(`Error reading storage key: ${key}`, error);
    return null;
  }
}

/**
 * Set a typed value in storage
 */
export async function setStorageItem<T>(key: StorageKey, value: T): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    log.error(`Error writing storage key: ${key}`, error);
    return false;
  }
}

/**
 * Set a raw string value in storage
 */
export async function setStorageString(key: StorageKey, value: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (error) {
    log.error(`Error writing storage key: ${key}`, error);
    return false;
  }
}

/**
 * Remove a specific key from storage
 */
export async function removeStorageItem(key: StorageKey): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch (error) {
    log.error(`Error removing storage key: ${key}`, error);
    return false;
  }
}

/**
 * Clear user data on logout while preserving app preferences
 */
export async function clearUserData(): Promise<void> {
  try {
    log.info('Clearing user data on logout');

    // Remove all logout-specific keys
    await AsyncStorage.multiRemove([...LOGOUT_CLEAR_KEYS]);

    log.info('User data cleared successfully');
  } catch (error) {
    log.error('Error clearing user data', error);
    throw error;
  }
}

/**
 * Clear all app data (for complete reset)
 */
export async function clearAllData(): Promise<void> {
  try {
    log.info('Clearing all app data');
    await AsyncStorage.clear();
    log.info('All data cleared successfully');
  } catch (error) {
    log.error('Error clearing all data', error);
    throw error;
  }
}

/**
 * Get all storage keys and their values (for debugging)
 */
export async function getAllStorageData(): Promise<Record<string, string | null>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    return Object.fromEntries(pairs);
  } catch (error) {
    log.error('Error getting all storage data', error);
    return {};
  }
}

/**
 * Get storage usage statistics
 */
export async function getStorageStats(): Promise<{
  keyCount: number;
  keys: string[];
}> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return {
      keyCount: keys.length,
      keys: [...keys],
    };
  } catch (error) {
    log.error('Error getting storage stats', error);
    return { keyCount: 0, keys: [] };
  }
}

export default {
  getItem: getStorageItem,
  getString: getStorageString,
  setItem: setStorageItem,
  setString: setStorageString,
  removeItem: removeStorageItem,
  clearUserData,
  clearAllData,
  getAllData: getAllStorageData,
  getStats: getStorageStats,
  keys: StorageKeys,
};

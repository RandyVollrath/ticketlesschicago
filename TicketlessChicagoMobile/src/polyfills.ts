/**
 * Polyfills for React Native compatibility with various packages
 * This file should be imported at the very top of index.js
 */

// Polyfill for structuredClone (needed by Supabase auth-js)
if (typeof (global as any).structuredClone === 'undefined') {
  (global as any).structuredClone = <T>(obj: T): T => {
    if (obj === undefined) return undefined as T;
    if (obj === null) return null as T;
    return JSON.parse(JSON.stringify(obj));
  };
}

// URL polyfill - React Native has issues with URL parsing
import 'react-native-url-polyfill/auto';

export {};

// Jest setup file for React Native

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
  addEventListener: jest.fn().mockReturnValue(jest.fn()),
}));

// Mock react-native-ble-manager
jest.mock('react-native-ble-manager', () => ({
  start: jest.fn().mockResolvedValue(undefined),
  scan: jest.fn().mockResolvedValue(undefined),
  stopScan: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
}));

// Mock @notifee/react-native
jest.mock('@notifee/react-native', () => ({
  displayNotification: jest.fn().mockResolvedValue(undefined),
  createChannel: jest.fn().mockResolvedValue(undefined),
  onForegroundEvent: jest.fn().mockReturnValue(jest.fn()),
  requestPermission: jest.fn().mockResolvedValue({ authorizationStatus: 1 }),
  AndroidImportance: {
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
  },
  EventType: {
    PRESS: 1,
    DISMISSED: 2,
  },
  AuthorizationStatus: {
    AUTHORIZED: 1,
    DENIED: 0,
    NOT_DETERMINED: -1,
  },
}));

// Mock @react-native-firebase/messaging
jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    requestPermission: jest.fn().mockResolvedValue(1),
    getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
    deleteToken: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn().mockReturnValue(jest.fn()),
    setBackgroundMessageHandler: jest.fn(),
    onTokenRefresh: jest.fn().mockReturnValue(jest.fn()),
    getInitialNotification: jest.fn().mockResolvedValue(null),
  })),
  AuthorizationStatus: {
    AUTHORIZED: 1,
    PROVISIONAL: 2,
    DENIED: 0,
    NOT_DETERMINED: -1,
  },
}));

// Mock @react-native-firebase/crashlytics
jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    log: jest.fn(),
    recordError: jest.fn(),
    setUserId: jest.fn().mockResolvedValue(undefined),
    setAttribute: jest.fn().mockResolvedValue(undefined),
    setAttributes: jest.fn().mockResolvedValue(undefined),
    crash: jest.fn(),
    setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock react-native-biometrics
jest.mock('react-native-biometrics', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    isSensorAvailable: jest.fn().mockResolvedValue({
      available: true,
      biometryType: 'FaceID',
    }),
    simplePrompt: jest.fn().mockResolvedValue({ success: true }),
    createKeys: jest.fn().mockResolvedValue({ publicKey: 'mock-public-key' }),
    deleteKeys: jest.fn().mockResolvedValue({ keysDeleted: true }),
    biometricKeysExist: jest.fn().mockResolvedValue({ keysExist: false }),
  })),
}));

// Mock @react-native-community/geolocation
jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn().mockImplementation((success) => {
    success({
      coords: {
        latitude: 41.8781,
        longitude: -87.6298,
        altitude: null,
        accuracy: 10,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });
  }),
  watchPosition: jest.fn().mockReturnValue(1),
  clearWatch: jest.fn(),
  requestAuthorization: jest.fn().mockResolvedValue('granted'),
}));

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
      signUp: jest.fn().mockResolvedValue({ data: { user: {}, session: {} }, error: null }),
      signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      setSession: jest.fn().mockResolvedValue({ error: null }),
    },
  })),
}));

// Mock NativeEventEmitter
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    })),
    NativeModules: {
      ...RN.NativeModules,
      BleManager: {},
    },
    Alert: {
      alert: jest.fn(),
    },
    Linking: {
      getInitialURL: jest.fn().mockResolvedValue(null),
      addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
      canOpenURL: jest.fn().mockResolvedValue(true),
      openURL: jest.fn().mockResolvedValue(true),
    },
    Platform: {
      OS: 'ios',
      select: jest.fn((obj) => obj.ios),
    },
    PermissionsAndroid: {
      request: jest.fn().mockResolvedValue('granted'),
      requestMultiple: jest.fn().mockResolvedValue({
        'android.permission.BLUETOOTH_SCAN': 'granted',
        'android.permission.BLUETOOTH_CONNECT': 'granted',
        'android.permission.ACCESS_FINE_LOCATION': 'granted',
      }),
      PERMISSIONS: {
        BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
        BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
        ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
      },
      RESULTS: {
        GRANTED: 'granted',
        DENIED: 'denied',
      },
    },
  };
});

// Silence console during tests (comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

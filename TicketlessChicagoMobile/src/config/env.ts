// Environment configuration for the mobile app

export const API_URL = __DEV__
  ? 'http://localhost:3000' // Development - your local Next.js server
  : 'https://ticketless.fyi'; // Production

export const PARKING_CHECK_ENDPOINT = `${API_URL}/api/check-parking-location`;

export const config = {
  apiUrl: API_URL,
  parkingCheckEndpoint: PARKING_CHECK_ENDPOINT,

  // Location settings
  locationAccuracy: {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 10000,
  },

  // Distance threshold for parking rules (meters)
  parkingCheckRadius: 30,

  // Bluetooth settings
  bluetoothScanDuration: 10000, // 10 seconds
  connectionCheckInterval: 5000, // 5 seconds
};

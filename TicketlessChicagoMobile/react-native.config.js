module.exports = {
  dependencies: {
    'react-native-vector-icons': {
      platforms: {
        ios: null, // disable auto-linking on iOS if handled manually
        android: null, // we manually copy fonts to android/app/src/main/assets/fonts/
      },
    },
    'react-native-iap': {
      platforms: {
        android: null, // IAP is iOS-only — skip Android native build
      },
    },
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts'],
};

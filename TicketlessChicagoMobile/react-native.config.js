module.exports = {
  dependencies: {
    'react-native-iap': {
      platforms: {
        android: null, // IAP is iOS-only — skip Android native build
      },
    },
  },
  assets: ['./assets/fonts'],
};

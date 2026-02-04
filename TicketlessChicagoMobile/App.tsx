import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import AlertsScreen from './src/screens/AlertsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import LoginScreen from './src/screens/LoginScreen';
import CheckDestinationScreen from './src/screens/CheckDestinationScreen';

// Services
import AuthService, { AuthState } from './src/services/AuthService';
import PushNotificationService from './src/services/PushNotificationService';
import DeepLinkingService from './src/services/DeepLinkingService';
import ApiClient from './src/utils/ApiClient';

// Components
import TabBar from './src/navigation/TabBar';
import { ErrorBoundary } from './src/components';

// Theme
import { colors, typography } from './src/theme';

// Utils
import Logger from './src/utils/Logger';
import { setupGlobalErrorHandler } from './src/utils/errorHandler';
import { StorageKeys } from './src/constants';

const log = Logger.createLogger('App');

// Setup global error handling
setupGlobalErrorHandler();

// Type definitions
export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  MainTabs: undefined;
  BluetoothSettings: undefined;
  CheckDestination: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  History: undefined;
  Alerts: undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Custom TabBar renderer - extracted to avoid re-creation on each render
const renderTabBar = (props: any) => <TabBar {...props} />;

// Main Tab Navigator
function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="Search"
        component={CheckDestinationScreen}
        options={{ tabBarLabel: 'Search' }}
        initialParams={{ isTab: true }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{ tabBarLabel: 'History' }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarLabel: 'Alerts', lazy: false }}
      />
      <Tab.Screen
        name="Settings"
        component={ProfileScreen}
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

// App Component
function App(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [hasSeenLogin, setHasSeenLogin] = useState(false);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    // Subscribe to auth state changes FIRST before initializing
    // This prevents missing the initial auth state
    const unsubscribe = AuthService.subscribe((state) => {
      setAuthState(state);
    });

    // Then initialize the app
    initializeApp();

    return () => unsubscribe();
  }, []);

  // Note: Deep linking and push notification navigation refs are set in
  // NavigationContainer's onReady callback to ensure navigation is ready

  /**
   * Pre-populate the user's home permit zone from their profile address.
   * Runs once at app startup if authenticated and zone not already cached.
   */
  const ensurePermitZoneSet = async () => {
    try {
      const existing = await AsyncStorage.getItem(StorageKeys.HOME_PERMIT_ZONE);
      if (existing) return; // Already set (by user or previous derivation)

      const userId = AuthService.getUser()?.id;
      if (!userId) return;

      const response = await ApiClient.authGet<any>(`/api/user-profile?userId=${userId}`, {
        retries: 1, timeout: 10000, showErrorAlert: false,
      });
      if (!response.success || !response.data) return;

      // 1. Check if permit_zone_number is already on their profile
      const profileZone = response.data.permit_zone_number || response.data.vehicle_zone || '';
      if (profileZone) {
        await AsyncStorage.setItem(StorageKeys.HOME_PERMIT_ZONE, String(profileZone));
        log.info(`Permit zone set from profile: ${profileZone}`);
        return;
      }

      // 2. Derive from home address via permit zone lookup
      const homeAddress = response.data.home_address_full || response.data.street_address || '';
      if (!homeAddress) return;

      const zoneResponse = await ApiClient.get<any>(
        `/api/check-permit-zone?address=${encodeURIComponent(homeAddress)}`,
        { retries: 1, timeout: 10000, showErrorAlert: false },
      );
      if (zoneResponse.success && zoneResponse.data?.hasPermitZone && zoneResponse.data.zones?.length > 0) {
        const derivedZone = String(zoneResponse.data.zones[0].zone);
        await AsyncStorage.setItem(StorageKeys.HOME_PERMIT_ZONE, derivedZone);
        log.info(`Permit zone derived from address "${homeAddress}": ${derivedZone}`);
      }
    } catch (error) {
      log.debug('Permit zone pre-population failed (non-fatal):', error);
    }
  };

  const initializeApp = async () => {
    try {
      // Check onboarding/login status and initialize auth in parallel
      const [onboarded, seenLogin] = await Promise.all([
        AsyncStorage.getItem(StorageKeys.HAS_ONBOARDED),
        AsyncStorage.getItem(StorageKeys.HAS_SEEN_LOGIN),
        AuthService.initialize(),
      ]);

      setHasOnboarded(onboarded === 'true');
      setHasSeenLogin(seenLogin === 'true');

      // Show UI immediately - push notifications can initialize in background
      setIsLoading(false);

      // Defer non-critical services
      setTimeout(async () => {
        try {
          await PushNotificationService.initialize();
          if (AuthService.isAuthenticated()) {
            const pushEnabled = await PushNotificationService.isEnabled();
            if (pushEnabled) {
              await PushNotificationService.registerTokenWithBackend();
            }

            // Pre-populate permit zone from user's address if not already set.
            // This runs at sign-in so the zone is ready before they ever park.
            await ensurePermitZoneSet();
          }
        } catch (error) {
          log.error('Error initializing deferred services', error);
        }
      }, 100);
    } catch (error) {
      log.error('Error initializing app', error);
      setIsLoading(false);
    }
  };

  const handleOnboardingComplete = async () => {
    await AsyncStorage.setItem(StorageKeys.HAS_ONBOARDED, 'true');
    setHasOnboarded(true);
    // Navigate to Login screen after onboarding
    // initialRouteName only works on first mount, so we need explicit navigation
    if (navigationRef.current) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    }
  };

  const handleLoginComplete = async () => {
    await AsyncStorage.setItem(StorageKeys.HAS_SEEN_LOGIN, 'true');
    setHasSeenLogin(true);

    // Navigate to main app FIRST so the user sees immediate feedback
    if (navigationRef.current) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }

    // Request push notification permissions AFTER navigation (non-blocking)
    try {
      await PushNotificationService.requestPermissionAndRegister();
    } catch (error) {
      log.error('Push notification registration failed (non-fatal)', error);
    }
  };

  if (isLoading || !authState || authState.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Determine initial route
  const getInitialRoute = (): keyof RootStackParamList => {
    if (!hasOnboarded) return 'Onboarding';
    if (!authState?.isAuthenticated) return 'Login';
    return 'MainTabs';
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NavigationContainer
        ref={navigationRef}
        linking={DeepLinkingService.getLinkingConfig()}
        onReady={() => {
          // Initialize navigation refs for deep linking and push notifications
          // This is called when navigation container is ready, ensuring safe navigation
          if (navigationRef.current) {
            DeepLinkingService.setNavigationRef(navigationRef.current);
            DeepLinkingService.initialize(navigationRef.current);
            PushNotificationService.setNavigationRef(navigationRef.current);
          }
        }}
      >
        <Stack.Navigator
          initialRouteName={getInitialRoute()}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Onboarding">
            {(props) => (
              <OnboardingScreen
                {...props}
                onComplete={handleOnboardingComplete}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Login">
            {(props) => (
              <LoginScreen
                {...props}
                onAuthSuccess={handleLoginComplete}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="MainTabs" component={MainTabNavigator} />
          <Stack.Screen
            name="CheckDestination"
            component={CheckDestinationScreen}
            options={{
              headerShown: false,
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="BluetoothSettings"
            component={SettingsScreen}
            options={{
              headerShown: true,
              title: 'Pair Your Car',
              headerBackTitle: 'Back',
              headerStyle: {
                backgroundColor: colors.cardBg,
              },
              headerTintColor: colors.primary,
              headerTitleStyle: {
                fontWeight: typography.weights.semibold,
              },
            }}
          />
        </Stack.Navigator>
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: 12,
  },
});

export default App;

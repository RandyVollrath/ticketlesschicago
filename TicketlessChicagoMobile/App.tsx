import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Services
import AuthService from './src/services/AuthService';
import type { AuthState } from './src/services/AuthService';
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
  AccountInactive: undefined;
  MainTabs: undefined;
  BluetoothSettings: undefined;
  CheckDestination: undefined;
  ReportZoneHours: {
    zone?: string;
    currentSchedule?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  } | undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  History: undefined;
  Manage: undefined;
  Settings: { scrollTo?: string } | undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Custom TabBar renderer - extracted to avoid re-creation on each render
const renderTabBar = (props: any) => <TabBar {...props} />;

const getScreen = <T,>(loader: () => T): T => loader();

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
        getComponent={() => getScreen(() => require('./src/screens/HomeScreen').default)}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="Search"
        getComponent={() => getScreen(() => require('./src/screens/CheckDestinationScreen').default)}
        options={{ tabBarLabel: 'Search' }}
        initialParams={{ isTab: true }}
      />
      <Tab.Screen
        name="History"
        getComponent={() => getScreen(() => require('./src/screens/HistoryScreen').default)}
        options={{ tabBarLabel: 'History' }}
      />
      <Tab.Screen
        name="Manage"
        getComponent={() => getScreen(() => require('./src/screens/NativeAlertsScreen').default)}
        options={{ tabBarLabel: 'Manage' }}
      />
      <Tab.Screen
        name="Settings"
        getComponent={() => getScreen(() => require('./src/screens/ProfileScreen').default)}
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
  const [isPaidUser, setIsPaidUser] = useState<boolean | null>(null); // null = not checked yet
  const [linkingConfig, setLinkingConfig] = useState<any>(undefined);
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

  useEffect(() => {
    void import('./src/services/DeepLinkingService').then(({ default: DeepLinkingService }) => {
      setLinkingConfig(DeepLinkingService.getLinkingConfig());
    }).catch((error) => {
      log.error('Error loading deep linking config', error);
    });
  }, []);

  // Note: Deep linking and push notification navigation refs are set in
  // NavigationContainer's onReady callback to ensure navigation is ready

  /**
   * Check if the authenticated user has an active paid account.
   * Returns true if has_contesting is true on their profile.
   */
  const checkPaidStatus = async (): Promise<boolean> => {
    try {
      const supabase = AuthService.getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('has_contesting')
        .eq('user_id', session.user.id)
        .maybeSingle();

      const paid = profileData?.has_contesting === true;
      setIsPaidUser(paid);
      return paid;
    } catch (error) {
      log.error('Error checking paid status', error);
      // On error, allow access (don't lock out due to network issues)
      setIsPaidUser(true);
      return true;
    }
  };

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

      // For authenticated users, check paid status BEFORE showing UI
      // to prevent unpaid users from briefly seeing MainTabs
      if (AuthService.isAuthenticated()) {
        await checkPaidStatus();
      }

      setIsLoading(false);

      // Defer non-critical services
      setTimeout(async () => {
        try {
          const [
            { default: AnalyticsService },
            { default: PushNotificationService },
          ] = await Promise.all([
            import('./src/services/AnalyticsService'),
            import('./src/services/PushNotificationService'),
          ]);

          // Initialize analytics early so it captures sessions
          await AnalyticsService.initialize();
          await AnalyticsService.logAppOpen();

          await PushNotificationService.initialize();
          if (AuthService.isAuthenticated()) {
            const user = AuthService.getUser();
            if (user) {
              await AnalyticsService.setUserId(user.id);
              await AnalyticsService.setUserProperties({
                email_domain: user.email?.split('@')[1] || 'unknown',
              });
            }

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

    // Track login/signup (non-fatal if analytics fails)
    try {
      const user = AuthService.getUser();
      if (user) {
        const { default: AnalyticsService } = await import('./src/services/AnalyticsService');
        await AnalyticsService.setUserId(user.id);
        await AnalyticsService.logLogin('auth');
      }
    } catch (error) {
      log.error('Analytics tracking failed (non-fatal)', error);
    }

    // Check if user has an active paid account
    const paid = await checkPaidStatus();

    if (paid) {
      // Navigate to main app
      if (navigationRef.current) {
        navigationRef.current.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      }
    } else {
      // Navigate to account inactive screen
      if (navigationRef.current) {
        navigationRef.current.reset({
          index: 0,
          routes: [{ name: 'AccountInactive' }],
        });
      }
    }

    // Request push notification permissions AFTER navigation (non-blocking)
    try {
      const { default: PushNotificationService } = await import('./src/services/PushNotificationService');
      await PushNotificationService.requestPermissionAndRegister();
    } catch (error) {
      log.error('Push notification registration failed (non-fatal)', error);
    }
  };

  const handleAccountRetryCheck = async () => {
    const paid = await checkPaidStatus();
    if (paid && navigationRef.current) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  const handleAccountSignOut = () => {
    setIsPaidUser(null);
    setHasSeenLogin(false);
    if (navigationRef.current) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
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
    // If paid status has been checked and user is not paid, show inactive screen
    if (isPaidUser === false) return 'AccountInactive';
    return 'MainTabs';
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NavigationContainer
          ref={navigationRef}
          linking={linkingConfig}
          onStateChange={() => {
            const currentRoute = navigationRef.current?.getCurrentRoute();
            if (currentRoute?.name) {
              void import('./src/services/AnalyticsService').then(({ default: AnalyticsService }) => {
                return AnalyticsService.logScreenView(currentRoute.name!);
              }).catch((error) => {
                log.error('Error logging screen view', error);
              });
            }

            // Navigation guard: redirect unpaid users away from MainTabs
            // This catches deep links, push notifications, and any other
            // navigation that bypasses the normal login flow
            if (isPaidUser === false && navigationRef.current) {
              const state = navigationRef.current.getState();
              const topRoute = state?.routes?.[state.routes.length - 1];
              if (topRoute?.name === 'MainTabs' || topRoute?.name === 'CheckDestination' || topRoute?.name === 'ReportZoneHours' || topRoute?.name === 'BluetoothSettings') {
                log.warn('Unpaid user navigated to protected screen, redirecting to AccountInactive');
                navigationRef.current.reset({
                  index: 0,
                  routes: [{ name: 'AccountInactive' }],
                });
              }
            }
          }}
          onReady={() => {
            // Initialize navigation refs for deep linking and push notifications
            // This is called when navigation container is ready, ensuring safe navigation
            if (!navigationRef.current) return;

            void Promise.all([
              import('./src/services/DeepLinkingService'),
              import('./src/services/PushNotificationService'),
            ]).then(([{ default: DeepLinkingService }, { default: PushNotificationService }]) => {
              DeepLinkingService.setNavigationRef(navigationRef.current);
              void DeepLinkingService.initialize(navigationRef.current);
              PushNotificationService.setNavigationRef(navigationRef.current);
            }).catch((error) => {
              log.error('Error initializing navigation-linked services', error);
            });
          }}
        >
          <Stack.Navigator
            initialRouteName={getInitialRoute()}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Onboarding">
              {(props) => {
                const OnboardingScreen = getScreen(() => require('./src/screens/OnboardingScreen').default);
                return (
                  <OnboardingScreen
                    {...props}
                    onComplete={handleOnboardingComplete}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="Login">
              {(props) => {
                const LoginScreen = getScreen(() => require('./src/screens/LoginScreen').default);
                return (
                  <LoginScreen
                    {...props}
                    onAuthSuccess={handleLoginComplete}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="AccountInactive">
              {(props) => {
                const AccountInactiveScreen = getScreen(() => require('./src/screens/AccountInactiveScreen').default);
                return (
                  <AccountInactiveScreen
                    {...props}
                    onSignOut={handleAccountSignOut}
                    onRetryCheck={handleAccountRetryCheck}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="MainTabs" component={MainTabNavigator} />
            <Stack.Screen
              name="CheckDestination"
              getComponent={() => getScreen(() => require('./src/screens/CheckDestinationScreen').default)}
              options={{
                headerShown: false,
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="ReportZoneHours"
              getComponent={() => getScreen(() => require('./src/screens/ReportZoneHoursScreen').default)}
              options={{
                headerShown: false,
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="BluetoothSettings"
              getComponent={() => getScreen(() => require('./src/screens/SettingsScreen').default)}
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

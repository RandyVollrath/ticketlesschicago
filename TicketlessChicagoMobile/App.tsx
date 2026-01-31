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

// Services
import AuthService, { AuthState } from './src/services/AuthService';
import PushNotificationService from './src/services/PushNotificationService';
import DeepLinkingService from './src/services/DeepLinkingService';

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
};

export type MainTabParamList = {
  Home: undefined;
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
        name="History"
        component={HistoryScreen}
        options={{ tabBarLabel: 'History' }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarLabel: 'Alerts' }}
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

    // Request push notification permissions after login
    await PushNotificationService.requestPermissionAndRegister();

    // Navigate to main app after login
    if (navigationRef.current) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  if (isLoading || authState?.isLoading) {
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
    if (!hasSeenLogin && !authState?.isAuthenticated) return 'Login';
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

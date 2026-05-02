import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform, NativeModules, Linking, AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

// Custom native module for Apple Sign In
const AppleSignInModule = Platform.OS === 'ios' ? NativeModules.AppleSignInModule : null;
import Config from '../config/config';
import Logger from '../utils/Logger';

const log = Logger.createLogger('AuthService');

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Custom storage adapter for React Native
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(key);
  },
};

class AuthServiceClass {
  private supabase: SupabaseClient;
  private authState: AuthState = {
    user: null,
    session: null,
    isAuthenticated: false,
    isLoading: true,
  };

  private listeners: ((state: AuthState) => void)[] = [];
  private googleSignInConfigured = false;

  // Set on AppState=active, cleared on AppState=background. Used by the
  // resilience hooks to skip work the OS will throttle anyway.
  private isAppForegrounded: boolean = true;
  // NetInfo unsubscribe so we can clean up if needed (currently lives for
  // the app's lifetime).
  private netInfoUnsubscribe: (() => void) | null = null;
  private wasOffline: boolean = false;
  private foregroundSubscription: { remove: () => void } | null = null;

  constructor() {
    this.supabase = createClient(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY, {
      auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

    // Listen for auth state changes
    this.supabase.auth.onAuthStateChange((event, session) => {
      log.debug('Auth state changed', event);
      this.updateAuthState(session);
    });

    // BULLETPROOF REFRESH (2026-04-29):
    //
    // Without these listeners, the only way the access token gets refreshed
    // is the supabase-js internal timer — which in React Native pauses while
    // JS is suspended (iOS background). After hours offline, the token is
    // stale, parking checks 401, and the user has no way to recover without
    // signing out manually. Real example: a user spent ~43 hours with 8
    // consecutive auth-expired parking failures because the JS auto-refresh
    // never woke up properly when the app came back.
    //
    // We add three independent recovery hooks so a dead token can come back
    // through ANY of them:
    //   1. App foreground → start Supabase's auto-refresh + immediately try
    //      a refreshSession (covers the "iOS background suspended JS" case)
    //   2. Network came back online → refreshSession (covers the "user was
    //      on bad cellular" case — exactly today's T-Mobile-glitch story)
    //   3. App background → stop the auto-refresh timer so we don't churn
    //      while suspended (Supabase's own RN guidance)
    this.startAppStateRefreshLoop();
    this.startNetworkRecoveryRefresh();
  }

  private startAppStateRefreshLoop(): void {
    this.foregroundSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        this.isAppForegrounded = true;
        try {
          this.supabase.auth.startAutoRefresh();
        } catch (e) {
          log.warn('startAutoRefresh threw', e);
        }
        // Don't await — we want non-blocking. Log result.
        void this._doRefreshToken().then((ok) => {
          if (ok) log.info('Foreground refresh succeeded');
          else log.warn('Foreground refresh did NOT succeed (transient or terminal)');
        });
      } else if (state === 'background' || state === 'inactive') {
        this.isAppForegrounded = false;
        try {
          this.supabase.auth.stopAutoRefresh();
        } catch (e) {
          log.warn('stopAutoRefresh threw', e);
        }
      }
    });
  }

  private startNetworkRecoveryRefresh(): void {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      if (!isOnline) {
        this.wasOffline = true;
        return;
      }
      // Just came back online — refresh proactively. This is the path that
      // covers the "T-Mobile / iOS-background-network-throttle" failure
      // mode where every request hangs and the token quietly expires.
      if (this.wasOffline && this.isAppForegrounded) {
        log.info('Network recovered — proactively refreshing session');
        void this._doRefreshToken();
      }
      this.wasOffline = false;
    });
  }

  private configureGoogleSignIn(): void {
    try {
      GoogleSignin.configure({
        // Only set webClientId - let iOS use CLIENT_ID from GoogleService-Info.plist
        // This configuration avoids nonce issues with Supabase
        webClientId: Config.GOOGLE_WEB_CLIENT_ID,
      });
      this.googleSignInConfigured = true;
      log.info('Google Sign-In configured');
    } catch (error) {
      log.error('Failed to configure Google Sign-In', error);
    }
  }

  /**
   * Configure Google Sign-In lazily instead of during module import.
   * This keeps launch-time native initialization smaller and avoids
   * crashing the whole app before the first screen on devices where
   * Google Play Services / the Google Sign-In module behaves badly.
   */
  private ensureGoogleSignInConfigured(): void {
    if (!this.googleSignInConfigured) {
      this.configureGoogleSignIn();
    }
  }

  private updateAuthState(session: Session | null): void {
    const supabaseUser = session?.user;

    this.authState = {
      user: supabaseUser ? {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        name: supabaseUser.user_metadata?.name || supabaseUser.user_metadata?.full_name,
        createdAt: supabaseUser.created_at,
      } : null,
      session,
      isAuthenticated: !!session,
      isLoading: false,
    };

    this.notifyListeners();
  }

  async initialize(): Promise<AuthState> {
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      log.info(`Auth initialize: session=${!!session}, user=${session?.user?.email || 'none'}`);
      this.updateAuthState(session);
      // Kick the auto-refresh loop on initial launch — the AppState listener
      // only fires on transitions, so the first foreground session needs an
      // explicit start. Safe to call even if startAppStateRefreshLoop has
      // already started it.
      try {
        this.supabase.auth.startAutoRefresh();
      } catch (e) {
        log.warn('initial startAutoRefresh threw', e);
      }
      // If we have a session, refresh now so any token that aged while the
      // app was killed gets renewed before the first parking check fires.
      if (session) {
        void this._doRefreshToken();
      }
    } catch (error) {
      log.error('Error initializing auth', error);
      this.authState.isLoading = false;
    }
    return this.authState;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    // Immediately call with current state
    log.debug(`subscribe: delivering current state (authenticated=${this.authState.isAuthenticated}, user=${this.authState.user?.email || 'none'}, listeners=${this.listeners.length})`);
    listener(this.authState);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.authState));
  }

  async signInWithEmail(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      log.error('Sign in error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  async signUpWithEmail(
    email: string,
    password: string,
    name?: string
  ): Promise<{ success: boolean; error?: string; needsVerification?: boolean }> {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            full_name: name,
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        return { success: true, needsVerification: true };
      }

      return { success: true };
    } catch (error) {
      log.error('Sign up error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  async signInWithMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Redirect directly to the app's custom scheme — bypasses the slow web callback page
      // Supabase will 302 redirect to this URL with tokens in the hash fragment
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'ticketlesschicago://auth/callback',
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      log.error('Magic link error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  async signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
    this.ensureGoogleSignInConfigured();

    if (!this.googleSignInConfigured) {
      return { success: false, error: 'Google Sign-In is not configured' };
    }

    try {
      // Check if device has Google Play Services (no-op on iOS but required for Android)
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Clear any cached Google session before signing in. Without this, the
      // native SDK can resolve signIn() with a previously-cached user whose
      // idToken is nil/expired (especially on iOS App Store builds), which
      // surfaces to the user as "Failed to get Google ID token" with no
      // recovery path. Forcing a fresh interactive sign-in avoids this.
      try {
        await GoogleSignin.signOut();
      } catch (e) {
        // signOut throws if no user is signed in — safe to ignore.
        log.debug('GoogleSignin.signOut() pre-sign-in no-op', e);
      }

      // Sign in with Google natively
      const userInfo = await GoogleSignin.signIn();

      log.info(`Google sign-in response received: type=${userInfo?.type}`);

      // v13+ returns { type: 'cancelled' } instead of throwing on user cancel.
      if (userInfo?.type === 'cancelled') {
        return { success: false, error: 'Sign in was cancelled' };
      }

      let idToken = userInfo.data?.idToken ?? null;

      // The Google iOS SDK occasionally returns a successful signIn() result
      // with a nil idToken (timing race between sign-in and token issuance).
      // getTokens() forces a network refresh of the current user's tokens.
      if (!idToken) {
        log.warn('signIn() returned no idToken, falling back to getTokens()');
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens?.idToken ?? null;
        } catch (e) {
          log.error('getTokens() fallback failed', e);
        }
      }

      if (!idToken) {
        log.error('No idToken after signIn() and getTokens() fallback', {
          hasUser: !!userInfo.data?.user,
          email: userInfo.data?.user?.email,
        });
        return {
          success: false,
          error: 'Google did not return a sign-in token. Please try again, or use Sign in with Apple.',
        };
      }

      log.info('Got Google ID token, authenticating with Supabase');

      // Authenticate with Supabase using the Google ID token
      const { data, error } = await this.supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        log.error('Supabase Google auth error', error);
        return { success: false, error: error.message };
      }

      // Eagerly update auth state before returning — don't wait for onAuthStateChange
      // which fires asynchronously and causes a race condition where callers see
      // isAuthenticated()=false immediately after a successful sign-in.
      if (data?.session) {
        this.updateAuthState(data.session);
      }

      log.info('Supabase authentication successful');
      return { success: true };
    } catch (error: any) {
      log.error('Google sign-in error', error);

      // Handle specific Google Sign-In errors
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { success: false, error: 'Sign in was cancelled' };
      } else if (error.code === statusCodes.IN_PROGRESS) {
        return { success: false, error: 'Sign in is already in progress' };
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { success: false, error: 'Google Play Services not available' };
      }

      return { success: false, error: error.message || 'Google sign-in failed' };
    }
  }

  async signInWithApple(): Promise<{ success: boolean; error?: string }> {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Sign in with Apple is only available on iOS' };
    }

    // Try native ASAuthorizationController first (best UX — shows native Apple sheet)
    if (AppleSignInModule) {
      try {
        log.info('Attempting native Apple Sign In via ASAuthorizationController');
        const result = await AppleSignInModule.performSignIn();

        if (!result.identityToken) {
          log.error('No identityToken in Apple auth response');
          return { success: false, error: 'Failed to get Apple identity token. Please try again.' };
        }

        log.info('Got Apple identity token, authenticating with Supabase');

        const { data, error } = await this.supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: result.identityToken,
          nonce: result.nonce,
        });

        if (error) {
          log.error('Supabase Apple auth error', { message: error.message, status: error.status });
          return { success: false, error: `Apple sign-in failed: ${error.message}` };
        }

        if (data?.session) {
          this.updateAuthState(data.session);
        }

        log.info('Supabase Apple authentication successful (native)');
        return { success: true };
      } catch (nativeError: any) {
        // Error 1001 = user cancelled — don't fall through
        if (nativeError.code === '1001' || nativeError.code === 1001) {
          return { success: false, error: 'Sign in was cancelled' };
        }

        // Error 1000 = entitlement/provisioning issue — fall through to OAuth
        log.warn('Native Apple Sign In failed, falling back to OAuth flow', {
          code: nativeError.code,
          message: nativeError.message,
        });
      }
    }

    // Fallback: Supabase OAuth flow via Safari
    // This works without the Sign in with Apple entitlement in the provisioning profile
    try {
      log.info('Starting Apple Sign In via Supabase OAuth flow (Safari)');

      const redirectTo = 'ticketlesschicago://auth/callback';
      const oauthUrl = `${Config.SUPABASE_URL}/auth/v1/authorize?provider=apple&redirect_to=${encodeURIComponent(redirectTo)}`;

      const canOpen = await Linking.canOpenURL(oauthUrl);
      if (!canOpen) {
        return { success: false, error: 'Cannot open browser for Apple sign-in. Please try email sign in.' };
      }

      await Linking.openURL(oauthUrl);

      // Auth completion happens asynchronously via deep link callback
      // (DeepLinkingService handles ticketlesschicago://auth/callback)
      log.info('Apple OAuth flow launched in Safari');
      return { success: true };
    } catch (error: any) {
      log.error('Apple OAuth sign-in error', { message: error.message });
      return {
        success: false,
        error: 'Failed to open Apple sign-in. Please try signing in with email instead.',
      };
    }
  }

  async signOutGoogle(): Promise<void> {
    try {
      await GoogleSignin.signOut();
    } catch (error) {
      log.error('Google sign-out error', error);
    }
  }

  async signOut(): Promise<void> {
    await this.signOutGoogle();
    await this.supabase.auth.signOut();
    log.info('User signed out');
  }

  /**
   * Delete the user's account (soft delete on server, then sign out).
   * Calls DELETE /api/users?userId={id} which anonymizes profile data,
   * then signs the user out locally.
   */
  async deleteAccount(): Promise<{ success: boolean; error?: string }> {
    const user = this.getUser();
    const token = this.getToken();

    if (!user || !token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(
        `${Config.API_BASE_URL}/api/users?userId=${user.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return { success: false, error: body.error || `Server error (${response.status})` };
      }

      // Sign out locally after successful server-side deletion
      await this.signOut();
      log.info('Account deleted and signed out');
      return { success: true };
    } catch (error: any) {
      log.error('Account deletion error', error);
      return { success: false, error: 'Network error. Please check your connection and try again.' };
    }
  }

  // Mutex for token refresh — prevents concurrent 401 responses from each
  // triggering independent refreshSession() calls that invalidate each other.
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * Attempt to refresh the authentication token
   * Returns true if refresh was successful, false otherwise
   */
  async refreshToken(): Promise<boolean> {
    // If a refresh is already in flight, piggyback on it instead of starting
    // a second concurrent refresh (which would invalidate the first).
    if (this.refreshPromise) {
      log.debug('Token refresh already in flight, waiting on existing attempt');
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefreshToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  // When refreshSession() fails repeatedly with a terminal error (refresh
  // token expired or invalidated), no future automatic recovery is possible
  // and the user has to sign in again. The previous code returned false on
  // every failure and refused to sign out, which left users in a broken
  // state where every parking check returned 401 forever. Real example:
  // randyvollrath@gmail.com 2026-04-29 — last parking success 2026-04-28
  // 01:05 UTC, then 8 consecutive auth-expired failures over ~43 hours
  // because the refresh token was dead but the app kept its session.
  private consecutiveRefreshFailures: number = 0;
  private static readonly TERMINAL_REFRESH_FAILURE_THRESHOLD = 3;

  private async _doRefreshToken(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.auth.refreshSession();

      if (error) {
        log.error('Token refresh failed', error);
        this.consecutiveRefreshFailures++;
        await this.maybeForceSignOutOnTerminalFailure(error);
        return false;
      }

      if (data.session) {
        this.updateAuthState(data.session);
        this.consecutiveRefreshFailures = 0;
        log.info('Token refreshed successfully');
        return true;
      }

      this.consecutiveRefreshFailures++;
      return false;
    } catch (error) {
      log.error('Token refresh error', error);
      this.consecutiveRefreshFailures++;
      return false;
    }
  }

  /**
   * Decide whether the refresh failure is terminal (refresh token dead) and
   * if so, sign out so the user is forced into the login flow on next app
   * use. Three signals make a failure "terminal":
   *   1. Supabase returned a known invalid-grant error code/message
   *   2. We've now hit TERMINAL_REFRESH_FAILURE_THRESHOLD consecutive failures
   *      (transient causes like iOS-background JS suspension don't repeat
   *       reliably — sustained failure means the token is gone)
   *   3. We have no session at all anymore (already broken)
   * Network-only failures (no internet) are NOT terminal — those return
   * before we reach Supabase and don't increment our counter via the
   * `error.message` path.
   */
  private async maybeForceSignOutOnTerminalFailure(error: any): Promise<void> {
    const msg = String(error?.message || '').toLowerCase();
    const code = String(error?.code || error?.name || '').toLowerCase();
    const knownTerminal =
      code.includes('refresh_token_not_found') ||
      code.includes('refresh_token_already_used') ||
      code.includes('invalid_grant') ||
      msg.includes('refresh token') ||
      msg.includes('invalid grant') ||
      msg.includes('not authenticated');
    const repeatedTerminal =
      this.consecutiveRefreshFailures >= AuthServiceClass.TERMINAL_REFRESH_FAILURE_THRESHOLD;
    if (!knownTerminal && !repeatedTerminal) return;
    log.warn(
      `Terminal refresh failure detected (knownTerminal=${knownTerminal}, ` +
      `consecutiveFailures=${this.consecutiveRefreshFailures}). Signing out so user can re-auth.`,
    );
    try {
      await this.supabase.auth.signOut();
    } catch (signOutErr) {
      log.error('signOut after terminal refresh failure threw', signOutErr);
      // Force-clear local state even if signOut threw — the auth listener
      // may not fire, but we don't want to leave the user stuck.
      this.updateAuthState(null);
    }
    this.consecutiveRefreshFailures = 0;
  }

  /**
   * Handle authentication errors (401/403)
   * Attempts token refresh, triggers logout if refresh fails
   */
  async handleAuthError(): Promise<boolean> {
    log.warn('Handling auth error, attempting token refresh');

    const refreshed = await this.refreshToken();

    if (!refreshed) {
      // We do NOT sign out on every transient refresh failure (network blip,
      // iOS-background JS suspension). _doRefreshToken handles terminal
      // failures (specific error codes or sustained consecutive failures)
      // by signing out so the user gets routed back to the login flow.
      log.warn('Token refresh failed (transient — keeping session for next attempt)');
      return false;
    }

    return true;
  }

  async sendPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'ticketlesschicago://auth/reset-password',
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      log.error('Password reset error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  getAuthState(): AuthState {
    return this.authState;
  }

  getToken(): string | null {
    return this.authState.session?.access_token || null;
  }

  getUser(): User | null {
    return this.authState.user;
  }

  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  isLoading(): boolean {
    return this.authState.isLoading;
  }

  // Get the Supabase client for direct queries if needed
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  // Helper for authenticated API requests to your backend
  async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getToken();

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }
}

export default new AuthServiceClass();

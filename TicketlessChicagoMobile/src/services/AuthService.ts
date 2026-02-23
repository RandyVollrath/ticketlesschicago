import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { Platform } from 'react-native';
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

    // Configure Google Sign-In
    this.configureGoogleSignIn();
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
    if (!this.googleSignInConfigured) {
      return { success: false, error: 'Google Sign-In is not configured' };
    }

    try {
      // Check if device has Google Play Services (no-op on iOS but required for Android)
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Sign in with Google natively
      const userInfo = await GoogleSignin.signIn();

      log.info('Google sign-in response received');

      if (!userInfo.data?.idToken) {
        log.error('No idToken in userInfo');
        return { success: false, error: 'Failed to get Google ID token. Please try again.' };
      }

      log.info('Got Google ID token, authenticating with Supabase');

      // Authenticate with Supabase using the Google ID token
      const { data, error } = await this.supabase.auth.signInWithIdToken({
        provider: 'google',
        token: userInfo.data.idToken,
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

    if (!appleAuth.isSupported) {
      return { success: false, error: 'Sign in with Apple is not supported on this device' };
    }

    try {
      // Perform the Apple auth request
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });

      // Ensure the request was successful
      const credentialState = await appleAuth.getCredentialStateForUser(
        appleAuthRequestResponse.user,
      );

      if (credentialState !== appleAuth.State.AUTHORIZED) {
        return { success: false, error: 'Apple authorization failed' };
      }

      if (!appleAuthRequestResponse.identityToken) {
        log.error('No identityToken in Apple auth response');
        return { success: false, error: 'Failed to get Apple identity token. Please try again.' };
      }

      log.info('Got Apple identity token, authenticating with Supabase');

      // Authenticate with Supabase using the Apple identity token.
      // The library auto-generates a nonce (hashed) in the identity token,
      // so we must pass the raw nonce to Supabase for verification.
      const { data, error } = await this.supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: appleAuthRequestResponse.identityToken,
        nonce: appleAuthRequestResponse.nonce,
      });

      if (error) {
        log.error('Supabase Apple auth error', error);
        return { success: false, error: error.message };
      }

      // Eagerly update auth state before returning — don't wait for onAuthStateChange
      // which fires asynchronously and causes a race condition where callers see
      // isAuthenticated()=false immediately after a successful sign-in.
      if (data?.session) {
        this.updateAuthState(data.session);
      }

      log.info('Supabase Apple authentication successful');
      return { success: true };
    } catch (error: any) {
      log.error('Apple sign-in error', error);

      // Handle user cancellation
      if (error.code === appleAuth.Error.CANCELED) {
        return { success: false, error: 'Sign in was cancelled' };
      }

      return { success: false, error: error.message || 'Apple sign-in failed' };
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

  /**
   * Attempt to refresh the authentication token
   * Returns true if refresh was successful, false otherwise
   */
  async refreshToken(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.auth.refreshSession();

      if (error) {
        log.error('Token refresh failed', error);
        return false;
      }

      if (data.session) {
        this.updateAuthState(data.session);
        log.info('Token refreshed successfully');
        return true;
      }

      return false;
    } catch (error) {
      log.error('Token refresh error', error);
      return false;
    }
  }

  /**
   * Handle authentication errors (401/403)
   * Attempts token refresh, triggers logout if refresh fails
   */
  async handleAuthError(): Promise<boolean> {
    log.warn('Handling auth error, attempting token refresh');

    const refreshed = await this.refreshToken();

    if (!refreshed) {
      log.warn('Token refresh failed, signing out user');
      await this.signOut();
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

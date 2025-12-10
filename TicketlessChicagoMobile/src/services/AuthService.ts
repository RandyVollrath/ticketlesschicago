import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
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

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    log.info('User signed out');
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

/**
 * AuthService Unit Tests
 */

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock Supabase client
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockOnAuthStateChange = jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signInWithOtp: mockSignInWithOtp,
      signOut: mockSignOut,
      getSession: mockGetSession,
      getUser: mockGetUser,
      resetPasswordForEmail: mockResetPasswordForEmail,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

// Import after mocks
import AuthService from '../../src/services/AuthService';

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signInWithEmail', () => {
    it('should return success on valid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: {} },
        error: null,
      });

      const result = await AuthService.signInWithEmail('test@example.com', 'password');

      expect(result.success).toBe(true);
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });

    it('should return error on invalid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid credentials' },
      });

      const result = await AuthService.signInWithEmail('test@example.com', 'wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('should handle network errors', async () => {
      mockSignInWithPassword.mockRejectedValue(new Error('Network error'));

      const result = await AuthService.signInWithEmail('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error. Please try again.');
    });
  });

  describe('signUpWithEmail', () => {
    it('should return success on valid signup', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: { id: '123' }, session: {} },
        error: null,
      });

      const result = await AuthService.signUpWithEmail('new@example.com', 'password', 'Test User');

      expect(result.success).toBe(true);
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password',
        options: {
          data: {
            name: 'Test User',
            full_name: 'Test User',
          },
        },
      });
    });

    it('should indicate email verification needed', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: { id: '123' }, session: null },
        error: null,
      });

      const result = await AuthService.signUpWithEmail('new@example.com', 'password');

      expect(result.success).toBe(true);
      expect(result.needsVerification).toBe(true);
    });

    it('should return error for existing email', async () => {
      mockSignUp.mockResolvedValue({
        data: null,
        error: { message: 'User already registered' },
      });

      const result = await AuthService.signUpWithEmail('existing@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User already registered');
    });
  });

  describe('signInWithMagicLink', () => {
    it('should send magic link successfully', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await AuthService.signInWithMagicLink('test@example.com');

      expect(result.success).toBe(true);
      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        options: {
          emailRedirectTo: 'ticketlesschicago://auth/callback',
        },
      });
    });

    it('should return error on invalid email', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: null,
        error: { message: 'Invalid email' },
      });

      const result = await AuthService.signInWithMagicLink('invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email');
    });
  });

  describe('signOut', () => {
    it('should sign out successfully', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      await AuthService.signOut();

      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await AuthService.sendPasswordReset('test@example.com');

      expect(result.success).toBe(true);
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('test@example.com', {
        redirectTo: 'ticketlesschicago://auth/reset-password',
      });
    });

    it('should return error for non-existent email', async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        data: null,
        error: { message: 'User not found' },
      });

      const result = await AuthService.sendPasswordReset('nonexistent@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found');
    });
  });

  describe('initialize', () => {
    it('should initialize and get existing session', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'token',
            user: { id: '123', email: 'test@example.com', created_at: '2024-01-01' },
          },
        },
        error: null,
      });

      const result = await AuthService.initialize();

      expect(result.isAuthenticated).toBe(true);
      expect(result.isLoading).toBe(false);
    });

    it('should handle no existing session', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await AuthService.initialize();

      expect(result.isAuthenticated).toBe(false);
      expect(result.isLoading).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should call listener immediately with current state', () => {
      const listener = jest.fn();

      AuthService.subscribe(listener);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          isLoading: expect.any(Boolean),
          isAuthenticated: expect.any(Boolean),
        })
      );
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();

      const unsubscribe = AuthService.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('getToken', () => {
    it('should return null when not authenticated', () => {
      const token = AuthService.getToken();

      expect(token).toBeNull();
    });
  });

  describe('authenticatedFetch', () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    beforeEach(() => {
      mockFetch.mockClear();
    });

    it('should add Content-Type header', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await AuthService.authenticatedFetch('https://api.example.com/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should pass through custom options', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await AuthService.authenticatedFetch('https://api.example.com/test', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: 'test' }),
        })
      );
    });
  });
});

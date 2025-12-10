/**
 * DeepLinkingService Unit Tests
 */

// Mock dependencies
jest.mock('react-native', () => ({
  Linking: {
    getInitialURL: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  Platform: { OS: 'ios' },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock AuthService
const mockSetSession = jest.fn();
jest.mock('../../src/services/AuthService', () => ({
  __esModule: true,
  default: {
    getSupabaseClient: () => ({
      auth: {
        setSession: mockSetSession,
      },
    }),
    isAuthenticated: jest.fn(() => false),
  },
}));

// Import after mocks
import DeepLinkingService, { DEEP_LINK_ROUTES } from '../../src/services/DeepLinkingService';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('DeepLinkingService', () => {
  let mockNavigationRef: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigationRef = {
      isReady: jest.fn(() => true),
      reset: jest.fn(),
      navigate: jest.fn(),
    };
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);

      await expect(DeepLinkingService.initialize(mockNavigationRef)).resolves.not.toThrow();
    });

    it('should handle initial URL on app open', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(
        'ticketlesschicago://parking/history'
      );

      await DeepLinkingService.initialize(mockNavigationRef);

      expect(Linking.getInitialURL).toHaveBeenCalled();
    });

    it('should set up URL listener', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);

      await DeepLinkingService.initialize(mockNavigationRef);

      expect(Linking.addEventListener).toHaveBeenCalledWith('url', expect.any(Function));
    });
  });

  describe('handleUrl', () => {
    beforeEach(async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);
      DeepLinkingService.setNavigationRef(mockNavigationRef);
    });

    it('should handle custom scheme URL', async () => {
      const result = await DeepLinkingService.handleUrl('ticketlesschicago://parking/history');

      expect(result).toBe(true);
    });

    it('should handle https scheme URL', async () => {
      const result = await DeepLinkingService.handleUrl('https://ticketless.fyi/parking/history');

      expect(result).toBe(true);
    });

    it('should handle auth callback with tokens', async () => {
      mockSetSession.mockResolvedValue({ error: null });

      const url = 'ticketlesschicago://auth/callback?access_token=abc123&refresh_token=xyz789';
      await DeepLinkingService.handleUrl(url);

      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'abc123',
        refresh_token: 'xyz789',
      });
    });

    it('should handle auth callback error', async () => {
      const url = 'ticketlesschicago://auth/callback?error_description=Invalid%20link';
      const result = await DeepLinkingService.handleUrl(url);

      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('should navigate to main after successful auth', async () => {
      mockSetSession.mockResolvedValue({ error: null });

      const url = 'ticketlesschicago://auth/callback?access_token=abc&refresh_token=xyz';
      await DeepLinkingService.handleUrl(url);

      expect(mockNavigationRef.reset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    });

    it('should handle parking check with coordinates', async () => {
      const url = 'ticketlesschicago://parking/check?lat=41.8781&lng=-87.6298';
      await DeepLinkingService.handleUrl(url);

      expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'Map',
        params: {
          latitude: 41.8781,
          longitude: -87.6298,
        },
      });
    });

    it('should return false for unknown routes', async () => {
      const result = await DeepLinkingService.handleUrl('ticketlesschicago://unknown/route');

      expect(result).toBe(false);
    });

    it('should handle hash fragment for Supabase auth', async () => {
      mockSetSession.mockResolvedValue({ error: null });

      const url = 'https://ticketless.fyi/auth/callback#access_token=abc&refresh_token=xyz&type=magiclink';
      await DeepLinkingService.handleUrl(url);

      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'abc',
        refresh_token: 'xyz',
      });
    });
  });

  describe('generateDeepLink', () => {
    it('should generate deep link without params', () => {
      const url = DeepLinkingService.generateDeepLink(DEEP_LINK_ROUTES.PARKING_HISTORY);

      expect(url).toBe('ticketlesschicago://parking/history');
    });

    it('should generate deep link with params', () => {
      const url = DeepLinkingService.generateDeepLink(DEEP_LINK_ROUTES.PARKING_CHECK, {
        lat: '41.8781',
        lng: '-87.6298',
      });

      expect(url).toBe('ticketlesschicago://parking/check?lat=41.8781&lng=-87.6298');
    });
  });

  describe('canOpenUrl', () => {
    it('should check if URL can be opened', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

      const result = await DeepLinkingService.canOpenUrl('https://google.com');

      expect(result).toBe(true);
      expect(Linking.canOpenURL).toHaveBeenCalledWith('https://google.com');
    });
  });

  describe('openUrl', () => {
    it('should open URL if possible', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

      await DeepLinkingService.openUrl('https://google.com');

      expect(Linking.openURL).toHaveBeenCalledWith('https://google.com');
    });

    it('should not open URL if not possible', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      await DeepLinkingService.openUrl('invalid://url');

      expect(Linking.openURL).not.toHaveBeenCalled();
    });
  });

  describe('getLinkingConfig', () => {
    it('should return valid linking configuration', () => {
      const config = DeepLinkingService.getLinkingConfig();

      expect(config.prefixes).toContain('ticketlesschicago://');
      expect(config.prefixes).toContain('https://ticketless.fyi');
      expect(config.config.screens).toBeDefined();
    });

    it('should include all navigation screens', () => {
      const config = DeepLinkingService.getLinkingConfig();

      expect(config.config.screens.MainTabs).toBeDefined();
      expect(config.config.screens.MainTabs.screens.Home).toBe('home');
      expect(config.config.screens.MainTabs.screens.Map).toBe('map');
      expect(config.config.screens.MainTabs.screens.History).toBe('history');
    });
  });

  describe('registerHandler', () => {
    it('should allow registering custom handlers', () => {
      const customHandler = jest.fn();

      DeepLinkingService.registerHandler('custom/route', customHandler);

      // Handler should be registered successfully
      expect(() => DeepLinkingService.registerHandler('custom/route', customHandler)).not.toThrow();
    });
  });

  describe('setNavigationRef', () => {
    it('should set navigation reference', () => {
      const newRef = { navigate: jest.fn() };

      DeepLinkingService.setNavigationRef(newRef);

      // No error should be thrown
      expect(() => DeepLinkingService.setNavigationRef(newRef)).not.toThrow();
    });
  });
});

/**
 * Type declarations for modules that don't have TypeScript types
 */

// Global declarations for Jest tests
declare var global: typeof globalThis & {
  fetch: typeof fetch;
};

// React Native Firebase Messaging
declare module '@react-native-firebase/messaging' {
  export interface FirebaseMessagingTypes {
    AuthorizationStatus: {
      NOT_DETERMINED: number;
      DENIED: number;
      AUTHORIZED: number;
      PROVISIONAL: number;
    };
  }

  export interface RemoteMessage {
    notification?: {
      title?: string;
      body?: string;
    };
    data?: Record<string, string>;
    messageId?: string;
  }

  export interface Messaging {
    (): MessagingModule;
    AuthorizationStatus: FirebaseMessagingTypes['AuthorizationStatus'];
  }

  export interface MessagingModule {
    requestPermission(): Promise<number>;
    getToken(): Promise<string>;
    deleteToken(): Promise<void>;
    onMessage(listener: (message: RemoteMessage) => any): () => void;
    onTokenRefresh(listener: (token: string) => any): () => void;
    setBackgroundMessageHandler(handler: (message: RemoteMessage) => Promise<any>): void;
    getInitialNotification(): Promise<RemoteMessage | null>;
  }

  const messaging: Messaging;
  export default messaging;
}

// React Native Vector Icons
declare module 'react-native-vector-icons/MaterialCommunityIcons' {
  import { Component } from 'react';
  import { TextProps } from 'react-native';

  interface IconProps extends TextProps {
    name: string;
    size?: number;
    color?: string;
  }

  export default class MaterialCommunityIcons extends Component<IconProps> {}
}

declare module 'react-native-vector-icons/Ionicons' {
  import { Component } from 'react';
  import { TextProps } from 'react-native';

  interface IconProps extends TextProps {
    name: string;
    size?: number;
    color?: string;
  }

  export default class Ionicons extends Component<IconProps> {}
}

// React Native WebView
declare module 'react-native-webview' {
  import { Component } from 'react';
  import { ViewProps } from 'react-native';

  interface WebViewProps extends ViewProps {
    source?: { uri: string } | { html: string };
    injectedJavaScript?: string;
    onLoadStart?: (event: any) => void;
    onLoadEnd?: (event: any) => void;
    onError?: (event: any) => void;
    onHttpError?: (event: any) => void;
    startInLoadingState?: boolean;
    renderLoading?: () => React.ReactElement;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    sharedCookiesEnabled?: boolean;
    thirdPartyCookiesEnabled?: boolean;
    cacheEnabled?: boolean;
    userAgent?: string;
  }

  export class WebView extends Component<WebViewProps> {
    reload(): void;
    goBack(): void;
    goForward(): void;
    injectJavaScript(script: string): void;
  }
}

// NetInfo
declare module '@react-native-community/netinfo' {
  export interface NetInfoState {
    type: string;
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    details: any;
  }

  export interface NetInfo {
    fetch(): Promise<NetInfoState>;
    addEventListener(listener: (state: NetInfoState) => void): () => void;
  }

  const NetInfo: NetInfo;
  export default NetInfo;
}

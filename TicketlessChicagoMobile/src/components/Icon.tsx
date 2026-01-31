import React from 'react';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { colors } from '../theme';

export type IconSet = 'material' | 'ionicons';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  set?: IconSet;
}

/**
 * Unified icon component wrapping react-native-vector-icons.
 * Defaults to MaterialCommunityIcons which has the broadest set.
 *
 * Usage:
 *   <Icon name="car" size={24} color={colors.primary} />
 *   <Icon name="chevron-forward" set="ionicons" />
 */
const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = colors.textPrimary,
  set = 'material',
}) => {
  if (set === 'ionicons') {
    return <Ionicons name={name} size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
};

// Pre-defined icon mappings for the app
export const AppIcons = {
  // Tab bar
  home: 'home',
  homeOutline: 'home-outline',
  history: 'history',
  historyOutline: 'clock-outline',
  settings: 'cog',
  settingsOutline: 'cog-outline',

  // Parking & driving
  car: 'car',
  carConnected: 'car-connected',
  parking: 'parking',
  mapMarker: 'map-marker',
  mapMarkerCheck: 'map-marker-check',
  mapMarkerAlert: 'map-marker-alert',
  navigation: 'navigation-variant',
  directions: 'directions',

  // Status
  checkCircle: 'check-circle',
  checkCircleOutline: 'check-circle-outline',
  alertCircle: 'alert-circle',
  alertCircleOutline: 'alert-circle-outline',
  alert: 'alert',
  shield: 'shield-check',
  shieldOutline: 'shield-check-outline',

  // Weather / rules
  snowflake: 'snowflake',
  broom: 'broom',
  clock: 'clock-outline',
  calendarClock: 'calendar-clock',
  timerSand: 'timer-sand',

  // Actions
  bluetooth: 'bluetooth',
  bluetoothConnect: 'bluetooth-connect',
  refresh: 'refresh',
  chevronRight: 'chevron-right',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  close: 'close',
  plus: 'plus',
  delete: 'delete-outline',

  // Profile / settings
  account: 'account-circle',
  accountOutline: 'account-circle-outline',
  bell: 'bell',
  bellOutline: 'bell-outline',
  bellAlert: 'bell-alert',
  fingerprint: 'fingerprint',
  lock: 'lock',
  logout: 'logout',
  trash: 'trash-can-outline',
  web: 'web',
  email: 'email-outline',
  fileDocument: 'file-document-outline',
  information: 'information-outline',

  // Misc
  lightbulb: 'lightbulb-outline',
  road: 'road',
  gps: 'crosshairs-gps',
  signal: 'signal-cellular-3',
  wifiOff: 'wifi-off',
  pause: 'pause-circle',
  play: 'play-circle',
  locationEnter: 'location-enter',
  locationExit: 'location-exit',
  carOff: 'car-off',
} as const;

export default Icon;

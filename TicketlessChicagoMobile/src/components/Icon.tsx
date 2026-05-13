import React from 'react';
import { StyleProp, ViewStyle, TextStyle } from 'react-native';
import * as Lucide from 'lucide-react-native';
import { colors } from '../theme';

export type IconSet = 'material' | 'ionicons';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  // Retained for backward compatibility; ignored. All icons render as Lucide
  // outline glyphs to match autopilotamerica.com (Heroicons outline style).
  set?: IconSet;
  strokeWidth?: number;
  // Lucide forwards SvgProps style; many callers passed style to MCI to nudge
  // alignment (marginRight, marginTop, etc.). Accept either Text or View style.
  style?: StyleProp<ViewStyle | TextStyle>;
}

// Map kebab-case names (MCI style — what the rest of the app passes in) to
// Lucide PascalCase component names. Lucide is outline-only, matching web's
// Heroicons outline style, so `-outline` variants collapse to the same icon.
const NAME_MAP: Record<string, string> = {
  // Tab bar / shields
  'shield-check': 'ShieldCheck',
  'shield-check-outline': 'ShieldCheck',
  'shield': 'ShieldCheck',

  // Car & parking
  'car': 'Car',
  'car-outline': 'Car',
  'car-off': 'CarFront',
  'car-connected': 'Car',
  'parking': 'SquareParking',

  // Maps / pins / navigation
  'map': 'Map',
  'map-outline': 'Map',
  'map-search': 'SearchCheck',
  'map-search-outline': 'SearchCheck',
  'map-marker': 'MapPin',
  'map-marker-outline': 'MapPin',
  'map-marker-check': 'MapPinCheck',
  'map-marker-check-outline': 'MapPinCheck',
  'map-marker-off': 'MapPinOff',
  'map-marker-alert': 'MapPin',
  'map-marker-question-outline': 'MapPin',
  'map-marker-radius': 'MapPin',
  'home-map-marker': 'MapPinHouse',
  'directions': 'Signpost',
  'navigation-variant': 'Navigation',
  'crosshairs-gps': 'Crosshair',
  'gps': 'Crosshair',

  // Home / settings
  'home': 'House',
  'home-outline': 'House',
  'history': 'History',
  'cog': 'Settings',
  'cog-outline': 'Settings',
  'settings': 'Settings',

  // Status / alerts
  'check': 'Check',
  'check-circle': 'CircleCheck',
  'check-circle-outline': 'CircleCheck',
  'alert': 'TriangleAlert',
  'alert-circle': 'CircleAlert',
  'alert-circle-outline': 'CircleAlert',
  'close': 'X',
  'close-circle': 'CircleX',
  'close-circle-outline': 'CircleX',
  'plus': 'Plus',
  'information-outline': 'Info',
  'information': 'Info',

  // Time / clock
  'clock': 'Clock',
  'clock-outline': 'Clock',
  'calendar-clock': 'CalendarClock',
  'timer-outline': 'Timer',
  'timer-sand': 'Hourglass',

  // Weather / rules
  'snowflake': 'Snowflake',
  'broom': 'PaintBucket',

  // Bell / notifications
  'bell': 'Bell',
  'bell-outline': 'Bell',
  'bell-ring': 'BellRing',
  'bell-ring-outline': 'BellRing',
  'bell-alert': 'BellRing',
  'bell-off': 'BellOff',

  // Profile / account
  'account-circle': 'CircleUser',
  'account-circle-outline': 'CircleUser',
  'account': 'CircleUser',
  'card-account-details-outline': 'IdCard',
  'lock': 'Lock',
  'logout': 'LogOut',
  'fingerprint': 'Fingerprint',

  // Actions
  'pencil': 'Pencil',
  'pencil-outline': 'Pencil',
  'trash-can-outline': 'Trash2',
  'trash': 'Trash2',
  'delete-outline': 'Trash2',
  'refresh': 'RefreshCw',
  'refresh-off': 'RefreshCwOff',
  'share-variant': 'Share2',
  'arrow-expand': 'Maximize2',
  'clipboard-edit-outline': 'ClipboardPen',
  'play-circle-outline': 'CirclePlay',
  'play-circle': 'CirclePlay',
  'pause-circle': 'CirclePause',
  'rocket-launch-outline': 'Rocket',

  // Hardware / signal
  'bluetooth': 'Bluetooth',
  'bluetooth-connect': 'Bluetooth',
  'wifi-off': 'WifiOff',
  'phone': 'Phone',
  'camera': 'Camera',
  'volume-high': 'Volume2',
  'volume-low': 'Volume1',
  'signal-cellular-3': 'Signal',
  'battery-alert': 'BatteryWarning',
  'battery-alert-variant-outline': 'BatteryWarning',

  // Misc
  'email-outline': 'Mail',
  'web': 'Globe',
  'file-document-outline': 'FileText',
  'ticket-percent-outline': 'TicketPercent',
  'piggy-bank-outline': 'PiggyBank',
  'lightbulb-outline': 'Lightbulb',
  'road': 'Milestone',
  'speedometer': 'Gauge',
  'run': 'Footprints',
  'apple': 'Apple',
  'traffic-light': 'TrafficCone',
  'location-enter': 'LogIn',
  'location-exit': 'LogOut',

  // Geometric / fallbacks
  'chevron-down': 'ChevronDown',
  'chevron-right': 'ChevronRight',
  'chevron-up': 'ChevronUp',
  'circle': 'Circle',
  'circle-outline': 'Circle',
};

/**
 * Unified icon component. Renders Lucide icons styled to match web's
 * @heroicons/react outline glyphs (stroke-width 2 by default).
 *
 * Accepts MCI-style kebab-case names for backward compatibility with the
 * rest of the app; internally maps to Lucide PascalCase components.
 *
 *   <Icon name="car" size={24} color={colors.primary} />
 */
const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = colors.textPrimary,
  strokeWidth = 2,
  style,
}) => {
  const compName = NAME_MAP[name];
  const Comp = compName ? (Lucide as any)[compName] : null;
  if (!Comp) {
    return (
      <Lucide.Circle
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        style={style as any}
      />
    );
  }
  return (
    <Comp
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      style={style}
    />
  );
};

export const AppIcons = {
  home: 'home',
  homeOutline: 'home',
  history: 'history',
  historyOutline: 'clock-outline',
  settings: 'cog',
  settingsOutline: 'cog',
  car: 'car',
  carConnected: 'car-connected',
  parking: 'parking',
  mapMarker: 'map-marker',
  mapMarkerCheck: 'map-marker-check',
  mapMarkerAlert: 'map-marker-alert',
  navigation: 'navigation-variant',
  directions: 'directions',
  checkCircle: 'check-circle',
  checkCircleOutline: 'check-circle-outline',
  alertCircle: 'alert-circle',
  alertCircleOutline: 'alert-circle-outline',
  alert: 'alert',
  shield: 'shield-check',
  shieldOutline: 'shield-check-outline',
  snowflake: 'snowflake',
  broom: 'broom',
  clock: 'clock-outline',
  calendarClock: 'calendar-clock',
  timerSand: 'timer-sand',
  bluetooth: 'bluetooth',
  bluetoothConnect: 'bluetooth-connect',
  refresh: 'refresh',
  chevronRight: 'chevron-right',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  close: 'close',
  plus: 'plus',
  delete: 'delete-outline',
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

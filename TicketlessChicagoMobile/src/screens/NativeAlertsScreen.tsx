import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import AuthService from '../services/AuthService';
import Config from '../config/config';
import Logger from '../utils/Logger';

const log = Logger.createLogger('NativeAlertsScreen');

// ─── Constants ──────────────────────────────────────────────

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

const TICKET_TYPES = [
  { id: 'expired_plates', label: 'Expired Plates', winRate: 75 },
  { id: 'no_city_sticker', label: 'No City Sticker', winRate: 70 },
  { id: 'expired_meter', label: 'Expired Meter', winRate: 45 },
  { id: 'no_standing_time_restricted', label: 'No Standing/Time Restricted', winRate: 40 },
  { id: 'parking_prohibited', label: 'Parking Prohibited', winRate: 35 },
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 55 },
  { id: 'residential_permit', label: 'Residential Permit', winRate: 50 },
  { id: 'snow_route', label: 'Snow Route', winRate: 30 },
  { id: 'fire_hydrant', label: 'Fire Hydrant', winRate: 15 },
  { id: 'disabled_zone', label: 'Disabled Zone', winRate: 60 },
  { id: 'double_parking', label: 'Double Parking', winRate: 20 },
  { id: 'missing_plate', label: 'Missing/Obscured Plate', winRate: 65 },
  { id: 'commercial_loading', label: 'Commercial Loading Zone', winRate: 40 },
  { id: 'other_unknown', label: 'Other / Unknown', winRate: 25 },
];

const NOTIFICATION_DAYS = [30, 14, 7, 3, 1, 0];

const VIOLATION_LABELS: Record<string, string> = {
  expired_plates: 'Expired Plates',
  no_city_sticker: 'No City Sticker',
  expired_meter: 'Expired Meter',
  no_standing_time_restricted: 'No Standing',
  parking_prohibited: 'Parking Prohibited',
  street_cleaning: 'Street Cleaning',
  residential_permit: 'Residential Permit',
  snow_route: 'Snow Route',
  fire_hydrant: 'Fire Hydrant',
  disabled_zone: 'Disabled Zone',
  double_parking: 'Double Parking',
  missing_plate: 'Missing Plate',
  commercial_loading: 'Commercial Loading',
  other_unknown: 'Other',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  found: { label: 'Found', color: '#F59E0B' },
  contesting: { label: 'Contesting', color: '#3B82F6' },
  letter_mailed: { label: 'Letter Mailed', color: '#8B5CF6' },
  contested: { label: 'Contested', color: '#10B981' },
  dismissed: { label: 'Dismissed', color: '#10B981' },
  paid: { label: 'Paid', color: '#6B7280' },
  skipped: { label: 'Skipped', color: '#9CA3AF' },
  pending_approval: { label: 'Pending Approval', color: '#F97316' },
};

// ─── Interfaces ──────────────────────────────────────────────

interface DashboardTicket {
  id: string;
  plate: string;
  state: string;
  ticket_number: string;
  violation_type: string;
  violation_date: string;
  amount: number;
  location: string;
  status: string;
  skip_reason?: string;
  found_at: string;
}

interface AutopilotSubscription {
  status: string;
  current_period_end: string;
}

// ─── Component ──────────────────────────────────────────────

const NativeAlertsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(AuthService.isAuthenticated());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isPaidUser, setIsPaidUser] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [hasActivePlates, setHasActivePlates] = useState(false);

  // Tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('settings');

  // Account Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Vehicle
  const [plateNumber, setPlateNumber] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [isLeased, setIsLeased] = useState(false);
  const [vin, setVin] = useState('');

  // Home Address
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState<number | null>(null);
  const [section, setSection] = useState('');
  const [homeCity, setHomeCity] = useState('Chicago');
  const [homeState, setHomeState] = useState('IL');
  const [homeZip, setHomeZip] = useState('');
  const [wardLookupStatus, setWardLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [wardLookupMessage, setWardLookupMessage] = useState('');

  // Mailing Address
  const [sameAsHomeAddress, setSameAsHomeAddress] = useState(false);
  const [mailingAddress1, setMailingAddress1] = useState('');
  const [mailingAddress2, setMailingAddress2] = useState('');
  const [mailingCity, setMailingCity] = useState('Chicago');
  const [mailingState, setMailingState] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');

  // Notifications
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [phoneCallNotifications, setPhoneCallNotifications] = useState(false);
  const [streetCleaningAlerts, setStreetCleaningAlerts] = useState(true);
  const [snowBanAlerts, setSnowBanAlerts] = useState(true);
  const [renewalReminders, setRenewalReminders] = useState(true);
  const [towAlerts, setTowAlerts] = useState(true);
  const [notificationDays, setNotificationDays] = useState<number[]>([30, 7, 1]);

  // Renewal Dates
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [licensePlateExpiry, setLicensePlateExpiry] = useState('');
  const [emissionsDate, setEmissionsDate] = useState('');

  // Autopilot Settings
  const [autoMailEnabled, setAutoMailEnabled] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([
    'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
    'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
    'missing_plate', 'commercial_loading',
  ]);
  const [emailOnTicketFound, setEmailOnTicketFound] = useState(true);
  const [emailOnLetterMailed, setEmailOnLetterMailed] = useState(true);
  const [emailOnApprovalNeeded, setEmailOnApprovalNeeded] = useState(true);

  // Dashboard
  const [dashboardTickets, setDashboardTickets] = useState<DashboardTicket[]>([]);
  const [platesMonitored, setPlatesMonitored] = useState(0);
  const [nextCheckDate, setNextCheckDate] = useState('');
  const [autopilotSubscription, setAutopilotSubscription] = useState<AutopilotSubscription | null>(null);

  // Refs for debounce
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(true);
  const addressLookupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load Data ──────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const supabase = AuthService.getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setUserId(session.user.id);
      setEmail(session.user.email || '');

      // Load profile
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      setIsPaidUser(profileData?.has_contesting === true);

      if (profileData) {
        setFirstName(profileData.first_name || '');
        setLastName(profileData.last_name || '');
        setPhone(profileData.phone || profileData.phone_number || '');
        setHomeAddress(profileData.street_address || profileData.home_address_full || '');
        if (profileData.home_address_ward) {
          const wardNum = parseInt(profileData.home_address_ward);
          if (!isNaN(wardNum)) setWard(wardNum);
        }
        setSection(profileData.home_address_section || '');
        const city = profileData.city || 'Chicago';
        setHomeCity(city.charAt(0).toUpperCase() + city.slice(1).toLowerCase());
        setHomeState('IL');
        setHomeZip(profileData.zip_code || '');
        setMailingAddress1(profileData.mailing_address || '');
        setMailingAddress2(profileData.mailing_address_2 || '');
        const mailingCityVal = profileData.mailing_city || 'Chicago';
        setMailingCity(mailingCityVal.charAt(0).toUpperCase() + mailingCityVal.slice(1).toLowerCase());
        setMailingState(profileData.mailing_state || 'IL');
        setMailingZip(profileData.mailing_zip || '');
        setVin(profileData.vin || '');
        setCityStickerExpiry(profileData.city_sticker_expiry || '');
        setLicensePlateExpiry(profileData.license_plate_expiry || '');
        setEmissionsDate(profileData.emissions_date || '');

        if (profileData.license_plate) {
          setPlateNumber(profileData.license_plate);
          setPlateState(profileData.license_state || 'IL');
        }

        // Notification preferences
        if (profileData.notification_preferences) {
          const prefs = typeof profileData.notification_preferences === 'object'
            ? profileData.notification_preferences
            : {};
          setEmailNotifications((prefs as any).email ?? profileData.notify_email ?? true);
          setSmsNotifications((prefs as any).sms ?? profileData.notify_sms ?? false);
          setPhoneCallNotifications((prefs as any).phone_call ?? profileData.phone_call_enabled ?? false);
          setStreetCleaningAlerts((prefs as any).street_cleaning ?? true);
          setSnowBanAlerts((prefs as any).snow_ban ?? profileData.notify_snow_ban ?? true);
          setRenewalReminders((prefs as any).renewals ?? true);
          setTowAlerts((prefs as any).tow ?? profileData.notify_tow ?? true);
          setNotificationDays((prefs as any).days_before || profileData.notify_days_array || [30, 7, 1]);
        } else {
          setEmailNotifications(profileData.notify_email ?? true);
          setSmsNotifications(profileData.notify_sms ?? false);
          setPhoneCallNotifications(profileData.phone_call_enabled ?? false);
          setSnowBanAlerts(profileData.notify_snow_ban ?? true);
          setTowAlerts(profileData.notify_tow ?? true);
          setNotificationDays(profileData.notify_days_array || [30, 7, 1]);
        }
      }

      // Load monitored plates
      const { data: plateData } = await supabase
        .from('monitored_plates')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active');

      const hasPlateInMonitored = plateData && plateData.length > 0;
      const hasPlateInProfile = !!profileData?.license_plate?.trim();
      setHasActivePlates(hasPlateInMonitored || hasPlateInProfile);

      if (plateData && plateData.length > 0) {
        setPlateNumber(plateData[0].plate);
        setPlateState(plateData[0].state);
        setIsLeased(plateData[0].is_leased_or_company || false);
        setPlatesMonitored(plateData.length);

        // Load detected tickets
        const { data: ticketData } = await supabase
          .from('detected_tickets')
          .select('id, ticket_number, violation_type, violation_code, violation_date, amount, location, status, skip_reason, created_at, user_id')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (ticketData) {
          const formattedTickets: DashboardTicket[] = ticketData.map((t: any) => ({
            id: t.id,
            plate: plateData[0]?.plate || '',
            state: plateData[0]?.state || 'IL',
            ticket_number: t.ticket_number,
            violation_type: t.violation_type || t.violation_code || 'other_unknown',
            violation_date: t.violation_date,
            amount: t.amount,
            location: t.location,
            status: t.status || 'found',
            skip_reason: t.skip_reason,
            found_at: t.created_at,
          }));
          setDashboardTickets(formattedTickets);
        }

        // Next check date
        const now = new Date();
        const nextCheck = new Date(now);
        if (now.getUTCHours() >= 14) {
          nextCheck.setDate(now.getDate() + 1);
        }
        setNextCheckDate(nextCheck.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

        // Load subscription
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('status, current_period_end')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (subData) {
          setAutopilotSubscription({
            status: subData.status,
            current_period_end: subData.current_period_end,
          });
        }
      }

      // Load autopilot settings
      const { data: settingsData } = await supabase
        .from('autopilot_settings')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (settingsData) {
        setAutoMailEnabled(settingsData.auto_mail_enabled);
        setRequireApproval(settingsData.require_approval);
        setAllowedTicketTypes(settingsData.allowed_ticket_types || []);
        setEmailOnTicketFound(settingsData.email_on_ticket_found);
        setEmailOnLetterMailed(settingsData.email_on_letter_mailed);
        setEmailOnApprovalNeeded(settingsData.email_on_approval_needed);
      }

      setLoading(false);
      setRefreshing(false);
      setTimeout(() => { initialLoadRef.current = false; }, 100);
    } catch (err) {
      log.error('loadData error', err);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ─── Auto-Save ──────────────────────────────────────────

  const autoSave = useCallback(async () => {
    if (!userId || initialLoadRef.current) return;

    setSaveStatus('saving');
    const supabase = AuthService.getSupabaseClient();
    const plateUpper = plateNumber.toUpperCase().trim();

    try {
      // Save to user_profiles
      await supabase
        .from('user_profiles')
        .upsert({
          user_id: userId,
          email,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          phone_number: phone || null,
          street_address: homeAddress || null,
          home_address_full: homeAddress || null,
          home_address_ward: ward ? String(ward) : null,
          home_address_section: section || null,
          city: homeCity || 'Chicago',
          zip_code: homeZip || null,
          mailing_address: mailingAddress1 || null,
          mailing_address_2: mailingAddress2 || null,
          mailing_city: mailingCity || null,
          mailing_state: mailingState || 'IL',
          mailing_zip: mailingZip || null,
          vin: vin || null,
          license_plate: plateUpper || null,
          license_state: plateState || 'IL',
          city_sticker_expiry: cityStickerExpiry || null,
          license_plate_expiry: licensePlateExpiry || null,
          emissions_date: emissionsDate || null,
          notify_email: emailNotifications,
          notify_sms: smsNotifications,
          phone_call_enabled: phoneCallNotifications,
          notify_snow_ban: snowBanAlerts,
          notify_tow: towAlerts,
          notify_days_array: notificationDays,
          notification_preferences: {
            email: emailNotifications,
            sms: smsNotifications,
            phone_call: phoneCallNotifications,
            street_cleaning: streetCleaningAlerts,
            snow_ban: snowBanAlerts,
            renewals: renewalReminders,
            tow: towAlerts,
            days_before: notificationDays,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      // For paid users, update monitored_plates
      if (isPaidUser && plateUpper.length >= 2) {
        const { data: existingPlate } = await supabase
          .from('monitored_plates')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingPlate) {
          await supabase
            .from('monitored_plates')
            .update({
              plate: plateUpper,
              state: plateState,
              is_leased_or_company: isLeased,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingPlate.id);
        } else {
          await supabase
            .from('monitored_plates')
            .insert({
              user_id: userId,
              plate: plateUpper,
              state: plateState,
              is_leased_or_company: isLeased,
              status: 'active',
            });
        }
      }

      // Save autopilot settings for paid users
      if (isPaidUser) {
        await supabase
          .from('autopilot_settings')
          .upsert({
            user_id: userId,
            auto_mail_enabled: autoMailEnabled,
            require_approval: requireApproval,
            allowed_ticket_types: allowedTicketTypes,
            email_on_ticket_found: emailOnTicketFound,
            email_on_letter_mailed: emailOnLetterMailed,
            email_on_approval_needed: emailOnApprovalNeeded,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      log.error('autoSave error', err);
      setSaveStatus('idle');
    }
  }, [userId, email, firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      cityStickerExpiry, licensePlateExpiry, emissionsDate, emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, renewalReminders, towAlerts, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, isPaidUser]);

  // Debounced auto-save
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      autoSave();
    }, 1500);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      cityStickerExpiry, licensePlateExpiry, emissionsDate, emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, renewalReminders, towAlerts, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, autoSave]);

  // ─── Helpers ──────────────────────────────────────────────

  const toggleNotificationDay = (day: number) => {
    if (notificationDays.includes(day)) {
      setNotificationDays(notificationDays.filter(d => d !== day));
    } else {
      setNotificationDays([...notificationDays, day].sort((a, b) => b - a));
    }
  };

  const toggleTicketType = (typeId: string) => {
    if (allowedTicketTypes.includes(typeId)) {
      setAllowedTicketTypes(allowedTicketTypes.filter(t => t !== typeId));
    } else {
      setAllowedTicketTypes([...allowedTicketTypes, typeId]);
    }
  };

  const handleUpgrade = async () => {
    if (!userId) return;
    setCheckoutLoading(true);
    try {
      await autoSave();
      const response = await AuthService.authenticatedFetch(
        `${Config.API_BASE_URL}/api/autopilot/create-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            licensePlate: plateNumber.trim() || null,
            plateState,
          }),
        }
      );
      const data = await response.json();
      if (data.url) {
        await Linking.openURL(data.url);
      } else if (data.error) {
        Alert.alert('Checkout Error', data.error);
      }
    } catch (error) {
      log.error('Checkout error', error);
      Alert.alert('Error', 'Could not start checkout. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const lookupWardSection = async (address: string) => {
    if (!address || address.length < 5) {
      setWardLookupStatus('idle');
      setWardLookupMessage('');
      return;
    }
    setWardLookupStatus('loading');
    setWardLookupMessage('Looking up ward...');
    try {
      const response = await fetch(`${Config.API_BASE_URL}/api/validate-address?address=${encodeURIComponent(address)}`);
      const data = await response.json();
      if (data.valid && data.ward && data.section) {
        setWard(data.ward);
        setSection(data.section);
        setWardLookupStatus('success');
        setWardLookupMessage(`Ward ${data.ward}, Section ${data.section}`);
      } else if (data.valid && !data.ward) {
        if (!ward) setWard(null);
        if (!section) setSection('');
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Address not in a street cleaning zone');
      } else {
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Could not verify address');
      }
    } catch {
      setWardLookupStatus('error');
      setWardLookupMessage('Error looking up address');
    }
  };

  const handleAddressChange = (newAddress: string) => {
    setHomeAddress(newAddress);
    if (addressLookupRef.current) clearTimeout(addressLookupRef.current);
    addressLookupRef.current = setTimeout(() => {
      lookupWardSection(newAddress);
    }, 1000);
  };

  // ─── Auth + Lifecycle ──────────────────────────────────────

  useEffect(() => {
    const unsubscribe = AuthService.subscribe((state) => {
      setIsAuthenticated(state.isAuthenticated);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, loadData]);

  // Re-load on screen focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (isAuthenticated) {
        loadData();
      }
    });
    return unsubscribe;
  }, [navigation, isAuthenticated, loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // ─── Unauthenticated ─────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Alerts</Text>
        </View>
        <View style={styles.centeredContainer}>
          <MaterialCommunityIcons name="bell-ring-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.centeredTitle}>Sign in to manage alerts</Text>
          <Text style={styles.centeredText}>
            Get notified about street cleaning, snow bans, tow alerts, and more.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading ──────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Alerts</Text>
        </View>
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centeredText}>Loading your settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main Content ─────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with save status */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {activeTab === 'dashboard' ? 'Dashboard' : 'Settings'}
        </Text>
        {saveStatus !== 'idle' && (
          <Text style={[styles.saveStatusText, saveStatus === 'saved' && { color: '#10B981' }]}>
            {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
          </Text>
        )}
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'dashboard' && styles.activeTab]}
          onPress={() => setActiveTab('dashboard')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="view-dashboard-outline"
            size={18}
            color={activeTab === 'dashboard' ? colors.primary : colors.textTertiary}
          />
          <Text style={[styles.tabText, activeTab === 'dashboard' && styles.activeTabText]}>
            Dashboard
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'settings' && styles.activeTab]}
          onPress={() => setActiveTab('settings')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="cog-outline"
            size={18}
            color={activeTab === 'settings' ? colors.primary : colors.textTertiary}
          />
          <Text style={[styles.tabText, activeTab === 'settings' && styles.activeTabText]}>
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {activeTab === 'dashboard' ? renderDashboard() : renderSettings()}
      </ScrollView>
    </SafeAreaView>
  );

  // ─── Dashboard Tab ──────────────────────────────────────

  function renderDashboard() {
    if (!isPaidUser) {
      return renderFreeDashboard();
    }
    return renderPaidDashboard();
  }

  function renderFreeDashboard() {
    return (
      <View>
        {/* Free alerts info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Free Alerts Active</Text>
            <View style={[styles.badge, { backgroundColor: '#D1FAE5' }]}>
              <Text style={[styles.badgeText, { color: '#059669' }]}>FREE</Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.bodyText}>You're receiving free notifications for:</Text>
            <View style={styles.bulletList}>
              <BulletItem text="New parking tickets on your plate" />
              <BulletItem text="Street cleaning reminders" />
              <BulletItem text="City sticker & plate renewal dates" />
              <BulletItem text="Snow ban alerts" />
              <BulletItem text="Tow alerts" />
            </View>
          </View>
        </View>

        {/* Upgrade CTA */}
        <View style={[styles.card, { borderColor: '#F97316', borderWidth: 1 }]}>
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, { marginBottom: 4 }]}>Upgrade to Autopilot</Text>
            <Text style={[styles.bodyText, { marginBottom: 4 }]}>$49/year</Text>
            <Text style={styles.mutedText}>
              We monitor your plate twice a week and mail contest letters automatically. 54% average dismissal rate.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, styles.upgradeButton]}
              onPress={handleUpgrade}
              disabled={checkoutLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>
                {checkoutLoading ? 'Loading...' : 'Upgrade Now'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionSubtitle}>
          Complete your profile in the Settings tab to ensure alerts work correctly.
        </Text>
      </View>
    );
  }

  function renderPaidDashboard() {
    return (
      <View>
        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatCard
            icon="car-search"
            label="Plates Monitored"
            value={String(platesMonitored)}
            color="#3B82F6"
          />
          <StatCard
            icon="ticket-outline"
            label="Tickets Found"
            value={String(dashboardTickets.length)}
            color="#F59E0B"
          />
          <StatCard
            icon="calendar-clock"
            label="Next Check"
            value={nextCheckDate || '—'}
            color="#10B981"
          />
        </View>

        {/* Subscription Info */}
        {autopilotSubscription && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Subscription</Text>
              <View style={[styles.badge, { backgroundColor: '#D1FAE5' }]}>
                <Text style={[styles.badgeText, { color: '#059669' }]}>
                  {autopilotSubscription.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.mutedText}>
                Renews {new Date(autopilotSubscription.current_period_end).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </Text>
            </View>
          </View>
        )}

        {/* Missing profile warning */}
        {(!hasActivePlates || !lastName.trim() || !mailingAddress1.trim()) && (
          <View style={[styles.card, { borderColor: '#EF4444', borderWidth: 1, backgroundColor: '#FEF2F2' }]}>
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: '#991B1B', marginBottom: 4 }]}>
                Action Required: Complete Your Profile
              </Text>
              <Text style={{ color: '#991B1B', fontSize: 13, lineHeight: 18 }}>
                {(() => {
                  const missing = [];
                  if (!lastName.trim()) missing.push('last name');
                  if (!hasActivePlates) missing.push('license plate');
                  if (!mailingAddress1.trim()) missing.push('mailing address');
                  return missing.join(', ') + (missing.length === 1 ? ' is' : ' are') + ' missing. Fill in the Settings tab.';
                })()}
              </Text>
            </View>
          </View>
        )}

        {/* Recent Tickets */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Recent Tickets</Text>
          </View>
          <View style={styles.cardBody}>
            {dashboardTickets.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <MaterialCommunityIcons name="check-circle-outline" size={32} color="#10B981" />
                <Text style={[styles.mutedText, { marginTop: 8, textAlign: 'center' }]}>
                  No tickets found yet. We check your plates regularly.
                </Text>
              </View>
            ) : (
              dashboardTickets.map((ticket) => (
                <View key={ticket.id} style={styles.ticketRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ticketType}>
                      {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type}
                    </Text>
                    <Text style={styles.ticketMeta}>
                      {ticket.violation_date ? new Date(ticket.violation_date).toLocaleDateString() : '—'}
                      {ticket.location ? ` · ${ticket.location}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.ticketAmount}>
                      ${ticket.amount || '—'}
                    </Text>
                    <View style={[
                      styles.statusBadge,
                      { backgroundColor: (STATUS_LABELS[ticket.status]?.color || '#6B7280') + '20' },
                    ]}>
                      <Text style={[
                        styles.statusText,
                        { color: STATUS_LABELS[ticket.status]?.color || '#6B7280' },
                      ]}>
                        {STATUS_LABELS[ticket.status]?.label || ticket.status}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      </View>
    );
  }

  // ─── Settings Tab ──────────────────────────────────────────

  function renderSettings() {
    return (
      <View>
        {/* Upgrade banner for free users */}
        {!isPaidUser && (
          <View style={[styles.card, { backgroundColor: '#FFF7ED', borderColor: '#F97316', borderWidth: 1 }]}>
            <View style={styles.cardBody}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#9A3412' }}>
                    Upgrade to Autopilot — $49/year
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9A3412', marginTop: 2 }}>
                    Auto ticket detection & contesting
                  </Text>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#F97316', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={handleUpgrade}
                  disabled={checkoutLoading}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                    {checkoutLoading ? '...' : 'Upgrade'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Account Info */}
        <SettingsCard title="Account Info" icon="account-outline">
          <FormField label="Email">
            <TextInput
              style={[styles.input, styles.disabledInput]}
              value={email}
              editable={false}
            />
          </FormField>
          <View style={styles.fieldRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <FormField label="First Name">
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="John"
                  placeholderTextColor={colors.textTertiary}
                />
              </FormField>
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <FormField label="Last Name" required={isPaidUser && !lastName.trim()}>
                <TextInput
                  style={[styles.input, isPaidUser && !lastName.trim() && styles.errorInput]}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Doe"
                  placeholderTextColor={colors.textTertiary}
                />
              </FormField>
            </View>
          </View>
          <FormField label="Phone (for SMS alerts)">
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 (555) 123-4567"
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
            />
          </FormField>
        </SettingsCard>

        {/* Vehicle Information */}
        <SettingsCard title="Vehicle Information" icon="car-outline">
          <FormField label="License Plate" required={isPaidUser && !plateNumber.trim()}>
            <View style={styles.plateRow}>
              <TouchableOpacity
                style={styles.plateStateButton}
                onPress={() => showStatePicker('plate')}
              >
                <Text style={styles.plateStateText}>{plateState}</Text>
                <MaterialCommunityIcons name="chevron-down" size={14} color="#fff" />
              </TouchableOpacity>
              <TextInput
                style={styles.plateInput}
                value={plateNumber}
                onChangeText={(text) => setPlateNumber(text.toUpperCase())}
                placeholder="ABC1234"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
              />
            </View>
          </FormField>
          <FormField label="VIN (optional)">
            <TextInput
              style={styles.input}
              value={vin}
              onChangeText={(text) => setVin(text.toUpperCase())}
              placeholder="1HGBH41JXMN109186"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              maxLength={17}
            />
          </FormField>
        </SettingsCard>

        {/* Home Address */}
        <SettingsCard title="Home Address" icon="home-outline" subtitle="For street cleaning alerts">
          <FormField label="Street Address">
            <TextInput
              style={styles.input}
              value={homeAddress}
              onChangeText={handleAddressChange}
              placeholder="123 Main Street, Chicago IL"
              placeholderTextColor={colors.textTertiary}
            />
          </FormField>
          {wardLookupMessage ? (
            <Text style={[
              styles.lookupMessage,
              { color: wardLookupStatus === 'success' ? '#10B981' : wardLookupStatus === 'error' ? '#F59E0B' : colors.textTertiary },
            ]}>
              {wardLookupStatus === 'loading' ? 'Looking up ward...' : wardLookupMessage}
            </Text>
          ) : null}
          <View style={styles.fieldRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <FormField label="Ward (auto)">
                <TextInput
                  style={[styles.input, styles.disabledInput]}
                  value={ward ? `Ward ${ward}` : '—'}
                  editable={false}
                />
              </FormField>
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <FormField label="Section (auto)">
                <TextInput
                  style={[styles.input, styles.disabledInput]}
                  value={section || '—'}
                  editable={false}
                />
              </FormField>
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={{ flex: 2, marginRight: 8 }}>
              <FormField label="City">
                <TextInput
                  style={styles.input}
                  value={homeCity}
                  onChangeText={setHomeCity}
                  placeholderTextColor={colors.textTertiary}
                />
              </FormField>
            </View>
            <View style={{ flex: 1, marginHorizontal: 4 }}>
              <FormField label="State">
                <TouchableOpacity style={styles.input} onPress={() => showStatePicker('home')}>
                  <Text style={{ color: colors.textPrimary, fontSize: 14 }}>{homeState}</Text>
                </TouchableOpacity>
              </FormField>
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <FormField label="ZIP">
                <TextInput
                  style={styles.input}
                  value={homeZip}
                  onChangeText={setHomeZip}
                  placeholder="60601"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                />
              </FormField>
            </View>
          </View>
        </SettingsCard>

        {/* Mailing Address */}
        <SettingsCard
          title="Mailing Address"
          icon="mailbox-outline"
          badge={!isPaidUser ? 'AUTOPILOT ONLY' : undefined}
          badgeColor={!isPaidUser ? '#FEF3C7' : undefined}
          badgeTextColor={!isPaidUser ? '#92400E' : undefined}
          greyed={!isPaidUser}
        >
          {isPaidUser && (
            <>
              <TouchableOpacity
                style={[
                  styles.checkboxRow,
                  sameAsHomeAddress && { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' },
                ]}
                onPress={() => {
                  const newValue = !sameAsHomeAddress;
                  setSameAsHomeAddress(newValue);
                  if (newValue && homeAddress) {
                    setMailingAddress1(homeAddress);
                    setMailingCity(homeCity);
                    setMailingState(homeState);
                    setMailingZip(homeZip);
                  }
                }}
              >
                <MaterialCommunityIcons
                  name={sameAsHomeAddress ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={sameAsHomeAddress ? '#3B82F6' : colors.textTertiary}
                />
                <Text style={styles.checkboxLabel}>Same as home address</Text>
              </TouchableOpacity>

              <FormField label="Street Address">
                <TextInput
                  style={[styles.input, sameAsHomeAddress && styles.disabledInput]}
                  value={mailingAddress1}
                  onChangeText={(text) => {
                    setMailingAddress1(text);
                    if (sameAsHomeAddress) setSameAsHomeAddress(false);
                  }}
                  placeholder="123 Main Street"
                  placeholderTextColor={colors.textTertiary}
                  editable={!sameAsHomeAddress}
                />
              </FormField>
              <FormField label="Apt / Unit">
                <TextInput
                  style={styles.input}
                  value={mailingAddress2}
                  onChangeText={setMailingAddress2}
                  placeholder="Apt 4B"
                  placeholderTextColor={colors.textTertiary}
                />
              </FormField>
              <View style={styles.fieldRow}>
                <View style={{ flex: 2, marginRight: 8 }}>
                  <FormField label="City">
                    <TextInput
                      style={[styles.input, sameAsHomeAddress && styles.disabledInput]}
                      value={mailingCity}
                      onChangeText={(text) => {
                        setMailingCity(text);
                        if (sameAsHomeAddress) setSameAsHomeAddress(false);
                      }}
                      placeholder="Chicago"
                      placeholderTextColor={colors.textTertiary}
                      editable={!sameAsHomeAddress}
                    />
                  </FormField>
                </View>
                <View style={{ flex: 1, marginHorizontal: 4 }}>
                  <FormField label="State">
                    <TouchableOpacity
                      style={[styles.input, sameAsHomeAddress && styles.disabledInput]}
                      onPress={() => !sameAsHomeAddress && showStatePicker('mailing')}
                      disabled={sameAsHomeAddress}
                    >
                      <Text style={{ color: sameAsHomeAddress ? colors.textTertiary : colors.textPrimary, fontSize: 14 }}>
                        {mailingState}
                      </Text>
                    </TouchableOpacity>
                  </FormField>
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <FormField label="ZIP">
                    <TextInput
                      style={[styles.input, sameAsHomeAddress && styles.disabledInput]}
                      value={mailingZip}
                      onChangeText={(text) => {
                        setMailingZip(text);
                        if (sameAsHomeAddress) setSameAsHomeAddress(false);
                      }}
                      placeholder="60601"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="number-pad"
                      editable={!sameAsHomeAddress}
                    />
                  </FormField>
                </View>
              </View>
            </>
          )}
          {!isPaidUser && (
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.mutedText}>
                Upgrade to Autopilot to set your mailing address for contest letters.
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, styles.upgradeButton, { marginTop: 12 }]}
                onPress={handleUpgrade}
                disabled={checkoutLoading}
              >
                <Text style={styles.primaryButtonText}>
                  {checkoutLoading ? 'Loading...' : 'Upgrade — $49/year'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </SettingsCard>

        {/* Notification Preferences */}
        <SettingsCard title="Notification Preferences" icon="bell-outline">
          <ToggleRow
            title="Email notifications"
            subtitle="Receive alerts via email"
            value={emailNotifications}
            onValueChange={setEmailNotifications}
          />
          <ToggleRow
            title="SMS notifications"
            subtitle="Receive alerts via text message"
            value={smsNotifications}
            onValueChange={setSmsNotifications}
            disabled={!phone}
          />
          <ToggleRow
            title="Phone call alerts"
            subtitle="Receive automated voice call reminders"
            value={phoneCallNotifications}
            onValueChange={setPhoneCallNotifications}
            disabled={!phone}
          />
          <ToggleRow
            title="Street cleaning alerts"
            subtitle="Get notified before street cleaning days"
            value={streetCleaningAlerts}
            onValueChange={setStreetCleaningAlerts}
          />
          <ToggleRow
            title="Snow ban alerts"
            subtitle="Get notified when snow parking bans are active"
            value={snowBanAlerts}
            onValueChange={setSnowBanAlerts}
          />
          <ToggleRow
            title="Tow alerts"
            subtitle="Get notified if your car is towed"
            value={towAlerts}
            onValueChange={setTowAlerts}
          />
          <ToggleRow
            title="Renewal reminders"
            subtitle="City sticker, plates, and emissions"
            value={renewalReminders}
            onValueChange={setRenewalReminders}
            isLast
          />

          <Text style={styles.fieldLabel}>Days before to notify</Text>
          <View style={styles.chipRow}>
            {NOTIFICATION_DAYS.map(day => (
              <TouchableOpacity
                key={day}
                style={[
                  styles.chip,
                  notificationDays.includes(day) && styles.chipActive,
                ]}
                onPress={() => toggleNotificationDay(day)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.chipText,
                  notificationDays.includes(day) && styles.chipTextActive,
                ]}>
                  {day === 0 ? 'Day of' : `${day}d`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SettingsCard>

        {/* Renewal Dates */}
        <SettingsCard title="Renewal Dates" icon="calendar-outline" subtitle="Optional">
          <FormField label="City Sticker Expiry">
            <TextInput
              style={styles.input}
              value={cityStickerExpiry}
              onChangeText={setCityStickerExpiry}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
            />
          </FormField>
          <FormField label="License Plate Expiry">
            <TextInput
              style={styles.input}
              value={licensePlateExpiry}
              onChangeText={setLicensePlateExpiry}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
            />
          </FormField>
          <FormField label="Emissions Test Date">
            <TextInput
              style={styles.input}
              value={emissionsDate}
              onChangeText={setEmissionsDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
            />
          </FormField>
        </SettingsCard>

        {/* Autopilot Settings */}
        <SettingsCard
          title="Autopilot Settings"
          icon="robot-outline"
          badge={isPaidUser ? 'AUTOPILOT MEMBER' : 'AUTOPILOT ONLY'}
          badgeColor={isPaidUser ? '#D1FAE5' : '#FEF3C7'}
          badgeTextColor={isPaidUser ? '#059669' : '#92400E'}
          greyed={!isPaidUser}
        >
          {isPaidUser ? (
            <>
              <ToggleRow
                title="Require approval before mailing"
                subtitle="We'll email you the letter for review before sending"
                value={requireApproval}
                onValueChange={(checked) => {
                  setRequireApproval(checked);
                  setAutoMailEnabled(!checked);
                }}
              />
              <ToggleRow
                title="Full auto-pilot (no approval)"
                subtitle="We detect, build, and mail letters automatically"
                value={autoMailEnabled}
                onValueChange={(checked) => {
                  setAutoMailEnabled(checked);
                  setRequireApproval(!checked);
                }}
              />

              {autoMailEnabled && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    Letters will be mailed to the City of Chicago on your behalf without you seeing them first.
                  </Text>
                </View>
              )}

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Ticket types to auto-contest</Text>
              {TICKET_TYPES.map(type => {
                const isChecked = allowedTicketTypes.includes(type.id);
                return (
                  <TouchableOpacity
                    key={type.id}
                    style={[styles.ticketTypeRow, isChecked && styles.ticketTypeRowActive]}
                    onPress={() => toggleTicketType(type.id)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={20}
                      color={isChecked ? colors.primary : colors.textTertiary}
                    />
                    <Text style={styles.ticketTypeLabel}>{type.label}</Text>
                    <Text style={[
                      styles.winRate,
                      { color: type.winRate >= 60 ? '#10B981' : type.winRate <= 20 ? '#EF4444' : colors.textTertiary },
                    ]}>
                      {type.winRate}%
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                <Text style={styles.fieldLabel}>Email Notifications</Text>
                <CheckboxRow
                  label="Notify when ticket is found"
                  checked={emailOnTicketFound}
                  onToggle={() => setEmailOnTicketFound(!emailOnTicketFound)}
                />
                <CheckboxRow
                  label="Notify when letter is mailed"
                  checked={emailOnLetterMailed}
                  onToggle={() => setEmailOnLetterMailed(!emailOnLetterMailed)}
                />
                <CheckboxRow
                  label="Notify when approval is needed"
                  checked={emailOnApprovalNeeded}
                  onToggle={() => setEmailOnApprovalNeeded(!emailOnApprovalNeeded)}
                />
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.mutedText}>
                Upgrade to Autopilot for automatic ticket detection and contesting with 54% average dismissal rate.
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, styles.upgradeButton, { marginTop: 12 }]}
                onPress={handleUpgrade}
                disabled={checkoutLoading}
              >
                <Text style={styles.primaryButtonText}>
                  {checkoutLoading ? 'Loading...' : 'Upgrade — $49/year'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </SettingsCard>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </View>
    );
  }

  // ─── State Picker ──────────────────────────────────────────

  function showStatePicker(target: 'plate' | 'home' | 'mailing') {
    const options = US_STATES.map(s => s.code);
    // Use Alert with a simplified approach — show common states first
    const common = ['IL', 'IN', 'WI', 'MI', 'OH', 'MO', 'IA'];
    const otherStates = options.filter(s => !common.includes(s));

    Alert.alert(
      'Select State',
      'Choose your state',
      [
        ...common.map(code => ({
          text: code,
          onPress: () => {
            if (target === 'plate') setPlateState(code);
            else if (target === 'home') setHomeState(code);
            else setMailingState(code);
          },
        })),
        {
          text: 'Other...',
          onPress: () => {
            Alert.alert(
              'All States',
              'Choose your state',
              otherStates.map(code => ({
                text: code,
                onPress: () => {
                  if (target === 'plate') setPlateState(code);
                  else if (target === 'home') setHomeState(code);
                  else setMailingState(code);
                },
              }))
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }
};

// ─── Sub-Components ──────────────────────────────────────────

const BulletItem: React.FC<{ text: string }> = ({ text }) => (
  <View style={styles.bulletItem}>
    <MaterialCommunityIcons name="check-circle" size={16} color="#10B981" />
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

const StatCard: React.FC<{
  icon: string;
  label: string;
  value: string;
  color: string;
}> = ({ icon, label, value, color }) => (
  <View style={styles.statCard}>
    <MaterialCommunityIcons name={icon} size={22} color={color} />
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const SettingsCard: React.FC<{
  title: string;
  icon: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  badgeTextColor?: string;
  greyed?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, subtitle, badge, badgeColor, badgeTextColor, greyed, children }) => (
  <View style={[styles.card, greyed && { opacity: 0.6 }]}>
    <View style={styles.cardHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <MaterialCommunityIcons name={icon} size={18} color={colors.primary} style={{ marginRight: 8 }} />
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle && <Text style={[styles.mutedText, { marginLeft: 8, fontSize: 11 }]}>{subtitle}</Text>}
      </View>
      {badge && (
        <View style={[styles.badge, { backgroundColor: badgeColor || '#E2E8F0' }]}>
          <Text style={[styles.badgeText, { color: badgeTextColor || colors.textTertiary }]}>{badge}</Text>
        </View>
      )}
    </View>
    <View style={styles.cardBody}>
      {children}
    </View>
  </View>
);

const FormField: React.FC<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, required, children }) => (
  <View style={styles.formField}>
    <Text style={[styles.fieldLabel, required && { color: '#EF4444' }]}>
      {label}
      {required && <Text style={{ color: '#EF4444', fontSize: 10 }}> *REQUIRED</Text>}
    </Text>
    {children}
  </View>
);

const ToggleRow: React.FC<{
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
  isLast?: boolean;
}> = ({ title, subtitle, value, onValueChange, disabled, isLast }) => (
  <View style={[styles.toggleRow, !isLast && styles.toggleRowBorder]}>
    <View style={{ flex: 1, marginRight: 12 }}>
      <Text style={styles.toggleTitle}>{title}</Text>
      <Text style={styles.toggleSubtitle}>{subtitle}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: '#E2E8F0', true: '#0066FF' }}
      thumbColor="#fff"
    />
  </View>
);

const CheckboxRow: React.FC<{
  label: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ label, checked, onToggle }) => (
  <TouchableOpacity style={styles.checkboxItemRow} onPress={onToggle} activeOpacity={0.7}>
    <MaterialCommunityIcons
      name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
      size={20}
      color={checked ? colors.primary : colors.textTertiary}
    />
    <Text style={styles.checkboxItemLabel}>{label}</Text>
  </TouchableOpacity>
);

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: '#F1F5F9',
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  saveStatusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textTertiary,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#fff',
    ...shadows.sm,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xs,
  },

  // Centered container
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  centeredTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  centeredText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },

  // Buttons
  primaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.sm,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
  upgradeButton: {
    backgroundColor: '#F97316',
    marginTop: 12,
  },

  // Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  cardBody: {
    padding: 16,
  },
  bodyText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 8,
  },
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },

  // Badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    ...shadows.sm,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },

  // Tickets
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  ticketType: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0F172A',
  },
  ticketMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  ticketAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },

  // Bullet list
  bulletList: {
    marginTop: 4,
    gap: 6,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulletText: {
    fontSize: 13,
    color: '#334155',
  },

  // Form fields
  formField: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  fieldRow: {
    flexDirection: 'row',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    color: '#0F172A',
  },
  disabledInput: {
    backgroundColor: '#F1F5F9',
    color: '#94A3B8',
  },
  errorInput: {
    borderColor: '#EF4444',
  },

  // Plate
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  plateStateButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  plateStateText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  plateInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    letterSpacing: 1,
  },

  // Lookup
  lookupMessage: {
    fontSize: 12,
    marginBottom: 8,
    marginTop: -4,
  },

  // Toggle rows
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  chipText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Checkbox rows
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    marginBottom: 12,
  },
  checkboxLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0F172A',
  },
  checkboxItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  checkboxItemLabel: {
    fontSize: 14,
    color: '#334155',
  },

  // Ticket types
  ticketTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },
  ticketTypeRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '05',
  },
  ticketTypeLabel: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
  winRate: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Warning
  warningBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  warningText: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
  },
});

export default NativeAlertsScreen;

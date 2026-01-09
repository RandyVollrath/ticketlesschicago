import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const COLORS = {
  primary: '#0F172A',
  accent: '#10B981',
  highlight: '#F97316',
  bgLight: '#F8FAFC',
  bgSection: '#F1F5F9',
  textDark: '#1E293B',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
  warningLight: '#FEF3C7',
  successLight: '#D1FAE5',
  white: '#FFFFFF',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

const CHICAGO_WARDS = Array.from({ length: 50 }, (_, i) => i + 1);

const VEHICLE_TYPES = [
  'Sedan', 'SUV', 'Truck', 'Van', 'Motorcycle', 'Other'
];

const TICKET_TYPES = [
  { id: 'expired_plates', label: 'Expired Plates', winRate: 75 },
  { id: 'no_city_sticker', label: 'No City Sticker', winRate: 70 },
  { id: 'expired_meter', label: 'Expired Meter', winRate: 67 },
  { id: 'disabled_zone', label: 'Disabled Zone', winRate: 68 },
  { id: 'no_standing_time_restricted', label: 'No Standing/Time Restricted', winRate: 58 },
  { id: 'parking_prohibited', label: 'Parking/Standing Prohibited', winRate: 55 },
  { id: 'residential_permit', label: 'Residential Permit Parking', winRate: 54 },
  { id: 'missing_plate', label: 'Missing/Noncompliant Plate', winRate: 54 },
  { id: 'commercial_loading', label: 'Commercial Loading Zone', winRate: 59 },
  { id: 'fire_hydrant', label: 'Fire Hydrant', winRate: 44 },
  { id: 'rush_hour', label: 'Rush Hour Parking', winRate: 37 },
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 34 },
  { id: 'red_light', label: 'Red Light Camera', winRate: 20 },
  { id: 'speed_camera', label: 'Speed Camera', winRate: 18 },
];

const NOTIFICATION_DAYS = [30, 14, 7, 3, 1, 0];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 48,
        height: 26,
        borderRadius: 26,
        backgroundColor: checked ? COLORS.accent : '#CBD5E1',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        height: 20,
        width: 20,
        left: checked ? 25 : 3,
        top: 3,
        backgroundColor: COLORS.white,
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function Card({ title, children, badge, greyed, upgradeContent }: { title: string; children: React.ReactNode; badge?: React.ReactNode; greyed?: boolean; upgradeContent?: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      border: `1px solid ${COLORS.border}`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{
          margin: 0,
          fontFamily: FONTS.heading,
          fontSize: 18,
          color: COLORS.primary,
          fontWeight: 600,
        }}>
          {title}
        </h3>
        {badge}
      </div>
      {/* Upgrade content is always clickable */}
      {upgradeContent && (
        <div style={{ padding: '24px 24px 0' }}>
          {upgradeContent}
        </div>
      )}
      <div style={{
        padding: upgradeContent ? '20px 24px 24px' : 24,
        opacity: greyed ? 0.5 : 1,
        pointerEvents: greyed ? 'none' : 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isPaidUser, setIsPaidUser] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [hasActivePlates, setHasActivePlates] = useState(false);

  // Account Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Vehicle Information
  const [plateNumber, setPlateNumber] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [isLeased, setIsLeased] = useState(false);
  const [vin, setVin] = useState('');
  const [vehicleType, setVehicleType] = useState('Sedan');

  // Home Address (for street cleaning)
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState<number | null>(null);
  const [section, setSection] = useState('');
  const [homeCity, setHomeCity] = useState('Chicago');
  const [homeState, setHomeState] = useState('IL');
  const [homeZip, setHomeZip] = useState('');
  const [wardLookupStatus, setWardLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [wardLookupMessage, setWardLookupMessage] = useState('');

  // Mailing Address
  const [mailingAddress1, setMailingAddress1] = useState('');
  const [mailingAddress2, setMailingAddress2] = useState('');
  const [mailingCity, setMailingCity] = useState('');
  const [mailingState, setMailingState] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');

  // Notification Preferences
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [phoneCallNotifications, setPhoneCallNotifications] = useState(false);
  const [streetCleaningAlerts, setStreetCleaningAlerts] = useState(true);
  const [snowBanAlerts, setSnowBanAlerts] = useState(true);
  const [renewalReminders, setRenewalReminders] = useState(true);
  const [notificationDays, setNotificationDays] = useState<number[]>([30, 7, 1]);

  // Renewal Dates
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [licensePlateExpiry, setLicensePlateExpiry] = useState('');
  const [emissionsDate, setEmissionsDate] = useState('');

  // Autopilot Settings
  const [autoMailEnabled, setAutoMailEnabled] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([
    'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
    'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
    'missing_plate', 'commercial_loading'
  ]);
  const [emailOnTicketFound, setEmailOnTicketFound] = useState(true);
  const [emailOnLetterMailed, setEmailOnLetterMailed] = useState(true);
  const [emailOnApprovalNeeded, setEmailOnApprovalNeeded] = useState(true);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setUserId(session.user.id);
    setEmail(session.user.email || '');

    // Check if this is a new user welcome flow
    if (router.query.welcome === 'true') {
      setShowWelcome(true);
    }

    // Load profile from user_profiles - single source of truth
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    // Check if user has paid for ticket contesting
    setIsPaidUser(profileData?.has_contesting === true);

    if (profileData) {
      setFirstName(profileData.first_name || '');
      setLastName(profileData.last_name || '');
      setPhone(profileData.phone || profileData.phone_number || '');
      setHomeAddress(profileData.street_address || profileData.home_address_full || '');
      // Parse ward from home_address_ward if available
      if (profileData.home_address_ward) {
        const wardNum = parseInt(profileData.home_address_ward);
        if (!isNaN(wardNum)) setWard(wardNum);
      }
      setSection(profileData.home_address_section || '');
      setHomeCity(profileData.city || 'Chicago');
      setHomeState('IL'); // Chicago is in IL
      setHomeZip(profileData.zip_code || '');
      setMailingAddress1(profileData.mailing_address || '');
      setMailingAddress2(''); // user_profiles doesn't have line2, will be added
      setMailingCity(profileData.mailing_city || '');
      setMailingState(profileData.mailing_state || 'IL');
      setMailingZip(profileData.mailing_zip || '');
      setVin(profileData.vin || '');
      setVehicleType(profileData.vehicle_type || 'Sedan');
      setCityStickerExpiry(profileData.city_sticker_expiry || '');
      setLicensePlateExpiry(profileData.license_plate_expiry || '');
      setEmissionsDate(profileData.emissions_date || '');

      // Load plate from user_profiles
      if (profileData.license_plate) {
        setPlateNumber(profileData.license_plate);
        setPlateState(profileData.license_state || 'IL');
      }

      // Notification preferences
      if (profileData.notification_preferences) {
        const prefs = profileData.notification_preferences;
        setEmailNotifications(prefs.email ?? profileData.notify_email ?? true);
        setSmsNotifications(prefs.sms ?? profileData.notify_sms ?? false);
        setPhoneCallNotifications(prefs.phone_call ?? profileData.phone_call_enabled ?? false);
        setStreetCleaningAlerts(prefs.street_cleaning ?? true);
        setSnowBanAlerts(prefs.snow_ban ?? profileData.notify_snow_ban ?? true);
        setRenewalReminders(prefs.renewals ?? true);
        setNotificationDays(prefs.days_before || profileData.notify_days_array || [30, 7, 1]);
      } else {
        // Fallback to individual columns
        setEmailNotifications(profileData.notify_email ?? true);
        setSmsNotifications(profileData.notify_sms ?? false);
        setPhoneCallNotifications(profileData.phone_call_enabled ?? false);
        setSnowBanAlerts(profileData.notify_snow_ban ?? true);
        setNotificationDays(profileData.notify_days_array || [30, 7, 1]);
      }
    }

    // Also check monitored_plates for paid users (may have different plate)
    const { data: plateData } = await supabase
      .from('monitored_plates')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('status', 'active');

    // Check if user has any active plates
    setHasActivePlates(plateData && plateData.length > 0);

    if (plateData && plateData.length > 0) {
      // Use first active plate
      setPlateNumber(plateData[0].plate);
      setPlateState(plateData[0].state);
      setIsLeased(plateData[0].is_leased_or_company || false);
    }

    // Load autopilot settings
    const { data: settingsData } = await supabase
      .from('autopilot_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (settingsData) {
      setAutoMailEnabled(settingsData.auto_mail_enabled);
      setRequireApproval(settingsData.require_approval);
      setAllowedTicketTypes(settingsData.allowed_ticket_types || []);
      setEmailOnTicketFound(settingsData.email_on_ticket_found);
      setEmailOnLetterMailed(settingsData.email_on_letter_mailed);
      setEmailOnApprovalNeeded(settingsData.email_on_approval_needed);
    }

    setLoading(false);
    setTimeout(() => { initialLoadRef.current = false; }, 100);
  };

  const autoSave = useCallback(async () => {
    if (!userId || initialLoadRef.current) return;

    setSaveStatus('saving');

    const plateUpper = plateNumber.toUpperCase().trim();

    // Save to user_profiles - single source of truth
    await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email: email,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        phone_number: phone || null, // Legacy field
        street_address: homeAddress || null,
        home_address_full: homeAddress || null,
        home_address_ward: ward ? String(ward) : null,
        home_address_section: section || null,
        city: homeCity || 'chicago',
        zip_code: homeZip || null,
        mailing_address: mailingAddress1 || null,
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
        notify_days_array: notificationDays,
        notification_preferences: {
          email: emailNotifications,
          sms: smsNotifications,
          phone_call: phoneCallNotifications,
          street_cleaning: streetCleaningAlerts,
          snow_ban: snowBanAlerts,
          renewals: renewalReminders,
          days_before: notificationDays,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // For paid users, also update monitored_plates for ticket checking
    if (isPaidUser && plateUpper.length >= 2) {
      const { data: existingPlate } = await supabase
        .from('monitored_plates')
        .select('id')
        .eq('user_id', userId)
        .single();

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

    // Save autopilot settings (for ticket type preferences)
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
  }, [userId, email, firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      cityStickerExpiry, licensePlateExpiry, emissionsDate, emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, renewalReminders, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, isPaidUser]);

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
      streetCleaningAlerts, snowBanAlerts, renewalReminders, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, autoSave]);

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
      // Save any current profile data before checkout
      await autoSave();

      const response = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          lastName: lastName.trim() || null,
          plateNumber: plateNumber.trim() || null,
          plateState: plateState,
        }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error('Checkout error:', data.error);
      }
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Auto-lookup ward/section when address changes
  const lookupWardSection = async (address: string) => {
    if (!address || address.length < 5) {
      setWardLookupStatus('idle');
      setWardLookupMessage('');
      return;
    }

    setWardLookupStatus('loading');
    setWardLookupMessage('Looking up ward...');

    try {
      const response = await fetch(`/api/validate-address?address=${encodeURIComponent(address)}`);
      const data = await response.json();

      if (data.valid && data.ward && data.section) {
        setWard(data.ward);
        setSection(data.section);
        setWardLookupStatus('success');
        setWardLookupMessage(`Ward ${data.ward}, Section ${data.section}`);
      } else if (data.valid && !data.ward) {
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Address not in a street cleaning zone');
      } else {
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Could not verify address');
      }
    } catch (error) {
      setWardLookupStatus('error');
      setWardLookupMessage('Error looking up address');
    }
  };

  // Debounced address lookup
  const addressLookupRef = useRef<NodeJS.Timeout | null>(null);
  const handleAddressChange = (newAddress: string) => {
    setHomeAddress(newAddress);

    // Clear previous timeout
    if (addressLookupRef.current) {
      clearTimeout(addressLookupRef.current);
    }

    // Debounce the lookup
    addressLookupRef.current = setTimeout(() => {
      lookupWardSection(newAddress);
    }, 1000);
  };

  if (loading) {
    return (
      <div style={{ fontFamily: FONTS.body, padding: 48, textAlign: 'center' }}>
        <p style={{ color: COLORS.textMuted }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
      <Head>
        <title>Settings - Autopilot America</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Top Nav */}
      <nav style={{
        backgroundColor: COLORS.primary,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{
              fontFamily: FONTS.heading,
              fontSize: 20,
              fontWeight: 800,
              color: COLORS.textLight
            }}>
              AUTOPILOT<span style={{ color: COLORS.accent }}>.</span>
            </span>
          </Link>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Link href="/dashboard" style={{
              color: COLORS.textLight,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Dashboard
            </Link>
            {saveStatus !== 'idle' && (
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: COLORS.accent,
              }}>
                {saveStatus === 'saving' ? 'Saving...' : '✓ Saved'}
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Header */}
      <div style={{
        backgroundColor: COLORS.primary,
        padding: '24px 5% 70px',
        color: COLORS.textLight,
        marginBottom: -50,
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <h1 style={{
            fontFamily: FONTS.heading,
            fontSize: 28,
            fontWeight: 700,
            margin: '0 0 6px',
          }}>
            Settings
          </h1>
          <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{email}</p>
        </div>
      </div>

      <main style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '0 20px 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Welcome Banner for New Users */}
        {showWelcome && !isPaidUser && (
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `2px solid ${COLORS.accent}`,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ flex: '1 1 300px' }}>
                <h2 style={{
                  fontFamily: FONTS.heading,
                  fontSize: 22,
                  fontWeight: 700,
                  color: COLORS.primary,
                  margin: '0 0 8px',
                }}>
                  Welcome to Autopilot America!
                </h2>
                <p style={{ margin: '0 0 12px', fontSize: 15, color: COLORS.textDark }}>
                  Your free account is ready. You'll receive <strong>free notifications</strong> for:
                </p>
                <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: COLORS.textDark, fontSize: 14, lineHeight: 1.8 }}>
                  <li>New parking tickets on your plate</li>
                  <li>Street cleaning reminders</li>
                  <li>City sticker &amp; plate renewal dates</li>
                  <li>Snow ban alerts</li>
                </ul>
                <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
                  Complete your profile below to start receiving alerts.
                </p>
              </div>
              <div style={{
                flex: '0 0 auto',
                backgroundColor: COLORS.bgSection,
                borderRadius: 10,
                padding: 20,
                textAlign: 'center',
                minWidth: 240,
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>
                  Want automatic contesting?
                </p>
                <p style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 700, color: COLORS.primary }}>
                  $24<span style={{ fontSize: 16, fontWeight: 500 }}>/year</span>
                </p>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: COLORS.textMuted }}>
                  We monitor your plate weekly and mail contest letters automatically. 54% average dismissal rate.
                </p>
                <button
                  onClick={handleUpgrade}
                  disabled={checkoutLoading}
                  style={{
                    width: '100%',
                    backgroundColor: COLORS.accent,
                    color: COLORS.white,
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                    opacity: checkoutLoading ? 0.7 : 1,
                  }}
                >
                  {checkoutLoading ? 'Loading...' : 'Upgrade to Autopilot'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'none',
                border: 'none',
                fontSize: 20,
                color: COLORS.textMuted,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Warning Banner for Paid Users Without Plates or Last Name */}
        {isPaidUser && (!hasActivePlates || !lastName.trim()) && (
          <div style={{
            backgroundColor: '#FEF2F2',
            borderRadius: 12,
            border: `1px solid ${COLORS.danger}`,
            padding: '16px 24px',
            marginBottom: 20,
          }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#991B1B' }}>
              ⚠️ Action Required: Complete Your Profile
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#991B1B' }}>
              {!lastName.trim() && !hasActivePlates
                ? 'Your last name and license plate are missing. We need both to search for and contest your tickets.'
                : !lastName.trim()
                ? 'Your last name is missing. We need this to search for tickets on your behalf.'
                : 'Your license plate is missing. We need this to monitor for new tickets.'}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#7F1D1D' }}>
              Please fill in the missing information below to ensure your Autopilot service works correctly.
            </p>
          </div>
        )}

        {/* Upgrade CTA for Free Users (persistent, not welcome flow) */}
        {!showWelcome && !isPaidUser && (
          <div style={{
            backgroundColor: '#FFF7ED',
            borderRadius: 12,
            border: `1px solid ${COLORS.highlight}`,
            padding: '16px 24px',
            marginBottom: 20,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#9A3412' }}>
                  Upgrade to Autopilot - $24/year
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9A3412' }}>
                  Automatic ticket detection &amp; contesting with 54% average dismissal rate
                </p>
              </div>
              <button
                onClick={handleUpgrade}
                disabled={checkoutLoading}
                style={{
                  backgroundColor: COLORS.highlight,
                  color: COLORS.white,
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {checkoutLoading ? 'Loading...' : 'Upgrade Now'}
              </button>
            </div>
          </div>
        )}

        {/* Account Info */}
        <Card title="Account Info">
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.textMuted,
                backgroundColor: COLORS.bgSection,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: isPaidUser && !lastName.trim() ? COLORS.danger : COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Last Name {isPaidUser && <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>}
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${isPaidUser && !lastName.trim() ? COLORS.danger : COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
              {isPaidUser && !lastName.trim() && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.danger }}>
                  Required for ticket searches
                </p>
              )}
            </div>
          </div>
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Phone Number (for SMS alerts)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </Card>

        {/* Vehicle Information */}
        <Card title="Vehicle Information">
          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: isPaidUser && !plateNumber.trim() ? COLORS.danger : COLORS.textMuted,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}>
              License Plate {isPaidUser && <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>}
            </label>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: `2px solid ${isPaidUser && !plateNumber.trim() ? COLORS.danger : COLORS.primary}`,
              borderRadius: 8,
              padding: 4,
              backgroundColor: '#fff',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}>
              <select
                value={plateState}
                onChange={(e) => setPlateState(e.target.value)}
                style={{
                  backgroundColor: COLORS.primary,
                  color: '#fff',
                  fontSize: 11,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: 'none',
                  fontWeight: 700,
                  marginRight: 8,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
              <input
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                style={{
                  border: 'none',
                  fontSize: 22,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: COLORS.primary,
                  width: 130,
                  outline: 'none',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              />
            </div>
            {isPaidUser && !plateNumber.trim() && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: COLORS.danger }}>
                Required for ticket monitoring
              </p>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              fontSize: 14,
              color: COLORS.textDark,
            }}>
              <input
                type="checkbox"
                checked={isLeased}
                onChange={(e) => setIsLeased(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: COLORS.primary }}
              />
              Leased or company vehicle
            </label>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                VIN (optional)
              </label>
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="1HGBH41JXMN109186"
                maxLength={17}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Home Address */}
        <Card title="Home Address" badge={
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>For street cleaning alerts</span>
        }>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Street Address
            </label>
            <input
              type="text"
              value={homeAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              placeholder="123 Main Street, Chicago IL"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${wardLookupStatus === 'error' ? COLORS.highlight : COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
            {wardLookupMessage && (
              <div style={{
                marginTop: 6,
                fontSize: 12,
                color: wardLookupStatus === 'success' ? COLORS.accent
                     : wardLookupStatus === 'error' ? COLORS.highlight
                     : COLORS.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {wardLookupStatus === 'loading' && '⏳'}
                {wardLookupStatus === 'success' && '✓'}
                {wardLookupStatus === 'error' && '⚠'}
                {wardLookupMessage}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Ward <span style={{ fontSize: 10, fontWeight: 400 }}>(auto)</span>
              </label>
              <input
                type="text"
                value={ward ? `Ward ${ward}` : '—'}
                disabled
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.textMuted,
                  backgroundColor: COLORS.bgSection,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Section <span style={{ fontSize: 10, fontWeight: 400 }}>(auto)</span>
              </label>
              <input
                type="text"
                value={section || '—'}
                disabled
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.textMuted,
                  backgroundColor: COLORS.bgSection,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City
              </label>
              <input
                type="text"
                value={homeCity}
                onChange={(e) => setHomeCity(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                State
              </label>
              <select
                value={homeState}
                onChange={(e) => setHomeState(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                ZIP
              </label>
              <input
                type="text"
                value={homeZip}
                onChange={(e) => setHomeZip(e.target.value)}
                placeholder="60601"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Mailing Address */}
        <Card
          title="Mailing Address"
          badge={
            !isPaidUser ? (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: COLORS.warningLight,
                color: '#92400E',
              }}>
                AUTOPILOT ONLY
              </span>
            ) : undefined
          }
          greyed={!isPaidUser}
          upgradeContent={!isPaidUser ? (
            <div style={{
              backgroundColor: '#FFF7ED',
              border: `1px solid ${COLORS.highlight}`,
              borderRadius: 8,
              padding: 16,
            }}>
              <p style={{ margin: 0, fontSize: 14, color: '#9A3412' }}>
                <strong>Upgrade to Autopilot - $24/year</strong>
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9A3412' }}>
                Automatic ticket detection and contesting with 54% average dismissal rate. We monitor your plate weekly and mail contest letters automatically.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-block',
                marginTop: 12,
                padding: '10px 20px',
                backgroundColor: COLORS.highlight,
                color: '#fff',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Upgrade Now - $24/year
              </Link>
            </div>
          ) : undefined}
        >

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Street Address
            </label>
            <input
              type="text"
              value={mailingAddress1}
              onChange={(e) => setMailingAddress1(e.target.value)}
              placeholder="123 Main Street"
              disabled={!isPaidUser}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Apt / Unit
            </label>
            <input
              type="text"
              value={mailingAddress2}
              onChange={(e) => setMailingAddress2(e.target.value)}
              placeholder="Apt 4B"
              disabled={!isPaidUser}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City
              </label>
              <input
                type="text"
                value={mailingCity}
                onChange={(e) => setMailingCity(e.target.value)}
                placeholder="Chicago"
                disabled={!isPaidUser}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                State
              </label>
              <select
                value={mailingState}
                onChange={(e) => setMailingState(e.target.value)}
                disabled={!isPaidUser}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                ZIP
              </label>
              <input
                type="text"
                value={mailingZip}
                onChange={(e) => setMailingZip(e.target.value)}
                placeholder="60601"
                disabled={!isPaidUser}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card title="Notification Preferences">
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Email notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive alerts via email
              </p>
            </div>
            <Toggle checked={emailNotifications} onChange={setEmailNotifications} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                SMS notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive alerts via text message
              </p>
            </div>
            <Toggle checked={smsNotifications} onChange={setSmsNotifications} disabled={!phone} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Phone call alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive automated voice call reminders
              </p>
            </div>
            <Toggle checked={phoneCallNotifications} onChange={setPhoneCallNotifications} disabled={!phone} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Street cleaning alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Get notified before street cleaning days
              </p>
            </div>
            <Toggle checked={streetCleaningAlerts} onChange={setStreetCleaningAlerts} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Snow ban alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Get notified when snow parking bans are active
              </p>
            </div>
            <Toggle checked={snowBanAlerts} onChange={setSnowBanAlerts} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Renewal reminders
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Reminders for city sticker, plates, and emissions
              </p>
            </div>
            <Toggle checked={renewalReminders} onChange={setRenewalReminders} />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Days before to notify
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {NOTIFICATION_DAYS.map(day => (
                <label key={day} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `2px solid ${notificationDays.includes(day) ? COLORS.primary : COLORS.border}`,
                  backgroundColor: notificationDays.includes(day) ? `${COLORS.primary}10` : 'transparent',
                  fontSize: 14,
                }}>
                  <input
                    type="checkbox"
                    checked={notificationDays.includes(day)}
                    onChange={() => toggleNotificationDay(day)}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  {day === 0 ? 'Day of' : `${day} days`}
                </label>
              ))}
            </div>
          </div>
        </Card>

        {/* Renewal Dates */}
        <Card title="Renewal Dates" badge={
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>Optional</span>
        }>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City Sticker Expiry
              </label>
              <input
                type="date"
                value={cityStickerExpiry}
                onChange={(e) => setCityStickerExpiry(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                License Plate Expiry
              </label>
              <input
                type="date"
                value={licensePlateExpiry}
                onChange={(e) => setLicensePlateExpiry(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Emissions Test Date
              </label>
              <input
                type="date"
                value={emissionsDate}
                onChange={(e) => setEmissionsDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Autopilot Settings */}
        <Card title="Autopilot Settings" badge={
          isPaidUser ? (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 4,
              backgroundColor: COLORS.successLight,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              AUTOPILOT MEMBER
            </span>
          ) : (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: COLORS.warningLight,
              color: '#92400E',
            }}>
              AUTOPILOT ONLY
            </span>
          )
        } greyed={!isPaidUser}>
          {!isPaidUser && (
            <div style={{
              backgroundColor: '#FFF7ED',
              border: `1px solid ${COLORS.highlight}`,
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}>
              <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#9A3412' }}>
                Upgrade to Autopilot - $24/year
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#9A3412' }}>
                Automatic ticket detection and contesting with 54% average dismissal rate. We monitor your plate weekly and mail contest letters automatically.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-block',
                padding: '10px 20px',
                backgroundColor: COLORS.highlight,
                color: '#fff',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Upgrade Now - $24/year
              </Link>
            </div>
          )}

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Auto-mail letters
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Automatically mail contest letters when tickets are found
              </p>
            </div>
            <Toggle
              checked={autoMailEnabled}
              onChange={(checked) => {
                setAutoMailEnabled(checked);
                setRequireApproval(!checked);
              }}
              disabled={!isPaidUser}
            />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Require approval before mailing
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Review and approve letters before they're sent
              </p>
            </div>
            <Toggle
              checked={requireApproval}
              onChange={(checked) => {
                setRequireApproval(checked);
                setAutoMailEnabled(!checked);
              }}
              disabled={!isPaidUser}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Ticket types to auto-contest
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {TICKET_TYPES.map(type => (
                <label key={type.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  cursor: isPaidUser ? 'pointer' : 'not-allowed',
                  color: COLORS.textDark,
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: `1px solid ${allowedTicketTypes.includes(type.id) ? COLORS.primary : COLORS.border}`,
                  backgroundColor: allowedTicketTypes.includes(type.id) ? `${COLORS.primary}05` : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={allowedTicketTypes.includes(type.id)}
                    onChange={() => toggleTicketType(type.id)}
                    disabled={!isPaidUser}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  <span style={{ flex: 1 }}>{type.label}</span>
                  <span style={{
                    fontSize: 11,
                    color: type.winRate >= 60 ? COLORS.accent : type.winRate <= 20 ? COLORS.danger : COLORS.textMuted,
                    fontWeight: 600,
                  }}>
                    {type.winRate}%
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Email Notifications
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnTicketFound}
                  onChange={(e) => setEmailOnTicketFound(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when ticket is found
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnLetterMailed}
                  onChange={(e) => setEmailOnLetterMailed(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when letter is mailed
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnApprovalNeeded}
                  onChange={(e) => setEmailOnApprovalNeeded(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when approval is needed
              </label>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import styles from '../styles/Settings.module.css';

interface StreetCleaningProfile {
  home_address_full?: string;
  home_address_ward?: string;
  home_address_section?: string;
  notify_days_array?: number[];
  notify_evening_before?: boolean;
  phone_call_enabled?: boolean;
  voice_preference?: string;
  phone_call_time_preference?: string;
  snooze_until_date?: string;
  snooze_reason?: string;
  license_plate_street_cleaning?: string;
  sms_pro?: boolean;
  follow_up_sms?: boolean;
}

export default function StreetCleaningSettings() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  // Form state
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState('');
  const [section, setSection] = useState('');
  // Notification preferences
  const [notify0Day, setNotify0Day] = useState(false);
  const [notify1Day, setNotify1Day] = useState(true);
  const [notify2Days, setNotify2Days] = useState(false);
  const [notify3Days, setNotify3Days] = useState(false);
  const [notifyEveningBefore, setNotifyEveningBefore] = useState(false);
  
  // Voice call preferences
  const [phoneCallEnabled, setPhoneCallEnabled] = useState(false);
  const [voicePreference, setVoicePreference] = useState('female');
  const [callTimePreference, setCallTimePreference] = useState('7am');
  
  // SMS preferences
  const [followUpSMS, setFollowUpSMS] = useState(true);
  
  // Trip mode
  const [tripMode, setTripMode] = useState(false);
  const [tripStartDate, setTripStartDate] = useState('');
  const [tripEndDate, setTripEndDate] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) {
        // If profile doesn't exist, create one
        if (error.code === 'PGRST116') {
          console.log('Creating new user profile...');
          const { data: newProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert({
              user_id: user.id,
              email: user.email,
              notify_days_array: [1],
              follow_up_sms: true
            })
            .select()
            .single();
            
          if (createError) {
            console.error('Error creating profile:', createError);
            setError('Failed to create user profile');
            return;
          }
          
          // Use the new profile
          if (newProfile) {
            setHomeAddress(newProfile.home_address_full || '');
            setWard(newProfile.home_address_ward || '');
            setSection(newProfile.home_address_section || '');
            // License plate managed in main vehicle settings
          }
        } else {
          throw error;
        }
        return;
      }

      if (profile) {
        setHomeAddress(profile.home_address_full || '');
        setWard(profile.home_address_ward || '');
        setSection(profile.home_address_section || '');
        // License plate managed in main vehicle settings
        
        // Load notification days
        const daysArray = profile.notify_days_array || [1];
        setNotify0Day(daysArray.includes(0));
        setNotify1Day(daysArray.includes(1));
        setNotify2Days(daysArray.includes(2));
        setNotify3Days(daysArray.includes(3));
        
        setNotifyEveningBefore(profile.notify_evening_before || false);
        
        setPhoneCallEnabled(profile.phone_call_enabled || false);
        setVoicePreference(profile.voice_preference || 'female');
        setCallTimePreference(profile.phone_call_time_preference || '7am');
        
        setFollowUpSMS(profile.follow_up_sms !== false);
        
        // Trip mode
        if (profile.snooze_until_date) {
          setTripMode(true);
          setTripEndDate(profile.snooze_until_date);
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  // Auto-lookup address whenever homeAddress changes
  useEffect(() => {
    const lookupAddress = async () => {
      if (!homeAddress || homeAddress.length < 10) {
        setWard('');
        setSection('');
        return;
      }
      
      try {
        const response = await fetch(`/api/find-section?address=${encodeURIComponent(homeAddress)}`);
        const data = await response.json();
        
        if (data.ward && data.section) {
          setWard(data.ward);
          setSection(data.section);
          setMessage(`Address verified: Ward ${data.ward}, Section ${data.section}`);
          setError('');
        } else {
          setWard('');
          setSection('');
          setError('Address not found in Chicago street cleaning zone. Please try again.');
        }
      } catch (error) {
        console.error('Error looking up address:', error);
        setWard('');
        setSection('');
        setError('Unable to verify address. Please try again.');
      }
    };

    // Debounce the lookup
    const timeoutId = setTimeout(lookupAddress, 1000);
    return () => clearTimeout(timeoutId);
  }, [homeAddress]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build notify days array
      const notifyDays = [];
      if (notify0Day) notifyDays.push(0);
      if (notify1Day) notifyDays.push(1);
      if (notify2Days) notifyDays.push(2);
      if (notify3Days) notifyDays.push(3);

      const updates = {
        home_address_full: homeAddress,
        home_address_ward: ward,
        home_address_section: section,
        notify_days_array: notifyDays,
        notify_evening_before: notifyEveningBefore,
        phone_call_enabled: phoneCallEnabled,
        voice_preference: voicePreference,
        phone_call_time_preference: callTimePreference,
        // license_plate_street_cleaning removed - using main vehicle license_plate
        follow_up_sms: followUpSMS,
        snooze_until_date: tripMode ? tripEndDate : null,
        snooze_reason: tripMode ? 'trip' : null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (error) throw error;

      setMessage('Street cleaning preferences saved successfully!');
    } catch (error) {
      console.error('Error saving:', error);
      setError('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickSnooze = async () => {
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    setTripEndDate(oneWeekFromNow.toISOString().split('T')[0]);
    setTripMode(true);
    setMessage('Notifications snoozed for 1 week');
  };

  if (loading) return <div>Loading street cleaning settings...</div>;

  return (
    <div className={styles.settingsSection}>
      <h2>🧹 Street Cleaning Alerts</h2>
      
      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.formGroup}>
        <label>Home Address</label>
        <input
          type="text"
          value={homeAddress}
          onChange={(e) => setHomeAddress(e.target.value)}
          placeholder="123 N State St, Chicago, IL"
        />
        {ward && section && (
          <div className={styles.addressInfo}>
            ✓ Ward {ward}, Section {section}
          </div>
        )}
      </div>

      {/* Park Here Instead Feature */}
      {ward && section && (
        <div className={styles.formGroup}>
          <label>🅿️ Alternative Parking Zones</label>
          <div className={styles.parkHereSection}>
            <p className={styles.helpText}>
              Find nearby zones where you can safely park during street cleaning in your area.
            </p>
            <button 
              type="button"
              onClick={() => router.push('/parking-map')}
              className={styles.linkButton}
            >
              📍 View Alternative Parking Map
            </button>
            <p className={styles.smallText}>
              Interactive map showing Ward {ward}, Section {section} and nearby parking alternatives
            </p>
          </div>
        </div>
      )}

      <div className={styles.formGroup}>
        <label>When to Send Reminders</label>
        <div className={styles.checkboxGroup}>
          <label>
            <input
              type="checkbox"
              checked={notify0Day}
              onChange={(e) => setNotify0Day(e.target.checked)}
            />
            Morning of cleaning (7 AM)
          </label>
          <label>
            <input
              type="checkbox"
              checked={notify1Day}
              onChange={(e) => setNotify1Day(e.target.checked)}
            />
            1 day before
          </label>
          <label>
            <input
              type="checkbox"
              checked={notify2Days}
              onChange={(e) => setNotify2Days(e.target.checked)}
            />
            2 days before
          </label>
          <label>
            <input
              type="checkbox"
              checked={notify3Days}
              onChange={(e) => setNotify3Days(e.target.checked)}
            />
            3 days before
          </label>
          <label>
            <input
              type="checkbox"
              checked={notifyEveningBefore}
              onChange={(e) => setNotifyEveningBefore(e.target.checked)}
            />
            Evening before (7 PM)
          </label>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>Additional Alerts</label>
        <div className={styles.checkboxGroup}>
          <label>
            <input
              type="checkbox"
              checked={followUpSMS}
              onChange={(e) => setFollowUpSMS(e.target.checked)}
            />
            Follow-up SMS after cleaning
          </label>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>Voice Call Preferences</label>
        <div className={styles.checkboxGroup}>
          <label>
            <input
              type="checkbox"
              checked={phoneCallEnabled}
              onChange={(e) => setPhoneCallEnabled(e.target.checked)}
            />
            Enable voice call reminders
          </label>
        </div>
        {phoneCallEnabled && (
          <>
            <select 
              value={voicePreference}
              onChange={(e) => setVoicePreference(e.target.value)}
            >
              <option value="female">Female voice</option>
              <option value="male">Male voice</option>
            </select>
            <select
              value={callTimePreference}
              onChange={(e) => setCallTimePreference(e.target.value)}
            >
              <option value="7am">7 AM</option>
              <option value="8am">8 AM</option>
              <option value="6pm">6 PM</option>
              <option value="7pm">7 PM</option>
            </select>
          </>
        )}
      </div>

      <div className={styles.formGroup}>
        <label>Trip Mode / Snooze Notifications</label>
        <div className={styles.checkboxGroup}>
          <label>
            <input
              type="checkbox"
              checked={tripMode}
              onChange={(e) => setTripMode(e.target.checked)}
            />
            Pause notifications while away
          </label>
        </div>
        {tripMode && (
          <div className={styles.dateGroup}>
            <input
              type="date"
              value={tripStartDate}
              onChange={(e) => setTripStartDate(e.target.value)}
              placeholder="Start date"
            />
            <input
              type="date"
              value={tripEndDate}
              onChange={(e) => setTripEndDate(e.target.value)}
              placeholder="End date"
            />
          </div>
        )}
        <button onClick={handleQuickSnooze} className={styles.secondaryButton}>
          Quick Snooze (1 Week)
        </button>
      </div>

      <button 
        onClick={handleSave}
        disabled={saving}
        className={styles.primaryButton}
      >
        {saving ? 'Saving...' : 'Save Street Cleaning Preferences'}
      </button>

    </div>
  );
}
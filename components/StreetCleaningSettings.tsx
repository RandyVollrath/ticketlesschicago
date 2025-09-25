import React, { useState, useEffect } from 'react';
import { createClient } from '../lib/supabase/client';
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
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  // Form state
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState('');
  const [section, setSection] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  
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
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (profile) {
        setHomeAddress(profile.home_address_full || '');
        setWard(profile.home_address_ward || '');
        setSection(profile.home_address_section || '');
        setLicensePlate(profile.license_plate_street_cleaning || '');
        
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

  const lookupAddress = async () => {
    if (!homeAddress) return;
    
    setMessage('Looking up address...');
    try {
      const response = await fetch(`/api/find-section?address=${encodeURIComponent(homeAddress)}`);
      const data = await response.json();
      
      if (data.ward && data.section) {
        setWard(data.ward);
        setSection(data.section);
        setMessage(`Found: Ward ${data.ward}, Section ${data.section}`);
      } else {
        setError('Address not found in Chicago street cleaning zones');
      }
    } catch (error) {
      console.error('Error looking up address:', error);
      setError('Failed to lookup address');
    }
  };

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
        license_plate_street_cleaning: licensePlate,
        follow_up_sms: followUpSMS,
        snooze_until_date: tripMode ? tripEndDate : null,
        snooze_reason: tripMode ? 'trip' : null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', user.id);

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
        <button onClick={lookupAddress} className={styles.secondaryButton}>
          Look Up Ward/Section
        </button>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Ward</label>
          <input
            type="text"
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            placeholder="e.g., 42"
          />
        </div>
        <div className={styles.formGroup}>
          <label>Section</label>
          <input
            type="text"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g., 15"
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>License Plate (for $60 ticket guarantee)</label>
        <input
          type="text"
          value={licensePlate}
          onChange={(e) => setLicensePlate(e.target.value)}
          placeholder="ABC123"
        />
      </div>

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
            Pause notifications (voids $60 guarantee)
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
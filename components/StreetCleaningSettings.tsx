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

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
}

export default function StreetCleaningSettings() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
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
  
  // Alternative parking zones
  const [alternativeSections, setAlternativeSections] = useState<AlternativeSection[]>([]);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [parkHereError, setParkHereError] = useState('');
  const [parkHereRetryCount, setParkHereRetryCount] = useState(0);

  // Street cleaning status
  const [nextCleaningDate, setNextCleaningDate] = useState<string | null>(null);

  // Helper to check if a date is today (timezone-safe string comparison)
  const isToday = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    return dateStr === todayStr;
  };
  const [cleaningStatus, setCleaningStatus] = useState<'today' | 'next-3-days' | 'later' | 'unknown'>('unknown');
  const [loadingCleaningInfo, setLoadingCleaningInfo] = useState(false);
  
  // Mailing address for auto-fill
  const [mailingAddress, setMailingAddress] = useState('');

  // Calendar download
  const [calendarDownloading, setCalendarDownloading] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  // Load alternative parking zones when ward/section changes
  useEffect(() => {
    if (ward && section) {
      loadAlternativeParkingZones();
      loadNextCleaningInfo();
    }
  }, [ward, section, parkHereRetryCount]);

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
        // Auto-fill from mailing address if street cleaning address is empty
        const mailingAddr = profile.mailing_address ? 
          `${profile.mailing_address}${profile.mailing_city ? ', ' + profile.mailing_city : ''}${profile.mailing_state ? ', ' + profile.mailing_state : ''}${profile.mailing_zip ? ' ' + profile.mailing_zip : ''}` : '';
        setMailingAddress(mailingAddr);
        
        // Use existing home address or auto-fill from mailing address
        const addressToUse = profile.home_address_full || mailingAddr;
        setHomeAddress(addressToUse);
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
      // Mark initial load as complete after a short delay to prevent immediate auto-save
      setTimeout(() => setInitialLoadComplete(true), 500);
    }
  };

  // Load next cleaning information
  const loadNextCleaningInfo = async () => {
    if (!ward || !section) return;
    
    setLoadingCleaningInfo(true);
    
    try {
      const response = await fetch(`/api/get-street-cleaning-data`);
      const result = await response.json();
      
      if (response.ok && result.success && result.data) {
        // Find the zone matching our ward/section
        const zone = result.data.find((z: any) => z.ward === ward && z.section === section);
        
        if (zone && zone.nextCleaningDateISO) {
          setNextCleaningDate(zone.nextCleaningDateISO);
          
          // Calculate days until cleaning for more precise status
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const cleaningDate = new Date(zone.nextCleaningDateISO + 'T12:00:00');
          cleaningDate.setHours(0, 0, 0, 0);
          const diffTime = cleaningDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Set more precise status based on actual days
          if (diffDays === 0) {
            setCleaningStatus('today');
          } else if (diffDays === 1) {
            setCleaningStatus('tomorrow');
          } else if (diffDays >= 2 && diffDays <= 3) {
            setCleaningStatus('next-3-days');
          } else if (zone.cleaningStatus === 'later') {
            setCleaningStatus('later');
          } else {
            setCleaningStatus('unknown');
          }
        } else {
          // Ward/section combination not found in API data
          console.warn(`Ward ${ward}, Section ${section} not found in street cleaning data`);
          setNextCleaningDate(null);
          setCleaningStatus('invalid_zone');
          
          // Set error message to help user fix the issue
          setError(`Ward ${ward}, Section ${section} is not a valid street cleaning zone. Please update your address.`);
        }
      } else {
        setNextCleaningDate(null);
        setCleaningStatus('unknown');
      }
    } catch (error) {
      console.error('Error loading cleaning info:', error);
      setNextCleaningDate(null);
      setCleaningStatus('unknown');
    } finally {
      setLoadingCleaningInfo(false);
    }
  };

  // Load alternative parking zones
  const loadAlternativeParkingZones = async () => {
    if (!ward || !section) return;
    
    setLoadingAlternatives(true);
    setParkHereError('');
    
    try {
      const response = await fetch(`/api/find-alternative-parking?ward=${ward}&section=${section}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load parking alternatives');
      }
      
      setAlternativeSections(data.alternatives || []);
    } catch (error: any) {
      console.error('Error loading alternative parking zones:', error);
      setParkHereError(error.message || 'Unable to load alternative parking zones. Please try again.');
    } finally {
      setLoadingAlternatives(false);
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
        
        if (response.ok && data.ward && data.section) {
          setWard(data.ward);
          setSection(data.section);
          setMessage(`Address verified: Ward ${data.ward}, Section ${data.section}`);
          setError('');
        } else {
          setWard('');
          setSection('');
          
          // Handle specific API error messages
          if (data.error === 'Invalid address format') {
            setError(data.message || 'Please enter a valid Chicago street address with a street number and name.');
          } else if (data.error === 'Address not found') {
            setError('Address not found. Please check the address and try again.');
          } else if (data.error === 'Street cleaning information not available for this location') {
            setError('Street cleaning information not available for this address. This may be private property, a park, or an area where street cleaning doesn\'t apply.');
          } else {
            setError(data.message || 'Address not found in Chicago street cleaning zone. Please try again.');
          }
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

  // Auto-save function using the profile API endpoint
  const autoSaveProfile = async (updates: any) => {
    if (!updates || Object.keys(updates).length === 0) return;
    
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          ...updates
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save preferences');
      }

      console.log('Auto-saved street cleaning preferences');
    } catch (error) {
      console.error('Error auto-saving:', error);
      setError('Auto-save failed');
    } finally {
      setSaving(false);
    }
  };

  // Debounced auto-save with 2-second delay
  useEffect(() => {
    // Skip auto-save during initial load
    if (!initialLoadComplete) return;

    // Skip auto-save if no valid address data (ward and section are required for valid street cleaning setup)
    // This prevents "Auto-save failed" errors when the user hasn't entered an address yet
    if (!ward || !section) {
      console.log('Skipping auto-save: No valid address data yet');
      return;
    }

    const timeoutId = setTimeout(() => {
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
        follow_up_sms: followUpSMS,
        snooze_until_date: tripMode ? tripEndDate : null,
        snooze_reason: tripMode ? 'trip' : null,
        updated_at: new Date().toISOString()
      };

      autoSaveProfile(updates);
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [initialLoadComplete, homeAddress, ward, section, notify0Day, notify1Day, notify2Days, notify3Days,
      notifyEveningBefore, phoneCallEnabled, voicePreference, callTimePreference,
      followUpSMS, tripMode, tripEndDate]);

  const handleQuickSnooze = async () => {
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    setTripEndDate(oneWeekFromNow.toISOString().split('T')[0]);
    setTripMode(true);
    setMessage('Notifications snoozed for 1 week');
  };

  const handleUseMailingAddress = () => {
    if (mailingAddress) {
      setHomeAddress(mailingAddress);
      setMessage('Address updated from mailing address');
    }
  };

  const handleCalendarDownload = async () => {
    if (!ward || !section) {
      setError('Please set your home address first to download the calendar');
      return;
    }

    setCalendarDownloading(true);
    setCalendarMessage('');
    setError('');

    try {
      const apiUrl = `/api/generate-calendar?ward=${ward}&section=${section}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        let errorMsg = 'Failed to generate calendar';
        try {
          const err = await response.json();
          errorMsg = err.message || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const icsText = await response.text();
      const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `street_cleaning_w${ward}_s${section}.ics`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setCalendarMessage('✓ Calendar downloaded! Import it into your calendar app.');
      setTimeout(() => setCalendarMessage(''), 5000);
    } catch (error: any) {
      setError(error.message || 'Failed to download calendar');
    } finally {
      setCalendarDownloading(false);
    }
  };

  const renderCleaningStatus = () => {
    if (loadingCleaningInfo) {
      return (
        <div className={styles.cleaningStatus}>
          <span>🔍 Checking street cleaning schedule...</span>
        </div>
      );
    }

    if (!ward || !section) {
      return null;
    }

    let statusIcon = '📅';
    let statusText = '';
    let statusClass = '';

    switch (cleaningStatus) {
      case 'today':
        statusIcon = '🚨';
        statusText = 'Street cleaning is TODAY!';
        statusClass = 'today';
        break;
      case 'tomorrow':
        statusIcon = '⚠️';
        statusText = 'Street cleaning is TOMORROW';
        statusClass = 'soon';
        break;
      case 'next-3-days':
        statusIcon = '⚠️';
        statusText = 'Street cleaning in the next 3 days';
        statusClass = 'soon';
        break;
      case 'later':
        statusIcon = '📅';
        statusText = 'No street cleaning in the next 3 days';
        statusClass = 'later';
        break;
      case 'invalid_zone':
        statusIcon = '❌';
        statusText = 'Invalid ward/section combination';
        statusClass = 'error';
        break;
      default:
        statusIcon = '❓';
        statusText = 'Street cleaning schedule unknown';
        statusClass = 'unknown';
    }

    // Format the date display based on the status
    let dateDisplay = '';
    if (nextCleaningDate) {
      if (cleaningStatus === 'today') {
        dateDisplay = 'Today';
      } else if (cleaningStatus === 'tomorrow') {
        dateDisplay = 'Tomorrow';
      } else {
        const cleaningDate = new Date(nextCleaningDate + 'T12:00:00');
        dateDisplay = cleaningDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
    }

    return (
      <div className={`${styles.cleaningStatus} ${styles[statusClass]}`}>
        <span>{statusIcon} {statusText}</span>
        {nextCleaningDate && (
          <div className={styles.nextCleaningDate}>
            Next cleaning: {dateDisplay}
          </div>
        )}
      </div>
    );
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
        {mailingAddress && homeAddress !== mailingAddress && (
          <button
            type="button"
            onClick={handleUseMailingAddress}
            className={styles.useMailingButton}
          >
            Use Mailing Address ({mailingAddress})
          </button>
        )}
        {ward && section && (
          <div className={styles.addressInfo}>
            ✓ Ward {ward}, Section {section}
          </div>
        )}
        {renderCleaningStatus()}
        {ward && section && (
          <div style={{ marginTop: '12px' }}>
            <button
              type="button"
              onClick={handleCalendarDownload}
              disabled={calendarDownloading}
              className={styles.calendarButton}
              style={{
                padding: '10px 16px',
                backgroundColor: calendarDownloading ? '#9ca3af' : '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: calendarDownloading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              📅 {calendarDownloading ? 'Generating Calendar...' : 'Download Calendar (.ics)'}
            </button>
            {calendarMessage && (
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                backgroundColor: '#dcfce7',
                color: '#166534',
                borderRadius: '6px',
                fontSize: '13px'
              }}>
                {calendarMessage}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Park Here Instead Feature - MSC Style */}
      {ward && section && (
        <div className={styles.formGroup}>
          <label>Park Here Instead</label>
          <div className={styles.parkHereInfo}>
            <p className={styles.parkHereDescription}>
              Safe parking zones nearby that <strong>do not have cleaning conflicts</strong> when your area does:
            </p>
            <div className={styles.safetyNote}>
              <span className={styles.safetyIcon}>✓</span>
              <span>These zones are specifically filtered to avoid parking conflicts with your cleaning schedule</span>
            </div>
            
            {loadingAlternatives ? (
              <div className={styles.parkHereLoading}>
                <span>Finding safe parking alternatives without cleaning conflicts...</span>
              </div>
            ) : parkHereError ? (
              <div className={styles.parkHereError}>
                <div className={styles.errorContent}>
                  <span className={styles.errorIcon}>!</span>
                  <div>
                    <p className={styles.errorMessage}>{parkHereError}</p>
                    {parkHereRetryCount < 3 && (
                      <button 
                        className={styles.retryButton}
                        onClick={() => {
                          setParkHereRetryCount(prev => prev + 1);
                        }}
                      >
                        Try Again
                      </button>
                    )}
                    {parkHereRetryCount >= 3 && (
                      <p className={styles.maxRetriesText}>
                        Please try refreshing the page or contact support if the problem persists.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : alternativeSections.length > 0 ? (
              <div className={styles.parkHereZones}>
                {alternativeSections.map((zone, index) => (
                  <div key={`${zone.ward}-${zone.section}`} className={styles.zoneCard}>
                    <div className={styles.zoneHeader}>
                      <h4 className={styles.zoneTitle}>
                        Ward {zone.ward}, Section {zone.section}
                        {zone.distance_type === 'same_ward' && (
                          <span className={styles.sameWardBadge}>Same Ward</span>
                        )}
                      </h4>
                      <span className={styles.zoneDistance}>
                        {zone.distance_type === 'same_ward' ? 'Same ward' : 'Adjacent ward'}
                      </span>
                    </div>
                    
                    {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                      <div className={styles.streetBoundaries}>
                        <strong>Area boundaries:</strong>
                        <ul>
                          {zone.street_boundaries.map((boundary: string, i: number) => (
                            <li key={i}>{boundary}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {zone.next_cleaning_date && (
                      <div className={styles.nextCleaning} style={{
                        color: isToday(zone.next_cleaning_date) ? '#dc2626' : 'inherit',
                        fontWeight: isToday(zone.next_cleaning_date) ? '600' : 'normal'
                      }}>
                        {isToday(zone.next_cleaning_date) ? (
                          <><strong>🚨 Street cleaning TODAY</strong> (9am-2pm) - Don't park here!</>
                        ) : (
                          <><strong>Next cleaning:</strong> {new Date(zone.next_cleaning_date).toLocaleDateString()}</>
                        )}
                      </div>
                    )}
                    
                    <button 
                      className={styles.viewOnMapButton}
                      onClick={() => {
                        // Open parking map with the specific section highlighted
                        const mapUrl = `/parking-map?ward=${zone.ward}&section=${zone.section}&highlight=true`;
                        window.open(mapUrl, '_blank');
                      }}
                    >
                      View on Map
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.noAlternatives}>
                <p>No safe parking alternatives found nearby without cleaning conflicts. Try the main parking map to explore all zones:</p>
                <button 
                  type="button"
                  onClick={() => router.push('/parking-map')}
                  className={styles.linkButton}
                >
                  View Full Parking Map
                </button>
              </div>
            )}
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
              checked={notifyEveningBefore}
              onChange={(e) => setNotifyEveningBefore(e.target.checked)}
            />
            Evening before (7 PM)
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

      {/* Auto-save status indicator */}
      {saving && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#eff6ff',
          border: '1px solid #dbeafe',
          borderRadius: '6px',
          fontSize: '14px',
          color: '#1d4ed8',
          textAlign: 'center'
        }}>
          Auto-saving...
        </div>
      )}

    </div>
  );
}
# Parking API - Exact Code Sections by File

## File 1: BackgroundTaskService.ts - triggerParkingCheck()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Lines**: 1122-1347

**Key Code Sections**:

### Function Signature (Line 1122)
```typescript
private async triggerParkingCheck(
  presetCoords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  },
  isRealParkingEvent: boolean = true,
  nativeTimestamp?: number,
  persistParkingEvent: boolean = true
): Promise<void>
```

### Call API (Lines 1228-1236)
```typescript
// Check parking rules
let result;
try {
  result = await LocationService.checkParkingLocation(coords);
} catch (apiError) {
  log.error('Parking API call failed:', apiError);
  await this.sendDiagnosticNotification(
    'Parking API Failed',
    `Got GPS (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}) but API call failed: ${String(apiError)}`
  );
  throw apiError;
}
```

### Schedule Reminders (Lines 1310-1321)
```typescript
// Schedule advance reminder notifications for upcoming restrictions.
// IMPORTANT: Always call this, even when rules.length === 0, because
// the spot may be clear NOW but have upcoming restrictions (e.g., street
// cleaning tomorrow). Use rawApiData which has the full response including
// UPCOMING timing, not the filtered rules array.
if (persistParkingEvent) {
  try {
    await this.scheduleRestrictionReminders(rawData, coords);
  } catch (reminderError) {
    log.warn('Failed to schedule restriction reminders (non-fatal):', reminderError);
  }
}
```

---

## File 2: BackgroundTaskService.ts - scheduleRestrictionReminders()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Lines**: 1530-1709

**Function Signature** (Line 1530)
```typescript
private async scheduleRestrictionReminders(
  result: any,
  coords: { latitude: number; longitude: number }
): Promise<void>
```

**Key Sections**:

### Street Cleaning - Two Notifications (Lines 1541-1587)
```typescript
// Street cleaning reminders — 9pm night before + 7am morning of
if (result.streetCleaning?.hasRestriction && result.streetCleaning?.nextDate) {
  const schedule = result.streetCleaning.schedule || '9am–3pm (estimated)';
  const dateParts = result.streetCleaning.nextDate.split('-');
  if (dateParts.length === 3) {
    const cleaningDate = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1, // Month is 0-indexed
      parseInt(dateParts[2], 10),
      9, 0, 0, 0 // 9 AM local time
    );

    if (!isNaN(cleaningDate.getTime()) && cleaningDate.getTime() > Date.now()) {
      const dayName = cleaningDate.toLocaleDateString('en-US', { weekday: 'long' });
      const monthDay = cleaningDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Notification 1: 9pm the night before cleaning
      const nightBefore9pm = new Date(cleaningDate);
      nightBefore9pm.setDate(nightBefore9pm.getDate() - 1);
      nightBefore9pm.setHours(21, 0, 0, 0); // 9 PM

      if (nightBefore9pm.getTime() > Date.now()) {
        restrictions.push({
          type: 'street_cleaning',
          restrictionStartTime: nightBefore9pm,
          address: result.address || '',
          details: `Street cleaning ${dayName} ${monthDay}, ${schedule}. Move your car tonight to avoid a $60 ticket.`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      }

      // Notification 2: 7am morning of cleaning
      const morningOf7am = new Date(cleaningDate);
      morningOf7am.setHours(7, 0, 0, 0); // 7 AM

      if (morningOf7am.getTime() > Date.now()) {
        restrictions.push({
          type: 'street_cleaning',
          restrictionStartTime: morningOf7am,
          address: result.address || '',
          details: `Street cleaning starts at 9am today (${schedule}). MOVE YOUR CAR NOW — $60 ticket.`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      }
    }
  }
}
```

### Winter Ban - Single Notification (Lines 1591-1617)
```typescript
// Winter overnight ban reminder — 9pm (before 3am ban)
if (result.winterOvernightBan?.active || result.winterBan?.found) {
  const now = new Date();
  const currentHour = now.getHours();

  // Schedule for 9pm tonight if before 9pm, or 9pm tomorrow if already past
  if (currentHour < 3 || currentHour >= 7) {
    const next9pm = new Date(now);
    next9pm.setHours(21, 0, 0, 0); // 9 PM

    // If it's already past 9pm, schedule for tomorrow 9pm
    if (currentHour >= 21) {
      next9pm.setDate(next9pm.getDate() + 1);
    }

    if (next9pm.getTime() > Date.now()) {
      restrictions.push({
        type: 'winter_ban',
        restrictionStartTime: next9pm,
        address: result.address || '',
        details: 'Winter overnight parking ban 3am–7am. Move before 3am or risk towing ($150+).',
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    }
  }
  // If currently in ban hours (3am-7am), don't schedule - user should already know
}
```

### Pass to LocalNotificationService (Lines 1705-1708)
```typescript
if (restrictions.length > 0) {
  await LocalNotificationService.scheduleNotificationsForParking(restrictions);
  log.info(`Scheduled ${restrictions.length} local reminder notifications`);
}
```

---

## File 3: LocationService.ts - checkParkingLocation()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Lines**: 808-929

**Function Signature** (Line 808)
```typescript
async checkParkingLocation(coords: Coordinates): Promise<ParkingCheckResult>
```

**API Call** (Lines 825-840)
```typescript
// Pass accuracy to server so it can decide whether to snap-to-street
const accuracyParam = coords.accuracy ? `&accuracy=${coords.accuracy.toFixed(1)}` : '';
const confidenceParam = (coords as EnhancedCoordinates).confidence
  ? `&confidence=${(coords as EnhancedCoordinates).confidence}`
  : '';
const endpoint = `/api/mobile/check-parking?lat=${coords.latitude}&lng=${coords.longitude}${accuracyParam}${confidenceParam}`;

// Use rate-limited request with caching
const response = await RateLimiter.rateLimitedRequest(
  endpoint,
  async () => {
    return ApiClient.get<any>(endpoint, {
      retries: 3,
      timeout: 20000, // 20 second timeout for location checks
      showErrorAlert: false, // Handle errors ourselves
    });
  },
  {
    cacheDurationMs: 30000, // Cache for 30 seconds
  }
);
```

**Parse Response & Build Rules** (Lines 865-929)
```typescript
const data = response.data;
const rules: ParkingRule[] = [];

// Street cleaning - only show as active restriction if it's NOW or TODAY
// Don't show UPCOMING as it means it's off-season (like January, before April 1)
if (data?.streetCleaning?.hasRestriction &&
    (data.streetCleaning.timing === 'NOW' || data.streetCleaning.timing === 'TODAY')) {
  const severity = data.streetCleaning.timing === 'NOW' ? 'critical' : 'warning';
  rules.push({
    type: 'street_cleaning',
    message: data.streetCleaning.message,
    severity: severity as 'critical' | 'warning',
    schedule: data.streetCleaning.schedule,
    nextDate: data.streetCleaning.nextDate,
    isActiveNow: data.streetCleaning.timing === 'NOW',
  });
}

// Winter overnight ban
if (data?.winterOvernightBan?.active) {
  rules.push({
    type: 'winter_ban',
    message: data.winterOvernightBan.message,
    severity: (data.winterOvernightBan.severity || 'warning') as 'critical' | 'warning' | 'info',
    schedule: `${data.winterOvernightBan.startTime} - ${data.winterOvernightBan.endTime}`,
    isActiveNow: true,
  });
}

// 2-inch snow ban (most urgent - tow risk)
if (data?.twoInchSnowBan?.active) {
  rules.push({
    type: 'snow_route',
    message: data.twoInchSnowBan.message,
    severity: (data.twoInchSnowBan.severity || 'critical') as 'critical' | 'warning' | 'info',
    isActiveNow: true,
  });
}

// Permit zones - show if in zone (even if not currently restricted)
if (data?.permitZone?.inPermitZone) {
  const severity = data.permitZone.permitRequired ? 'warning' :
                   (data.permitZone.severity || 'info');
  rules.push({
    type: 'permit_zone',
    message: data.permitZone.message,
    severity: severity as 'critical' | 'warning' | 'info',
    zoneName: data.permitZone.zoneName,
    schedule: data.permitZone.restrictionSchedule,
    isActiveNow: data.permitZone.permitRequired,
  });
}

// Sort rules by severity (critical first, then warning, then info)
const severityOrder = { critical: 0, warning: 1, info: 2 };
rules.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

return {
  coords,
  address: data?.address || `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
  rules,
  timestamp: Date.now(),
  rawApiData: data, // Preserve for BackgroundTaskService advance reminder scheduling
};
```

**Interfaces** (Lines 14-75)
```typescript
export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  // Additional metadata for enhanced display
  schedule?: string;
  zoneName?: string;
  nextDate?: string;
  isActiveNow?: boolean;
}

export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
  /** Raw API response data — used by BackgroundTaskService for scheduling advance reminders */
  rawApiData?: any;
}
```

---

## File 4: LocationService.ts - saveParkedLocationToServer()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Lines**: 942-983

**Function Signature** (Lines 942-947)
```typescript
async saveParkedLocationToServer(
  coords: Coordinates,
  parkingData: any,
  address: string,
  fcmToken: string
): Promise<{ success: boolean; id?: string }>
```

**Full Implementation** (Lines 948-983)
```typescript
try {
  const payload: any = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    address,
    fcm_token: fcmToken,
    on_winter_ban_street: !!(parkingData?.winterOvernightBan?.active || parkingData?.winterBan?.found),
    winter_ban_street_name: parkingData?.winterOvernightBan?.streetName || null,
    on_snow_route: !!(parkingData?.twoInchSnowBan?.active || parkingData?.snowRoute),
    snow_route_name: parkingData?.twoInchSnowBan?.streetName || null,
    street_cleaning_date: parkingData?.streetCleaning?.nextDate || null,
    street_cleaning_ward: parkingData?.streetCleaning?.ward || null,
    street_cleaning_section: parkingData?.streetCleaning?.section || null,
    permit_zone: parkingData?.permitZone?.zoneName || null,
    permit_restriction_schedule: parkingData?.permitZone?.restrictionSchedule || null,
  };

  const response = await ApiClient.authPost<any>('/api/mobile/save-parked-location', payload, {
    retries: 2,
    timeout: 15000,
    showErrorAlert: false,
  });

  if (response.success && response.data) {
    log.info('Parked location saved to server', { id: response.data.id });
    return { success: true, id: response.data.id };
  }

  log.warn('Failed to save parked location to server', response.error);
  return { success: false };
} catch (error) {
  // Non-fatal: server save is for cron reminders, local notifications still work
  log.error('Error saving parked location to server (non-fatal)', error);
  return { success: false };
}
```

---

## File 5: LocalNotificationService.ts - scheduleNotificationsForParking()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocalNotificationService.ts`

**Lines**: 126-267

**Main Entry** (Lines 126-151)
```typescript
async scheduleNotificationsForParking(restrictions: ParkingRestriction[]): Promise<void> {
  if (!this.preferences.enabled) {
    log.debug('Local notifications disabled by user preference');
    return;
  }

  // Cancel any existing scheduled notifications first
  await this.cancelAllScheduledNotifications();

  const scheduled: ScheduledNotification[] = [];

  for (const restriction of restrictions) {
    try {
      const notification = await this.scheduleRestrictionNotification(restriction);
      if (notification) {
        scheduled.push(notification);
      }
    } catch (error) {
      log.error(`Error scheduling notification for ${restriction.type}`, error);
    }
  }

  // Store scheduled notifications for tracking
  await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(scheduled));
  log.info(`Scheduled ${scheduled.length} parking reminder notifications`);
}
```

**Schedule Single Notification** (Lines 156-267)
```typescript
private async scheduleRestrictionNotification(
  restriction: ParkingRestriction
): Promise<ScheduledNotification | null> {
  const { type, restrictionStartTime, address, details, latitude, longitude } = restriction;

  // Calculate reminder time based on preferences
  let hoursBefore: number;
  let notificationId: string;
  let channelId: string;
  let title: string;
  let body: string;

  switch (type) {
    case 'street_cleaning':
      hoursBefore = 0; // Time is pre-computed by BackgroundTaskService
      notificationId = `${NOTIFICATION_PREFIX.STREET_CLEANING}${Date.now()}`;
      channelId = 'reminders';
      // Detect notification subtype from details content:
      // 1. Enforcement risk follow-up (peak window reminder)
      // 2. Morning-of street cleaning (7am, MOVE NOW)
      // 3. Night-before street cleaning (9pm, plan ahead)
      if (details?.includes('peak enforcement window')) {
        title = '⚠️ Still in Peak Enforcement Window';
        body = `${address}\n${details}`;
        channelId = 'parking-alerts'; // High priority
      } else if (details?.includes('MOVE YOUR CAR NOW')) {
        title = '🧹 Street Cleaning Today — Move Now!';
        body = `${address}\n${details || 'Street cleaning starts at 9am. Move your car NOW — $60 ticket.'}`;
        channelId = 'parking-alerts'; // Higher priority for urgent morning alert
      } else {
        title = '🧹 Street Cleaning Tomorrow';
        body = `${address}\n${details || 'Move your car tonight to avoid a $60 ticket.'}`;
      }
      break;

    case 'winter_ban':
      hoursBefore = 0; // Time is pre-computed (9pm)
      notificationId = `${NOTIFICATION_PREFIX.WINTER_BAN}${Date.now()}`;
      channelId = 'parking-alerts';
      title = '❄️ Winter Parking Ban Tonight';
      body = `${address}\n${details || 'Winter overnight parking ban 3am–7am. Move before 3am or risk towing ($150+).'}`;
      break;

    case 'snow_ban':
      // Snow ban is weather-dependent, immediate notification
      notificationId = `${NOTIFICATION_PREFIX.SNOW_BAN}${Date.now()}`;
      channelId = 'parking-alerts';
      title = '🌨️ Snow Ban Alert!';
      body = `${address}\n${details || 'Snow ban may be active. Check conditions and move if needed.'}`;
      hoursBefore = 0;
      break;

    case 'permit_zone':
      hoursBefore = 0; // Time is pre-computed (7am)
      notificationId = `${NOTIFICATION_PREFIX.PERMIT_ZONE}${Date.now()}`;
      channelId = 'reminders';
      title = '🅿️ Permit Zone — Move by 8am';
      body = `${address}\n${details || 'Enforcement starts at 8am — move your car or risk a $60 ticket.'}`;
      break;

    default:
      return null;
  }

  // Calculate notification time
  const notificationTime = new Date(restrictionStartTime.getTime() - hoursBefore * 60 * 60 * 1000);

  // Don't schedule if the notification time is in the past
  if (notificationTime.getTime() <= Date.now()) {
    log.debug(`Skipping ${type} notification - time already passed`);
    return null;
  }

  // Create the trigger
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: notificationTime.getTime(),
  };

  // Schedule the notification
  await notifee.createTriggerNotification(
    {
      id: notificationId,
      title,
      body,
      data: {
        type: `${type}_reminder`,
        lat: latitude?.toString() || '',
        lng: longitude?.toString() || '',
      },
      android: {
        channelId,
        importance: channelId === 'parking-alerts' ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
        pressAction: { id: 'default' },
        smallIcon: 'ic_notification',
      },
      ios: {
        sound: channelId === 'parking-alerts' ? 'default' : undefined,
      },
    },
    trigger
  );

  log.debug(`Scheduled ${type} notification for ${notificationTime.toISOString()}`);

  return {
    id: notificationId,
    type,
    scheduledFor: notificationTime.toISOString(),
    address,
  };
}
```

**Interfaces** (Lines 45-66)
```typescript
export interface ReminderPreferences {
  streetCleaningHoursBefore: number;
  winterBanHoursBefore: number;
  permitZoneHoursBefore: number;
  enabled: boolean;
}

export interface ParkingRestriction {
  type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone';
  restrictionStartTime: Date;
  address: string;
  details?: string;
  latitude?: number;
  longitude?: number;
}

export interface ScheduledNotification {
  id: string;
  type: string;
  scheduledFor: string; // ISO string
  address: string;
}
```

---

## File 6: check-parking-location-enhanced.ts - API Endpoint

**Path**: `/home/randy-vollrath/ticketless-chicago/pages/api/check-parking-location-enhanced.ts`

**Lines**: 1-92

**Full Endpoint** (Lines 15-92)
```typescript
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  try {
    // Run all checks in parallel for performance
    const [streetCleaningMatch, winterOvernightBanStatus, twoInchSnowBanStatus, address] = await Promise.all([
      matchStreetCleaningSchedule(latitude, longitude),
      checkWinterOvernightBan(latitude, longitude),
      checkLocationTwoInchSnowBan(latitude, longitude),
      getFormattedAddress(latitude, longitude),
    ]);

    // Format restrictions
    const restrictions: FormattedRestriction[] = [];

    const streetCleaningRestriction = formatStreetCleaningRestriction(streetCleaningMatch);
    if (streetCleaningRestriction) {
      restrictions.push(streetCleaningRestriction);
    }

    const winterOvernightRestriction = formatWinterOvernightBanRestriction(winterOvernightBanStatus);
    if (winterOvernightRestriction) {
      restrictions.push(winterOvernightRestriction);
    }

    const twoInchSnowRestriction = formatTwoInchSnowBanRestriction(twoInchSnowBanStatus);
    if (twoInchSnowRestriction) {
      restrictions.push(twoInchSnowRestriction);
    }

    // Note: Permit zones not fully implemented yet (no geometry data)
    // Would be added here when available

    // Combine all restrictions
    const combined = formatCombinedRestrictions(restrictions);

    // Build response
    return res.status(200).json({
      success: true,
      location: {
        latitude,
        longitude,
        address: address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      },
      restrictions: {
        found: restrictions.length > 0,
        count: restrictions.length,
        highest_severity: combined.highestSeverity,
        summary: {
          title: combined.combinedTitle,
          message: combined.combinedMessage,
        },
        details: restrictions,
      },
      raw_data: {
        street_cleaning: streetCleaningMatch,
        winter_overnight_ban: winterOvernightBanStatus,
        two_inch_snow_ban: twoInchSnowBanStatus,
      },
    });
  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
```


# Ticketless Chicago Mobile App

Auto-detect when you park and get instant alerts about parking restrictions (street cleaning, snow routes, permit zones).

## Features

✅ **Bluetooth Car Detection** - Automatically detects when you disconnect from your car's Bluetooth
✅ **GPS Location Tracking** - Gets your exact parking location
✅ **Real-time Parking Rules** - Checks street cleaning, snow routes, and permit zones
✅ **Push Notifications** - Instant alerts when you park in a restricted area
✅ **Background Monitoring** - Works even when the app is closed

## How It Works

1. **Pair Your Car** - Connect your phone to your car's Bluetooth once
2. **Enable Monitoring** - Turn on auto-detection in the app
3. **Park & Forget** - When you disconnect from your car, we automatically:
   - Get your GPS coordinates
   - Check parking restrictions at that location
   - Send you a notification if there are any issues

## Requirements

- React Native 0.82+
- Node.js 20+
- iOS 13+ or Android 8+
- Backend API running at `ticketless.fyi`

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Pods (iOS only)

```bash
cd ios
pod install
cd ..
```

### 3. Configure Backend URL

The app is pre-configured to use `https://ticketless.fyi/api/check-parking-location`

If you need to change it, edit `src/services/LocationService.ts`:

```typescript
const response = await fetch('YOUR_API_URL_HERE', {
  // ...
});
```

## Running the App

### iOS

```bash
npx react-native run-ios
```

Or open `ios/TicketlessChicagoMobile.xcworkspace` in Xcode and run.

### Android

```bash
npx react-native run-android
```

Make sure you have an Android emulator running or a physical device connected.

## Permissions

The app requests the following permissions:

### Android
- `ACCESS_FINE_LOCATION` - Get precise GPS coordinates
- `ACCESS_BACKGROUND_LOCATION` - Track location when app is closed
- `BLUETOOTH` / `BLUETOOTH_CONNECT` - Detect car Bluetooth connection
- `POST_NOTIFICATIONS` - Send parking alerts

### iOS
- Location When In Use
- Location Always (background)
- Bluetooth

All permissions are requested with clear explanations of why they're needed.

## Backend API Requirements

The mobile app expects a `/api/check-parking-location` endpoint that:

**Request:**
```json
POST /api/check-parking-location
{
  "latitude": 41.8781,
  "longitude": -87.6298
}
```

**Response:**
```json
{
  "success": true,
  "rules": [
    {
      "type": "street_cleaning",
      "message": "You parked on Michigan Ave which has street cleaning Mon 9am-12pm",
      "restriction": "Mon 9am-12pm",
      "address": "Michigan Ave"
    }
  ],
  "address": "100 N Michigan Ave, Chicago, IL",
  "coordinates": {
    "latitude": 41.8781,
    "longitude": -87.6298
  }
}
```

The backend implementation is included at `/pages/api/check-parking-location.ts`

## Project Structure

```
TicketlessChicagoMobile/
├── src/
│   ├── services/
│   │   ├── LocationService.ts      # GPS & parking rule checking
│   │   └── BluetoothService.ts     # Bluetooth car detection
│   └── screens/
│       └── SettingsScreen.tsx      # Bluetooth pairing UI
├── App.tsx                          # Main app component
├── android/                         # Android native code
├── ios/                            # iOS native code
└── package.json
```

## Key Components

### LocationService
- Manages GPS permissions and tracking
- Checks parking rules via API
- Sends push notifications
- Saves parking history

### BluetoothService
- Scans for Bluetooth devices
- Monitors car connection status
- Detects disconnect events
- Saves paired car info

### Main App
- Toggle monitoring on/off
- Display last parking check
- Show parking rule violations
- Manual location check button

## Testing

### Test Without Car Bluetooth

Use the "🔍 Check Current Location" button to test the parking check without needing to disconnect from your car.

### Test Backend API

```bash
curl -X POST https://ticketless.fyi/api/check-parking-location \
  -H "Content-Type: application/json" \
  -d '{"latitude": 41.8781, "longitude": -87.6298}'
```

## Troubleshooting

### Location not working
- Check that location permissions are granted in Settings
- Make sure "Always Allow" is enabled for background tracking
- On Android, ensure "Precise Location" is enabled

### Bluetooth not detecting car
- Make sure your car's Bluetooth is on and visible
- Try pairing your phone with your car in phone Settings first
- Re-scan for devices in the app

### Notifications not appearing
- Grant notification permissions in Settings
- On iOS, enable "Critical Alerts" for emergency notifications
- Check Do Not Disturb settings

### App crashes on Android
- Make sure you're using Node 20+ (newer React Native requirement)
- Try `cd android && ./gradlew clean && cd ..`
- Rebuild: `npx react-native run-android`

## Database Functions Needed

Your Supabase database needs these RPC functions (create them in SQL):

```sql
-- Get street cleaning at location
CREATE OR REPLACE FUNCTION get_street_cleaning_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  street_name TEXT,
  schedule TEXT
) AS $$
  -- Your implementation here using ST_DWithin
$$ LANGUAGE plpgsql;

-- Get snow route at location
CREATE OR REPLACE FUNCTION get_snow_route_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  street_name TEXT
) AS $$
  -- Your implementation here
$$ LANGUAGE plpgsql;

-- Get permit zone at location
CREATE OR REPLACE FUNCTION get_permit_zone_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  zone_name TEXT,
  hours TEXT,
  street_name TEXT
) AS $$
  -- Your implementation here
$$ LANGUAGE plpgsql;
```

## Future Enhancements

- [ ] Add navigation to "Park Here Instead" locations
- [ ] Show parking restrictions on a map
- [ ] Historical parking log
- [ ] Share parking spot with friends
- [ ] Parking timer/reminders
- [ ] Integration with parking payment apps

## License

Private - Ticketless Chicago

## Support

For issues or questions, contact the Ticketless team.

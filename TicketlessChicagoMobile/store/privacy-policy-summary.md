# Privacy Policy Summary for App Store Submission

## Data Collection

### Location Data
- **What we collect**: GPS coordinates when you park (latitude/longitude)
- **Why**: To check parking restrictions at your location
- **Retention**: Stored locally on device; only sent to server when checking rules
- **Third-party sharing**: Never shared or sold

### Device Information
- **What we collect**: Device type, OS version, app version
- **Why**: For crash reporting and app improvement
- **Third-party sharing**: Anonymous crash reports via Firebase Crashlytics

### Account Information
- **What we collect**: Email address
- **Why**: Account creation and notifications
- **Third-party sharing**: Stored in Supabase (database provider)

### Push Notification Tokens
- **What we collect**: Firebase Cloud Messaging token
- **Why**: To send parking alerts
- **Third-party sharing**: Sent to Firebase for notification delivery

## Data NOT Collected
- Contacts
- Photos
- Browsing history
- Financial information (payments handled by Stripe)
- Advertising identifiers

## User Rights
- Export your data
- Delete your account and all data
- Opt-out of notifications

## Apple App Privacy Labels

### Data Used to Track You
- None

### Data Linked to You
- Contact Info (email)
- Location (precise location when checking parking)
- Identifiers (user ID)

### Data Not Linked to You
- Crash Data
- Diagnostics

## Google Play Data Safety

### Data Shared
- None sold to third parties

### Data Collected
- Location (approximate and precise)
- Personal info (email address)
- App activity (app interactions)
- Device info (device/OS info)

### Security Practices
- Data encrypted in transit (HTTPS)
- Data can be deleted (via account deletion)

## Required Disclosures

### iOS Info.plist Usage Descriptions
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Ticketless needs your location to check parking restrictions at your current location.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Ticketless needs background location access to automatically check parking when you leave your car.</string>

<key>NSBluetoothPeripheralUsageDescription</key>
<string>Ticketless uses Bluetooth to detect when you disconnect from your car.</string>

<key>NSBluetoothAlwaysUsageDescription</key>
<string>Ticketless uses Bluetooth to detect when you disconnect from your car.</string>

<key>NSFaceIDUsageDescription</key>
<string>Ticketless uses Face ID to quickly and securely sign you in.</string>
```

### Android Permissions Rationale
- `ACCESS_FINE_LOCATION`: Get precise parking location
- `ACCESS_BACKGROUND_LOCATION`: Check parking when app is closed
- `BLUETOOTH_CONNECT/SCAN`: Detect car connection/disconnection
- `POST_NOTIFICATIONS`: Send parking alerts
- `USE_BIOMETRIC`: Secure sign-in with fingerprint

# Ticketless Chicago Mobile App - Complete Setup Guide

## 🚀 Quick Start (For Complete Beginners)

This guide assumes you've NEVER built a mobile app before. We'll go step-by-step.

---

## Prerequisites

### 1. Install Node.js 20+

**Check if you have Node:**
```bash
node --version
```

If it says "node: command not found" or shows a version less than 20, install Node:

**Mac:**
```bash
# Install Homebrew first if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install Node
brew install node@20
```

**Linux:**
```bash
# Use nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

---

## Part 1: Backend Setup (5 minutes)

### Step 1: Run the SQL Migration

1. Go to your Supabase dashboard: https://supabase.com
2. Click on your project
3. Go to "SQL Editor" in the left sidebar
4. Click "New Query"
5. Copy the contents of `/database/create-mobile-api-functions.sql`
6. Paste it into the SQL editor
7. Click "Run" (or press Cmd+Enter / Ctrl+Enter)

✅ You should see: "Success. No rows returned"

### Step 2: Test the API Endpoint

```bash
# From your ticketless-chicago directory (NOT the mobile app folder)
cd /home/randy-vollrath/ticketless-chicago

# Start your Next.js server
npm run dev
```

Open a new terminal and test:

```bash
curl -X POST http://localhost:3000/api/check-parking-location \
  -H "Content-Type: application/json" \
  -d '{"latitude": 41.8781, "longitude": -87.6298}'
```

✅ You should see JSON response with parking rules

---

## Part 2: Mobile App Setup

### For iOS Development (Mac Only)

#### Step 1: Install Xcode

1. Open App Store on your Mac
2. Search for "Xcode"
3. Click "Get" / "Install" (it's ~15GB, will take 30-60 minutes)
4. After installing, open Xcode once to accept license

#### Step 2: Install CocoaPods

```bash
sudo gem install cocoapods
```

#### Step 3: Install iOS Dependencies

```bash
cd /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile
cd ios
pod install
cd ..
```

✅ You should see: "Pod installation complete!"

### For Android Development (Mac/Linux/Windows)

#### Step 1: Install Android Studio

1. Download from: https://developer.android.com/studio
2. Open the installer and follow prompts
3. When asked, install:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device

#### Step 2: Configure Environment Variables

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

Then reload:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

#### Step 3: Create an Android Virtual Device (Emulator)

1. Open Android Studio
2. Click "More Actions" → "Virtual Device Manager"
3. Click "Create Device"
4. Select "Pixel 5" or any phone
5. Click "Next"
6. Select "Tiramisu" (API 33) - click download if needed
7. Click "Next" then "Finish"

---

## Part 3: Running the App

### Terminal Window 1: Start Metro Bundler

```bash
cd /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile
npm start
```

Keep this running. You should see:
```
Welcome to Metro!
  Fast - Scalable - Integrated
```

### Terminal Window 2: Run the App

**For iOS:**
```bash
cd /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile
npx react-native run-ios
```

This will:
1. Open the iOS Simulator automatically
2. Build the app (takes 2-5 minutes first time)
3. Install and launch the app

**For Android:**
1. First, start your emulator in Android Studio (click the ▶️ play button next to your device)
2. Wait for it to fully boot (shows home screen)
3. Then run:

```bash
cd /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile
npx react-native run-android
```

✅ The app should launch on your emulator/simulator!

---

## Part 4: Testing the App

### Test 1: Check Current Location (No Car Needed)

1. In the app, tap "🔍 Check Current Location"
2. Grant location permissions when prompted
3. Wait a few seconds
4. You should see:
   - Either parking restrictions found
   - Or "No restrictions found"

If you get an error:
- Make sure your Next.js server is running (Part 1, Step 2)
- Check the Metro bundler terminal for error messages

### Test 2: Pair a Fake Bluetooth Device (Simulator Testing)

**Note:** Bluetooth doesn't work well in simulators. To test:

Option A: Use a real device (see Part 5)
Option B: For now, skip Bluetooth testing

---

## Part 5: Running on a Real Device

### iOS (Real iPhone)

#### Step 1: Connect Your iPhone

1. Plug iPhone into your Mac with USB cable
2. Unlock your iPhone
3. Tap "Trust This Computer" if prompted

#### Step 2: Configure Signing

1. Open Xcode
2. File → Open → Navigate to:
   ```
   /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile.xcworkspace
   ```
3. Click on "TicketlessChicagoMobile" in left sidebar (blue icon)
4. Under "Signing & Capabilities":
   - Check "Automatically manage signing"
   - Select your Apple ID team
   - Change "Bundle Identifier" to something unique:
     `com.yourname.ticketlesschicago`

#### Step 3: Run on Device

```bash
npx react-native run-ios --device="Your iPhone Name"
```

Or in Xcode: Select your device from the dropdown and click ▶️

### Android (Real Phone)

#### Step 1: Enable Developer Mode

On your Android phone:
1. Settings → About Phone
2. Tap "Build Number" 7 times
3. Go back to Settings → Developer Options
4. Enable "USB Debugging"

#### Step 2: Connect and Run

1. Plug phone into computer with USB
2. Tap "Allow USB Debugging" on phone
3. Run:
```bash
npx react-native run-android
```

---

## Part 6: Testing Bluetooth Car Detection

### Step 1: Pair Your Car

1. Start your car (or turn on ignition)
2. On your phone, go to Settings → Bluetooth
3. Connect to your car's Bluetooth
4. Go back to the Ticketless app
5. Tap "Pair Your Car"
6. Tap "🔍 Scan for Devices"
7. Select your car from the list

### Step 2: Enable Monitoring

1. Toggle "Auto-Detection" to ON
2. Grant all permissions (Location Always, Bluetooth, Notifications)

### Step 3: Test the System

1. Start driving
2. Park somewhere (preferably on a street with street cleaning)
3. Turn off your car (this disconnects Bluetooth)
4. Within 10 seconds, you should get a notification about parking restrictions

---

## Troubleshooting

### "Command not found" Errors

**Metro bundler won't start:**
```bash
# Clear cache and restart
cd /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile
rm -rf node_modules
npm install
npm start -- --reset-cache
```

**iOS won't build:**
```bash
cd ios
pod deintegrate
pod install
cd ..
npx react-native run-ios
```

**Android won't build:**
```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### App Crashes Immediately

Check the Metro bundler terminal for error messages:
- Red text = error
- Yellow text = warning (usually okay)

Common fixes:
```bash
# Kill all Metro processes
killall -9 node

# Clear watchman
watchman watch-del-all

# Clear all caches
rm -rf $TMPDIR/react-*
rm -rf $TMPDIR/metro-*

# Restart
npm start -- --reset-cache
```

### Permissions Not Working

**iOS:**
- After running app, go to iPhone Settings → Privacy & Security → Location Services → Ticketless Chicago
- Select "Always" (not "While Using")
- Enable "Precise Location"

**Android:**
- Settings → Apps → Ticketless Chicago → Permissions
- Location: "Allow all the time"
- Nearby devices: "Allow"
- Notifications: "Allow"

### API Not Connecting

1. Check your computer's IP address:
   ```bash
   ipconfig getifaddr en0  # Mac
   # or
   hostname -I  # Linux
   ```

2. Update the API URL in `/src/config/env.ts`:
   ```typescript
   export const API_URL = __DEV__
     ? 'http://YOUR_IP_ADDRESS:3000'  // Use your actual IP
     : 'https://ticketless.fyi';
   ```

3. Rebuild the app

### Bluetooth Not Detecting Car Disconnect

- Make sure you're testing on a REAL device (not simulator)
- Check that Bluetooth permissions are granted
- Your car's Bluetooth must be CONNECTED before you turn off the car
- Some cars take 30-60 seconds to fully disconnect

---

## Development Workflow

### Making Code Changes

1. Edit files in VS Code or your editor
2. Save the file
3. In the Metro bundler terminal, press `r` to reload
   - Or shake your device and tap "Reload"
   - Or press Cmd+R (iOS) / Double-tap R (Android)

### Viewing Logs

**iOS:**
```bash
npx react-native log-ios
```

**Android:**
```bash
npx react-native log-android
```

### Debugging

1. Shake device or press Cmd+D (iOS) / Cmd+M (Android)
2. Select "Debug"
3. Open Chrome and go to: `chrome://inspect`
4. Click "inspect" under your app
5. Use Chrome DevTools Console

---

## Next Steps

### 1. Test with Real Data

Drive around Chicago and test:
- Streets with street cleaning
- Snow routes (if winter)
- Permit zones

### 2. Improve the UI

- Add loading spinners
- Better error messages
- Add a map view

### 3. Deploy Backend to Production

Your API needs to be accessible from phones:
```bash
# Deploy to Vercel
vercel --prod
```

Then update `/src/config/env.ts` with your production URL.

### 4. Submit to App Stores

**iOS:** You need an Apple Developer account ($99/year)
**Android:** Google Play Store account ($25 one-time)

---

## File Structure Reference

```
TicketlessChicagoMobile/
├── src/
│   ├── services/
│   │   ├── LocationService.ts      # GPS + API calls
│   │   └── BluetoothService.ts     # Bluetooth detection
│   ├── screens/
│   │   └── SettingsScreen.tsx      # Car pairing UI
│   └── config/
│       └── env.ts                  # API URLs
├── android/                         # Android native code
├── ios/                            # iOS native code
├── App.tsx                         # Main app component
├── index.js                        # Entry point
└── package.json                    # Dependencies

Backend:
└── pages/api/
    └── check-parking-location.ts   # API endpoint
```

---

## Getting Help

**Error in Metro bundler?**
- Read the red text carefully
- Google the error message
- Check React Native docs: https://reactnative.dev

**Permissions issues?**
- Check device Settings
- Look for permission popups you might have dismissed

**Bluetooth not working?**
- MUST test on real device
- Car must be fully connected before testing

**API not responding?**
- Check backend is running: `curl http://localhost:3000/api/check-parking-location`
- Check phone can reach your computer (same WiFi network)

---

## Summary

✅ Database functions created
✅ Backend API endpoint working
✅ Mobile app fully built
✅ Navigation between screens
✅ Bluetooth car detection
✅ GPS location tracking
✅ Push notifications
✅ Error handling with retries

**You're ready to test!** 🎉

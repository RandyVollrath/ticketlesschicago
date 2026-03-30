# Android Bluetooth Detection — Critical Rules

> Extracted from CLAUDE.md. These are hard-won lessons about Android parking detection via Bluetooth Classic (ACL events). Follow these rules whenever touching BT code.

Android parking detection depends on Bluetooth Classic (ACL events). The system has multiple layers and race conditions that can silently break it. Follow these rules whenever touching BT code:

## Architecture (3 layers)
1. **Native foreground service** (`BluetoothMonitorService.kt`): Registers a `BroadcastReceiver` for `ACTION_ACL_CONNECTED/DISCONNECTED`. Survives app backgrounding. Writes `is_connected` to SharedPreferences. Notifies JS via `eventListener` callback or stores as pending event.
2. **Native module bridge** (`BluetoothMonitorModule.kt`): Bridges service → JS. Sets `eventListener` on the service, emits `BtMonitorCarConnected/BtMonitorCarDisconnected` events to JS via `NativeEventEmitter`.
3. **JS-side BluetoothService** (`BluetoothService.ts`): Maintains `connectedDeviceId` + `savedDeviceId` in-memory. `isConnectedToCar()` compares these. UI components subscribe via `addConnectionListener()`.

## Race Conditions to Guard Against
1. **`savedDeviceId` not loaded when `setCarConnected(true)` fires.**
   `savedDeviceId` comes from AsyncStorage (async). If a native event fires before it's loaded, `setCarConnected()` can't match IDs. Fix: `setCarConnected()` uses `'__native_connected__'` placeholder and kicks off async load. `isConnectedToCar()` accepts the placeholder. `ensureSavedDeviceLoaded()` retroactively fixes it.

2. **`checkInitialConnectionState()` profile proxy callback timing.**
   `getProfileProxy()` in the native service is async (100-2000ms). The callback updates SharedPreferences and notifies the listener, but JS event listeners may not be subscribed yet. Fix: JS does immediate check + delayed re-checks at 2s and 5s.

3. **JS `NativeEventEmitter` not subscribed when native emits.**
   `startMonitoring()` starts the service and resolves the promise BEFORE JS subscribes to events. The initial connect event from `checkInitialConnectionState()` can be lost. Fix: rely on SharedPreferences fallback checks, not just events.

4. **Stale `is_connected=true` in SharedPreferences after app restart (away from car).**
   SharedPreferences persists across app restarts/installs. If the last session ended while connected to the car, `is_connected=true` stays forever. On next startup the app reads it and shows "Driving" even though the car BT is off. The profile proxy check finds 0 devices but that alone doesn't fix anything — you MUST explicitly call `handleDisconnect()` when all profiles report 0 devices. Fix: `checkInitialConnectionState()` uses `AtomicInteger` to track completed profile callbacks. When all complete and none found the target, it calls `handleDisconnect()` to clear the stale state. JS delayed re-checks (2s/5s) must also correct connected→disconnected, not just disconnected→connected.

## Android Foreground Service Rules (CRITICAL)
The `BluetoothMonitorService` is a foreground service. Android has strict rules about these that cause **instant app crashes** if violated:

1. **NEVER call `startForeground()` in a STOP code path.** If the service calls `startForeground()` and then immediately `stopSelf()`, and another `startForegroundService()` START intent is queued, the STOP tears down the service before the START can fulfill its `startForeground()` contract → `ForegroundServiceDidNotStartInTimeException` → app crash → service dead forever until next app restart.
2. **Use `stopService()` to stop the service, NOT `startService(ACTION_STOP)`.** Sending STOP via `startService` creates the same race: the service receives STOP, dies, but a pending START from `startForegroundService` has no service to attach to.
3. **STOP must exit early in `onStartCommand`** — before the `startForeground()` call. Only START/null actions call `startForeground()`.
4. **If the foreground service crashes, it stays dead.** Android does NOT auto-restart it (despite `START_STICKY`) after a `ForegroundServiceDidNotStartInTimeException`. The BT monitoring is silently gone until the user force-closes and reopens the app.

## Rules for Any BT Code Change
1. **Always call `ensureSavedDeviceLoaded()` before any code that calls `setCarConnected()`.**
2. **Never remove the delayed re-check timers** (2s + 5s) in `startForegroundMonitoring` and `restartBluetoothMonitoring`. They catch async profile proxy results.
3. **`saveCarDevice()` must eagerly set `savedDeviceId`** — don't rely on a separate async load.
4. **`isConnectedToCar()` must accept the `'__native_connected__'` placeholder** as "connected" — this is the defense against the race window.
5. **HomeScreen uses 3 fallback checks** (JS state → OS query → native SharedPrefs). Never reduce to fewer.
6. **The 10-second debounce in disconnect handler** filters transient BT glitches. Don't remove it.
7. **After any BT change, test on a real Android device** with: pair car → kill app → reopen → verify "Connected to [car]" shows within 5 seconds.
8. **`checkInitialConnectionState()` must handle BOTH outcomes** — device found (handleConnect) AND device not found after all profiles checked (handleDisconnect). SharedPreferences persists across restarts, so "not found" is NOT the same as "no action needed."
9. **JS delayed re-checks must be bidirectional.** They must correct state in BOTH directions: disconnected→connected AND connected→disconnected. A one-directional check leaves stale "Driving" state uncorrectable.

## Testing Bluetooth Detection
After any change to BT-related code, verify these scenarios on a physical Android device:
- [ ] Select car in Settings → HomeScreen shows "Connected to [car]" within 5s (if car BT is on)
- [ ] Car BT disconnects → after 10s debounce, parking check triggers
- [ ] Car BT reconnects → departure tracking starts
- [ ] Kill app while connected → reopen → still shows "Connected to [car]"
- [ ] App in background → car disconnects → parking notification fires
- [ ] Kill app while connected → walk away from car → reopen → should show "Waiting for..." (NOT "Driving") within 5s

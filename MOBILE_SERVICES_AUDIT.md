# Mobile App Services Audit — Bug Report

**Date**: 2026-03-23
**Scope**: Core mobile services (AuthService, ApiClient, ParkingHistoryService, BackgroundTaskService)
**Focus**: Crashes, data loss, auth failures, race conditions

---

## CRITICAL BUGS (Production Impact)

### 1. **Race Condition in ApiClient 401 Token Refresh** — Data Loss Risk
**Severity**: CRITICAL
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/ApiClient.ts`
**Lines**: 262-278

**Bug**:
The 401 token refresh retry logic has a race condition when multiple API requests fail with 401 simultaneously. If two requests both receive 401 at the same time:
1. Request A calls `AuthService.handleAuthError()` → triggers token refresh
2. Request B also calls `AuthService.handleAuthError()` → triggers SECOND token refresh (concurrent)
3. Both refresh calls race — one may invalidate the other's session

The `refreshSession()` call in Supabase is NOT idempotent — calling it twice concurrently can invalidate the first refresh token before it's used, causing both to fail and forcing the user to re-login even though their session was still valid.

**Evidence**:
```typescript
// Line 262-271 (ApiClient.ts)
if (response.status === 401 && requireAuth && attempt === 0) {
  log.debug('Received 401, attempting token refresh');
  const refreshed = await AuthService.handleAuthError();  // NO LOCK/GUARD
  if (refreshed) {
    const newToken = AuthService.getToken();
    if (newToken) {
      requestHeaders.Authorization = `Bearer ${newToken}`;
      continue;
    }
  }
}
```

AuthService has NO guard against concurrent `refreshToken()` calls:
```typescript
// Line 395-414 (AuthService.ts)
async refreshToken(): Promise<boolean> {
  try {
    const { data, error } = await this.supabase.auth.refreshSession();  // NOT PROTECTED
    // ...
  }
}
```

**Impact**:
- User forcibly logged out despite valid session
- In-flight API requests fail
- User loses unsaved work (parking check, camera alert settings, etc.)
- Affects users with poor network (high API failure rate → multiple retries hitting 401)

**Fix**:
Add a refresh-in-flight guard to AuthService:
```typescript
private refreshInFlight: Promise<boolean> | null = null;

async refreshToken(): Promise<boolean> {
  // If refresh already in flight, wait for it instead of starting a new one
  if (this.refreshInFlight) {
    return this.refreshInFlight;
  }

  this.refreshInFlight = (async () => {
    try {
      const { data, error } = await this.supabase.auth.refreshSession();
      if (error) {
        log.error('Token refresh failed', error);
        return false;
      }
      if (data.session) {
        this.updateAuthState(data.session);
        log.info('Token refreshed successfully');
        return true;
      }
      return false;
    } catch (error) {
      log.error('Token refresh error', error);
      return false;
    } finally {
      this.refreshInFlight = null;
    }
  })();

  return this.refreshInFlight;
}
```

---

### 2. **ParkingHistoryService Read-Modify-Write Race Condition** — Data Loss
**Severity**: CRITICAL
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HistoryScreen.tsx`
**Lines**: 290-333, 344-354, 356-374

**Bug**:
Every method in ParkingHistoryService uses an unprotected read-modify-write pattern:
1. `await AsyncStorage.getItem(HISTORY_KEY)` — read
2. Parse JSON, modify array
3. `await AsyncStorage.setItem(HISTORY_KEY, ...)` — write

If two operations run concurrently (e.g. auto parking detection + manual "Check My Parking" button tap), the later write can OVERWRITE the earlier write, losing data.

**Evidence**:
```typescript
// addToHistory() — Lines 290-333
async addToHistory(...): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);  // READ
    const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];

    const newItem = { /* ... */ };
    const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));  // WRITE
    // ^^^ If another addToHistory() runs between READ and WRITE, one entry is lost
  } catch (error) { /* ... */ }
}

// deleteItem() — Lines 344-354
async deleteItem(id: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);  // READ
    const history = stored ? JSON.parse(stored) : [];
    const updated = history.filter(item => item.id !== id);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));  // WRITE
    // ^^^ Same race — if addToHistory() runs between READ and WRITE, new item is deleted
  } catch (error) { /* ... */ }
}

// updateItem() — Lines 356-374 (same pattern)
```

**Impact**:
- Lost parking history entries (evidence for ticket contests)
- Lost departure confirmations (user drives away but departure never recorded)
- More likely when:
  - User taps "Check My Parking" while auto-detect is running
  - Rapid BT connect/disconnect cycles (car audio system flakiness)
  - iOS recovery events firing while user manually checks parking

**Frequency**:
LOW under normal use, but GUARANTEED to happen under specific scenarios:
- iOS `checkForMissedParking()` recovery running in parallel with new parking detection
- Manual button tap racing with auto-detect
- Server merge (`getHistory(forceServerRefresh=true)`) racing with `addToHistory()`

**Fix**:
Use a mutex/lock pattern:
```typescript
let historyWriteLock: Promise<void> = Promise.resolve();

async addToHistory(...): Promise<void> {
  // Chain all writes — only one can execute at a time
  historyWriteLock = historyWriteLock.then(async () => {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history = stored ? JSON.parse(stored) : [];
      const newItem = { /* ... */ };
      const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');
    } catch (error) {
      log.error('Error adding to parking history', error);
    }
  });
  await historyWriteLock;
}

// Apply same pattern to deleteItem, updateItem, clearHistory
```

---

### 3. **ApiClient 401 Retry Doesn't Consume Retry Budget** — Infinite Loop Risk
**Severity**: HIGH
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/ApiClient.ts`
**Lines**: 262-278

**Bug**:
The 401 token refresh path uses `continue` to retry WITHOUT incrementing the attempt counter. If the token refresh succeeds but the server keeps returning 401 (e.g. token is valid but user lacks permissions), the loop retries FOREVER (until the 15s timeout per request × 3 retries = 45s total, but then the OUTER loop restarts).

**Evidence**:
```typescript
// Line 222: for (let attempt = 0; attempt <= retries; attempt++) {
for (let attempt = 0; attempt <= retries; attempt++) {
  try {
    // ... fetch request ...

    // Line 262-271
    if (response.status === 401 && requireAuth && attempt === 0) {
      log.debug('Received 401, attempting token refresh');
      const refreshed = await AuthService.handleAuthError();
      if (refreshed) {
        const newToken = AuthService.getToken();
        if (newToken) {
          requestHeaders.Authorization = `Bearer ${newToken}`;
          continue;  // ← Jumps back to `for` loop WITHOUT incrementing `attempt`
        }
      }
      return { success: false, error };  // ← Only reached if refresh failed
    }
```

The `continue` jumps back to `for (let attempt = 0; attempt <= retries; attempt++)` but because `attempt` is incremented BY THE FOR LOOP, not manually, the retry is FREE — it doesn't count against the retry budget.

**But the real issue**: The condition `attempt === 0` means token refresh ONLY happens on the first attempt. So this is actually NOT an infinite loop — it's a ONE-TIME free retry. However, this creates a subtle bug: if the server returns 401 on attempt 1 or 2 (not attempt 0), the token is NOT refreshed and the request immediately fails.

**Impact**:
- API requests fail unnecessarily when token expires mid-retry
- User sees "Session Expired" even though refresh would succeed
- Affects long-running operations (file uploads, slow endpoints)

**Fix**:
Allow token refresh on ANY attempt, not just `attempt === 0`, and mark it as used:
```typescript
let tokenRefreshUsed = false;

for (let attempt = 0; attempt <= retries; attempt++) {
  try {
    const response = await fetch(url, { /* ... */ });

    if (response.status === 401 && requireAuth && !tokenRefreshUsed) {
      log.debug('Received 401, attempting token refresh');
      tokenRefreshUsed = true;  // Only try once per request
      const refreshed = await AuthService.handleAuthError();
      if (refreshed) {
        const newToken = AuthService.getToken();
        if (newToken) {
          requestHeaders.Authorization = `Bearer ${newToken}`;
          // Don't increment attempt — give the refreshed token a fair try
          attempt--;
          continue;
        }
      }
      return { success: false, error };
    }
    // ... rest of error handling ...
  } catch (err) { /* ... */ }
}
```

---

## HIGH SEVERITY BUGS

### 4. **JSON.parse() Failures Crash ParkingHistoryService** — App Crash
**Severity**: HIGH
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HistoryScreen.tsx`
**Lines**: 263, 300, 347, 359, 380

**Bug**:
Every method that reads from AsyncStorage uses:
```typescript
const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
```

If `stored` is non-null but contains invalid JSON (corrupted AsyncStorage, incomplete write, manual tampering), `JSON.parse()` throws a synchronous exception that is NOT caught by the outer `try-catch` because the function is async and the parse happens inline.

Wait, that's incorrect — the `try-catch` DOES wrap the parse. But the issue is: if the parse fails, the ENTIRE method fails and returns early. The user can never clear the bad data because `clearHistory()` ALSO tries to parse it first (wait, no — `clearHistory()` doesn't read, it just removes).

Actually, re-checking the code:

```typescript
// getHistory() — Line 260-288
async getHistory(forceServerRefresh: boolean = false): Promise<ParkingHistoryItem[]> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);
    const local: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
    // ... rest of method ...
  } catch (error) {
    log.error('Error getting parking history', error);
    return [];  // ← Fails silently, returns empty array
  }
}
```

So the catch DOES handle it. But the problem is: **the corruption persists**. If `stored` is corrupt, every call to `getHistory()` returns `[]` but the corrupt data remains in AsyncStorage. The next `addToHistory()` call will TRY to parse the corrupt data again, fail, and return without adding the new item.

**Evidence**:
```typescript
// addToHistory() — Lines 296-333
async addToHistory(...): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);
    const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];  // ← Throws on corrupt data
    // ... rest never runs ...
  } catch (error) {
    log.error('Error adding to parking history', error);  // ← Logs but doesn't fix corruption
  }
}
```

**Impact**:
- User loses ALL parking history (can't view it, can't add new entries)
- Corruption persists until user manually clears app data or reinstalls
- No user-facing recovery path

**Likelihood**:
LOW but non-zero:
- AsyncStorage write interrupted by app crash or force-close
- iOS backing up partial data during mid-write
- Manual corruption (developer debugging)

**Fix**:
Reset to empty array on parse failure and clear the corrupt key:
```typescript
async getHistory(forceServerRefresh: boolean = false): Promise<ParkingHistoryItem[]> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);
    let local: ParkingHistoryItem[] = [];

    if (stored) {
      try {
        local = JSON.parse(stored);
      } catch (parseError) {
        log.error('Parking history corrupted, resetting to empty', parseError);
        await AsyncStorage.removeItem(HISTORY_KEY);  // Clear corrupt data
        local = [];
      }
    }

    // ... rest of method ...
  } catch (error) {
    log.error('Error getting parking history', error);
    return [];
  }
}

// Apply same try-catch wrapper to all JSON.parse() calls in other methods
```

---

### 5. **AuthService Listener Array Mutation During Iteration** — Stale State
**Severity**: MEDIUM-HIGH
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/AuthService.ts`
**Lines**: 117-128

**Bug**:
The `notifyListeners()` method iterates over `this.listeners` array directly:
```typescript
// Line 126-128
private notifyListeners(): void {
  this.listeners.forEach(listener => listener(this.authState));
}
```

If a listener callback calls `subscribe()` (adding a new listener) or the unsubscribe function (removing itself), the array is mutated DURING iteration. JavaScript `forEach` will continue iterating over the ORIGINAL array snapshot, but this creates undefined behavior:
- Removed listeners may still fire once
- Added listeners may fire immediately or be skipped

**Evidence**:
```typescript
// Line 116-124
subscribe(listener: (state: AuthState) => void): () => void {
  this.listeners.push(listener);  // ← Mutates array
  listener(this.authState);       // ← Immediately calls listener
  return () => {
    this.listeners = this.listeners.filter(l => l !== listener);  // ← Mutates array
  };
}
```

Scenario:
1. Component A subscribes → `listeners = [A]`
2. Auth state changes → `notifyListeners()` calls `A(authState)`
3. Listener A's callback calls the unsubscribe function → `listeners.filter()` runs → `listeners = []`
4. `forEach` continues but `listeners` is now empty — no issue YET
5. BUT: if listener A subscribes AGAIN in its callback → `listeners.push(A)` → `listeners = [A]`
6. `forEach` has already passed that index — A is NOT called this iteration

**Impact**:
- Components show stale auth state (user logged in but UI shows "Sign In")
- Rare but reproducible: happens when a component unmounts (unsubscribe) and remounts (subscribe) during the same auth state change
- Most likely during rapid sign-in/sign-out cycles

**Fix**:
Iterate over a shallow copy:
```typescript
private notifyListeners(): void {
  const snapshot = [...this.listeners];  // Shallow copy
  snapshot.forEach(listener => listener(this.authState));
}
```

---

## MEDIUM SEVERITY BUGS

### 6. **ApiClient Doesn't Distinguish Network Errors from Server Errors** — Misleading User Messages
**Severity**: MEDIUM
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/ApiClient.ts`
**Lines**: 59-67, 254-260

**Bug**:
The error categorization checks `error?.message?.includes('Network request failed')` to detect network errors, but **fetch() in React Native only throws this for DNS failures, not for HTTP errors**. A 500 server error is returned as `response.ok === false` but does NOT throw, so it's categorized as `SERVER_ERROR` (retryable) instead of checking if it's actually a network issue.

But wait, looking at the code more carefully:

```typescript
// Line 254-260
// Handle error response
const error = categorizeError(response.status);

// Extract error message from response if available
if (data && typeof data === 'object' && 'error' in data) {
  error.message = (data as any).error;
}
```

The `categorizeError(response.status)` call correctly categorizes by status code. The issue is elsewhere: the network check on lines 59-67 is correct for actual network failures (DNS, no internet).

Actually, re-reading more carefully: this is NOT a bug. The categorization is working as designed:
- Network failures (no internet) → `NETWORK_ERROR` (retryable)
- 5xx server errors → `SERVER_ERROR` (retryable)
- 401/403 → `AUTH_ERROR` (not retryable, but has special handling)

**Retraction**: NOT A BUG. The error categorization is correct.

---

### 7. **ParkingHistoryService.getMostRecent() Returns Wrong Item After Server Merge** — Departure Mismatch
**Severity**: MEDIUM
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HistoryScreen.tsx`
**Lines**: 260-288, 377-386

**Bug**:
`getMostRecent()` reads directly from AsyncStorage and returns `history[0]`. However, `getHistory(forceServerRefresh=true)` can MERGE server records and reorder the list. If a server record has a more recent timestamp than the local records, the "most recent" item changes.

But `getMostRecent()` does NOT call `getHistory()` — it reads AsyncStorage directly:
```typescript
// Line 377-386
async getMostRecent(): Promise<ParkingHistoryItem | null> {
  try {
    const stored = await AsyncStorage.getItem(HISTORY_KEY);
    const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
    return history.length > 0 ? history[0] : null;
  } catch (error) { /* ... */ }
}
```

Meanwhile, `getHistory()` can update AsyncStorage during a merge:
```typescript
// Line 276-278
if (merged.length > local.length) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  // ^^^ Updates AsyncStorage, but getMostRecent() may have already read before this write
}
```

**Scenario**:
1. Local history has parking at 1:00 PM
2. Server has parking at 1:30 PM (from another device)
3. Background sync calls `getHistory(forceServerRefresh=true)` → merges → writes `[1:30 PM, 1:00 PM]` to AsyncStorage
4. User drives away → departure tracking calls `getMostRecent()` → reads AsyncStorage → gets 1:30 PM item
5. But the departure was from the 1:00 PM parking → wrong item updated

**Impact**:
- Departure data attached to wrong parking record
- Ticket contest evidence shows user departed from a different location than where they actually parked
- Only affects users with multiple devices or who reinstalled and restored from server

**Likelihood**: LOW (requires multi-device use or recent server restore)

**Fix**:
`getMostRecent()` should call `getHistory()` to ensure it sees the merged list:
```typescript
async getMostRecent(): Promise<ParkingHistoryItem | null> {
  try {
    const history = await this.getHistory();  // Use merged list, not raw AsyncStorage
    return history.length > 0 ? history[0] : null;
  } catch (error) {
    log.error('Error getting most recent history item', error);
    return null;
  }
}
```

---

### 8. **AuthService.deleteAccount() Uses Raw fetch() Instead of ApiClient** — No Retry, No Network Error Handling
**Severity**: MEDIUM
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/AuthService.ts`
**Lines**: 356-389

**Bug**:
`deleteAccount()` uses raw `fetch()` instead of `ApiClient.authDelete()`. This means:
- No retry on network failure
- No timeout protection (hangs forever on slow network)
- No error categorization (user sees "Network error" for 500 server errors)
- No connectivity check (tries to fetch even when offline)

**Evidence**:
```typescript
// Line 364-388
try {
  const response = await fetch(
    `${Config.API_BASE_URL}/api/users?userId=${user.id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { success: false, error: body.error || `Server error (${response.status})` };
  }

  await this.signOut();
  log.info('Account deleted and signed out');
  return { success: true };
} catch (error: any) {
  log.error('Account deletion error', error);
  return { success: false, error: 'Network error. Please check your connection and try again.' };
}
```

**Impact**:
- User on flaky network can't delete account (request times out)
- User sees generic "Network error" instead of actionable message
- No retry means user must manually retry (poor UX)

**Fix**:
```typescript
async deleteAccount(): Promise<{ success: boolean; error?: string }> {
  const user = this.getUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await ApiClient.authDelete(`/api/users?userId=${user.id}`, {
      timeout: 30000,  // 30s for account deletion
      retries: 2,      // Retry twice on failure
      showErrorAlert: false,  // Handle errors manually
    });

    if (!response.success) {
      return {
        success: false,
        error: response.error?.message || 'Failed to delete account'
      };
    }

    await this.signOut();
    log.info('Account deleted and signed out');
    return { success: true };
  } catch (error: any) {
    log.error('Account deletion error', error);
    return { success: false, error: 'Network error. Please try again.' };
  }
}
```

---

## LOW SEVERITY / CODE QUALITY ISSUES

### 9. **AuthService Logs User Email in Debug Mode** — Potential PII Leak
**Severity**: LOW
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/AuthService.ts`
**Lines**: 107, 119

**Issue**:
```typescript
// Line 107
log.info(`Auth initialize: session=${!!session}, user=${session?.user?.email || 'none'}`);

// Line 119
log.debug(`subscribe: delivering current state (authenticated=${this.authState.isAuthenticated}, user=${this.authState.user?.email || 'none'}, listeners=${this.listeners.length})`);
```

Logs include user email addresses in plaintext. If crash logs or debug output is sent to analytics/error tracking (Sentry, Firebase Crashlytics), this is a GDPR/privacy violation.

**Impact**:
- Potential GDPR violation if logs are uploaded to third-party services
- User email exposed in device system logs (viewable via ADB on Android)

**Fix**:
Hash or redact email in logs:
```typescript
const emailHash = session?.user?.email
  ? session.user.email.slice(0, 3) + '***@' + session.user.email.split('@')[1]
  : 'none';
log.info(`Auth initialize: session=${!!session}, user=${emailHash}`);
```

Or remove email entirely:
```typescript
log.info(`Auth initialize: session=${!!session}, userId=${session?.user?.id || 'none'}`);
```

---

### 10. **No Memory Leak Protection for AuthService Listeners** — Unbounded Growth
**Severity**: LOW
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/AuthService.ts`
**Lines**: 49, 116-124

**Issue**:
There's no limit on the number of listeners. If a component subscribes but forgets to unsubscribe (common bug in React `useEffect` with missing cleanup), listeners accumulate forever.

**Evidence**:
```typescript
private listeners: ((state: AuthState) => void)[] = [];

subscribe(listener: (state: AuthState) => void): () => void {
  this.listeners.push(listener);  // No limit check
  // ...
}
```

**Impact**:
- Memory leak (listener array grows unbounded)
- Performance degradation (every auth state change iterates over all listeners, including duplicates)
- Only affects poorly written components, but hard to debug

**Fix**:
Add duplicate detection and warn on excessive listeners:
```typescript
subscribe(listener: (state: AuthState) => void): () => void {
  // Warn if listener is already subscribed (likely a bug)
  if (this.listeners.includes(listener)) {
    log.warn('Attempted to subscribe the same listener twice');
    return () => {};  // Return no-op unsubscribe
  }

  this.listeners.push(listener);

  // Warn if listener count is suspiciously high
  if (this.listeners.length > 50) {
    log.error(`AuthService has ${this.listeners.length} listeners — possible memory leak`);
  }

  listener(this.authState);
  return () => {
    this.listeners = this.listeners.filter(l => l !== listener);
  };
}
```

---

## SUMMARY

### Critical Bugs (Fix Immediately)
1. **ApiClient 401 token refresh race condition** → Prevents concurrent refresh, avoids session invalidation
2. **ParkingHistoryService read-modify-write races** → Use mutex to prevent lost parking records

### High Priority
3. **ApiClient 401 retry budget** → Allow token refresh on any attempt, not just first
4. **JSON.parse corruption recovery** → Reset to empty on parse failure
5. **AuthService listener mutation during iteration** → Iterate over snapshot

### Medium Priority
6. ~~ApiClient error categorization~~ (retracted — not a bug)
7. **ParkingHistoryService.getMostRecent() stale data** → Call `getHistory()` instead of reading AsyncStorage directly
8. **AuthService.deleteAccount() no retry/timeout** → Use ApiClient instead of raw fetch

### Low Priority / Code Quality
9. **User email in logs** → Redact or hash PII
10. **AuthService unbounded listeners** → Add duplicate detection and limit warnings

---

## TESTING CHECKLIST

After fixes, verify:
- [ ] Simultaneous API requests with expired token → only one refresh call, both requests succeed
- [ ] Rapid parking detections (manual + auto) → no lost history entries
- [ ] Force AsyncStorage corruption → app recovers, doesn't crash
- [ ] Component mount/unmount during auth state change → UI updates correctly
- [ ] Account deletion on flaky network → retries, doesn't hang
- [ ] 100+ auth state listener subscriptions → warning logged, no crash

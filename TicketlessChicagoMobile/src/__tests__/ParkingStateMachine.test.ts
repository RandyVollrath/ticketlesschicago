/**
 * ParkingStateMachine.test.ts
 *
 * Comprehensive unit tests for the ParkingDetectionStateMachine.
 * Tests all state transitions, debounce behavior, listener callbacks,
 * edge cases, and the critical invariants documented in CLAUDE.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ParkingDetectionStateMachine from '../services/ParkingDetectionStateMachine';

// The state machine is a singleton, so we need to reset it between tests.
// We access private members for testing.
const sm = ParkingDetectionStateMachine as any;

function resetStateMachine() {
  sm._state = 'INITIALIZING';
  sm._carName = null;
  sm._carAddress = null;
  sm._lastEventType = null;
  sm._lastEventTime = null;
  sm._stateListeners = [];
  sm._transitionCallbacks = new Map();
  sm._eventLog = [];
  sm._initialized = false;
  if (sm._debounceTimer) {
    clearTimeout(sm._debounceTimer);
    sm._debounceTimer = null;
  }
}

beforeEach(async () => {
  resetStateMachine();
  // Clear AsyncStorage so persisted state from previous tests doesn't leak
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('initialization', () => {
  it('should start in INITIALIZING state', () => {
    expect(ParkingDetectionStateMachine.state).toBe('INITIALIZING');
  });

  it('should initialize only once', async () => {
    await ParkingDetectionStateMachine.initialize('Test Car', '00:11:22:33:44:55');
    expect(sm._initialized).toBe(true);
    const prevState = ParkingDetectionStateMachine.state;
    await ParkingDetectionStateMachine.initialize('Other Car');
    // Should not re-initialize
    expect(ParkingDetectionStateMachine.state).toBe(prevState);
  });

  it('should set car name and address', async () => {
    await ParkingDetectionStateMachine.initialize('My Civic', 'AA:BB:CC');
    expect(ParkingDetectionStateMachine.carName).toBe('My Civic');
  });
});

// ---------------------------------------------------------------------------
// 2. BT Connected / Disconnected Transitions
// ---------------------------------------------------------------------------

describe('btConnected', () => {
  it('should transition from IDLE to DRIVING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(ParkingDetectionStateMachine.isConnectedToCar).toBe(true);
  });

  it('should transition from PARKED to DRIVING (departure)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKED';
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should cancel debounce when reconnecting during PARKING_PENDING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(sm._debounceTimer).toBeNull();
  });

  it('should be no-op when already DRIVING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should delegate to btInitConnected during INITIALIZING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'INITIALIZING';
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });
});

describe('btDisconnected', () => {
  it('should transition from DRIVING to PARKING_PENDING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');
    expect(ParkingDetectionStateMachine.isParkingPending).toBe(true);
  });

  it('should be no-op when not DRIVING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKED';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
  });

  it('should delegate to btInitDisconnected during INITIALIZING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'INITIALIZING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------
// 3. Debounce Timer
// ---------------------------------------------------------------------------

describe('debounce timer', () => {
  it('should transition to PARKED after 10 second debounce', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    // Advance 9 seconds — should still be pending
    jest.advanceTimersByTime(9000);
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    // Advance 1 more second — debounce expires
    jest.advanceTimersByTime(1000);
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
    expect(ParkingDetectionStateMachine.isParked).toBe(true);
  });

  it('should cancel debounce on btConnected (BT glitch filter)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    jest.advanceTimersByTime(5000); // Halfway through debounce
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');

    // Advance past the original debounce — should NOT transition
    jest.advanceTimersByTime(10000);
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });
});

// ---------------------------------------------------------------------------
// 4. Parking Confirmation
// ---------------------------------------------------------------------------

describe('parkingConfirmed', () => {
  it('should only work from PARKING_PENDING state', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.parkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE'); // No change

    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.parkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING'); // No change
  });
});

describe('manualParkingConfirmed', () => {
  it('should transition from IDLE to PARKED', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.manualParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
  });

  it('should be no-op when already PARKED', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKED';
    ParkingDetectionStateMachine.manualParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
  });

  it('should NOT transition from DRIVING (user is in car)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.manualParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should NOT transition from PARKING_PENDING (let debounce handle it)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKING_PENDING';
    ParkingDetectionStateMachine.manualParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');
  });
});

describe('iosNativeParkingConfirmed', () => {
  it('should NOT force DRIVING→PARKED (invalid per VALID_TRANSITIONS — must go through PARKING_PENDING)', async () => {
    // Note: VALID_TRANSITIONS for DRIVING only allows [PARKING_PENDING, IDLE].
    // iosNativeParkingConfirmed calls transition() which validates this.
    // On iOS, the native layer should always detect parking AFTER the driving
    // phase (via CoreMotion stationary), meaning the state would be either
    // PARKING_PENDING or IDLE by the time this is called on Android state machine.
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.iosNativeParkingConfirmed();
    // Transition rejected because DRIVING->PARKED is not in VALID_TRANSITIONS
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should transition from IDLE to PARKED', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.iosNativeParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
  });

  it('should transition from PARKING_PENDING to PARKED (and cancel debounce)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    ParkingDetectionStateMachine.iosNativeParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
    expect(sm._debounceTimer).toBeNull();
  });

  it('should be no-op when already PARKED', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKED';
    ParkingDetectionStateMachine.iosNativeParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');
  });
});

// ---------------------------------------------------------------------------
// 5. Departure Detection
// ---------------------------------------------------------------------------

describe('departureDetected', () => {
  it('should transition from PARKED to DRIVING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'PARKED';
    ParkingDetectionStateMachine.departureDetected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should be no-op from IDLE or DRIVING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.departureDetected();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');

    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.departureDetected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should cancel active debounce', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(sm._debounceTimer).not.toBeNull();

    ParkingDetectionStateMachine.departureDetected('bt_acl');
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(sm._debounceTimer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Transition Callbacks
// ---------------------------------------------------------------------------

describe('transition callbacks', () => {
  it('should fire callback on specific transition', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const callback = jest.fn();
    ParkingDetectionStateMachine.onTransition('IDLE->DRIVING', callback);

    ParkingDetectionStateMachine.btConnected();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BT_CONNECTED' })
    );
  });

  it('should fire wildcard callback for any transition to PARKED', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';

    const callback = jest.fn();
    ParkingDetectionStateMachine.onTransition('*->PARKED', callback);

    ParkingDetectionStateMachine.btDisconnected();
    jest.advanceTimersByTime(10000); // Debounce expires → PARKED
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe when returned function is called', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const callback = jest.fn();
    const unsubscribe = ParkingDetectionStateMachine.onTransition('IDLE->DRIVING', callback);

    unsubscribe();
    ParkingDetectionStateMachine.btConnected();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('state listeners', () => {
  it('should fire immediately with current snapshot', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const listener = jest.fn();
    ParkingDetectionStateMachine.addStateListener(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'IDLE' })
    );
  });

  it('should fire on every state transition', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const listener = jest.fn();
    ParkingDetectionStateMachine.addStateListener(listener);
    listener.mockClear(); // Clear the immediate call

    ParkingDetectionStateMachine.btConnected(); // IDLE -> DRIVING
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'DRIVING' })
    );

    ParkingDetectionStateMachine.btDisconnected(); // DRIVING -> PARKING_PENDING
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'PARKING_PENDING' })
    );
  });
});

// ---------------------------------------------------------------------------
// 7. BT Init Flows
// ---------------------------------------------------------------------------

describe('btInitConnected / btInitDisconnected', () => {
  it('should go from INITIALIZING to DRIVING on btInitConnected', async () => {
    await ParkingDetectionStateMachine.initialize();
    expect(ParkingDetectionStateMachine.state).toBe('INITIALIZING');
    ParkingDetectionStateMachine.btInitConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });

  it('should go from INITIALIZING to IDLE on btInitDisconnected', async () => {
    await ParkingDetectionStateMachine.initialize();
    ParkingDetectionStateMachine.btInitDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');
  });

  it('should correct stale DRIVING state on btInitDisconnected', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING'; // Stale from previous session
    ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
    // Should trigger disconnect flow → PARKING_PENDING
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');
  });
});

// ---------------------------------------------------------------------------
// 8. Monitoring Start/Stop
// ---------------------------------------------------------------------------

describe('monitoringStarted / monitoringStopped', () => {
  it('should transition from IDLE to INITIALIZING', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.monitoringStarted('My Car', 'AA:BB:CC');
    expect(ParkingDetectionStateMachine.state).toBe('INITIALIZING');
    expect(ParkingDetectionStateMachine.carName).toBe('My Car');
  });

  it('should transition to IDLE on monitoringStopped', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.monitoringStopped();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');
    expect(ParkingDetectionStateMachine.carName).toBeNull();
  });

  it('should cancel debounce on monitoringStopped', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.btDisconnected();
    expect(sm._debounceTimer).not.toBeNull();

    ParkingDetectionStateMachine.monitoringStopped();
    expect(sm._debounceTimer).toBeNull();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------
// 9. Invalid Transitions (should be rejected)
// ---------------------------------------------------------------------------

describe('invalid transitions', () => {
  it('should reject IDLE -> PARKED via parkingConfirmed', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.parkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('IDLE');
  });

  it('should reject DRIVING -> PARKED directly (must go through PARKING_PENDING)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';
    ParkingDetectionStateMachine.parkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
  });
});

// ---------------------------------------------------------------------------
// 10. Critical Invariant: Departure requires PARKED state
// ---------------------------------------------------------------------------

describe('CRITICAL: departure only fires from PARKED', () => {
  it('full cycle: IDLE → DRIVING → PARKING_PENDING → PARKED → DRIVING (departure)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const departureCallback = jest.fn();
    ParkingDetectionStateMachine.onTransition('PARKED->DRIVING', departureCallback);

    // 1. Car BT connects
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');

    // 2. Car BT disconnects
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    // 3. Debounce expires
    jest.advanceTimersByTime(10000);
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');

    // 4. Car BT reconnects (departure)
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(departureCallback).toHaveBeenCalledTimes(1);
  });

  it('manual parking should also enable departure detection', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const departureCallback = jest.fn();
    ParkingDetectionStateMachine.onTransition('PARKED->DRIVING', departureCallback);

    // Manual parking check
    ParkingDetectionStateMachine.manualParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');

    // Drive away
    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(departureCallback).toHaveBeenCalledTimes(1);
  });

  it('iOS native parking should also enable departure detection (via PARKING_PENDING)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'DRIVING';

    const departureCallback = jest.fn();
    ParkingDetectionStateMachine.onTransition('PARKED->DRIVING', departureCallback);

    // BT disconnects first, entering PARKING_PENDING
    ParkingDetectionStateMachine.btDisconnected();
    expect(ParkingDetectionStateMachine.state).toBe('PARKING_PENDING');

    // iOS CoreMotion confirms parking (from PARKING_PENDING)
    ParkingDetectionStateMachine.iosNativeParkingConfirmed();
    expect(ParkingDetectionStateMachine.state).toBe('PARKED');

    // Drive away (CoreMotion detects automotive)
    ParkingDetectionStateMachine.departureDetected('ios_native');
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(departureCallback).toHaveBeenCalledTimes(1);
  });

  it('IDLE → DRIVING should NOT fire departure callback', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';

    const departureCallback = jest.fn();
    ParkingDetectionStateMachine.onTransition('PARKED->DRIVING', departureCallback);

    ParkingDetectionStateMachine.btConnected();
    expect(ParkingDetectionStateMachine.state).toBe('DRIVING');
    expect(departureCallback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. Event Log
// ---------------------------------------------------------------------------

describe('event log', () => {
  it('should record events in the log', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    ParkingDetectionStateMachine.btConnected();
    const log = ParkingDetectionStateMachine.getEventLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log.some(e => e.type === 'BT_CONNECTED')).toBe(true);
  });

  it('should respect max log size (100 events)', async () => {
    await ParkingDetectionStateMachine.initialize();
    sm._state = 'IDLE';
    // Generate many events
    for (let i = 0; i < 150; i++) {
      sm._state = 'IDLE';
      ParkingDetectionStateMachine.btConnected();
      sm._state = 'DRIVING';
      ParkingDetectionStateMachine.btDisconnected();
    }
    const log = ParkingDetectionStateMachine.getEventLog();
    expect(log.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 12. Snapshot
// ---------------------------------------------------------------------------

describe('snapshot', () => {
  it('should return immutable snapshot of current state', async () => {
    await ParkingDetectionStateMachine.initialize('My Car', 'AA:BB:CC');
    sm._state = 'DRIVING';
    const snap = ParkingDetectionStateMachine.snapshot;
    expect(snap.state).toBe('DRIVING');
    expect(snap.carName).toBe('My Car');
    expect(snap.carAddress).toBe('AA:BB:CC');
    expect(snap.isConnectedToCar).toBe(true);
  });
});

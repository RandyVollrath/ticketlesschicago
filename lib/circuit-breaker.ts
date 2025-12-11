/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by temporarily stopping calls to failing services.
 * After a cooling-off period, allows test calls through to check if service recovered.
 *
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * Usage:
 * ```
 * const smsBreaker = new CircuitBreaker('clicksend-sms', { failureThreshold: 5 });
 *
 * // Wrap your service calls
 * const result = await smsBreaker.execute(
 *   () => sendClickSendSMS(phone, message),
 *   { phone, message }
 * );
 * ```
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  // Number of failures before opening circuit
  failureThreshold: number;
  // Time in ms to wait before trying again (half-open state)
  resetTimeout: number;
  // Number of successful calls in half-open to close circuit
  successThreshold: number;
  // Time window in ms to count failures (sliding window)
  failureWindow: number;
  // Optional callback when state changes
  onStateChange?: (service: string, oldState: CircuitState, newState: CircuitState) => void;
}

interface CircuitStats {
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  rejectedRequests: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,        // Open after 5 failures
  resetTimeout: 60000,        // Wait 1 minute before half-open
  successThreshold: 2,        // 2 successes in half-open to close
  failureWindow: 300000,      // 5-minute sliding window
};

// Global circuit breaker state (persists across requests in serverless)
const circuitState = new Map<string, {
  state: CircuitState;
  stats: CircuitStats;
  options: CircuitBreakerOptions;
  failureTimestamps: number[];
}>();

export class CircuitBreaker {
  private serviceName: string;
  private options: CircuitBreakerOptions;

  constructor(serviceName: string, options?: Partial<CircuitBreakerOptions>) {
    this.serviceName = serviceName;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize state if not exists
    if (!circuitState.has(serviceName)) {
      circuitState.set(serviceName, {
        state: 'CLOSED',
        stats: {
          failures: 0,
          successes: 0,
          lastFailureTime: 0,
          lastSuccessTime: 0,
          consecutiveSuccesses: 0,
          totalRequests: 0,
          rejectedRequests: 0,
        },
        options: this.options,
        failureTimestamps: [],
      });
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return circuitState.get(this.serviceName)?.state || 'CLOSED';
  }

  /**
   * Get circuit statistics
   */
  getStats(): CircuitStats {
    return circuitState.get(this.serviceName)?.stats || {
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      rejectedRequests: 0,
    };
  }

  /**
   * Check if circuit should allow request
   */
  private shouldAllowRequest(): boolean {
    const circuit = circuitState.get(this.serviceName)!;
    const now = Date.now();

    switch (circuit.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Check if reset timeout has passed
        if (now - circuit.stats.lastFailureTime >= this.options.resetTimeout) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        // Allow limited requests in half-open state
        return true;

      default:
        return true;
    }
  }

  /**
   * Transition circuit to new state
   */
  private transitionTo(newState: CircuitState): void {
    const circuit = circuitState.get(this.serviceName)!;
    const oldState = circuit.state;

    if (oldState === newState) return;

    circuit.state = newState;

    // Reset consecutive successes when transitioning to half-open
    if (newState === 'HALF_OPEN') {
      circuit.stats.consecutiveSuccesses = 0;
    }

    // Clear failure timestamps when closing
    if (newState === 'CLOSED') {
      circuit.failureTimestamps = [];
    }

    console.log(`🔌 Circuit breaker [${this.serviceName}]: ${oldState} → ${newState}`);

    if (this.options.onStateChange) {
      this.options.onStateChange(this.serviceName, oldState, newState);
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(): void {
    const circuit = circuitState.get(this.serviceName)!;
    const now = Date.now();

    circuit.stats.successes++;
    circuit.stats.lastSuccessTime = now;
    circuit.stats.consecutiveSuccesses++;

    // In half-open state, check if we should close the circuit
    if (circuit.state === 'HALF_OPEN') {
      if (circuit.stats.consecutiveSuccesses >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }
  }

  /**
   * Record a failed call
   */
  private recordFailure(error: Error): void {
    const circuit = circuitState.get(this.serviceName)!;
    const now = Date.now();

    circuit.stats.failures++;
    circuit.stats.lastFailureTime = now;
    circuit.stats.consecutiveSuccesses = 0;
    circuit.failureTimestamps.push(now);

    // Clean up old failure timestamps (outside the window)
    circuit.failureTimestamps = circuit.failureTimestamps.filter(
      (ts) => now - ts < this.options.failureWindow
    );

    // In half-open state, any failure opens the circuit
    if (circuit.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      return;
    }

    // In closed state, check if we should open
    if (circuit.state === 'CLOSED') {
      if (circuit.failureTimestamps.length >= this.options.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - The function to execute
   * @param context - Optional context for logging
   * @returns Promise with result or throws CircuitOpenError
   */
  async execute<T>(
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const circuit = circuitState.get(this.serviceName)!;
    circuit.stats.totalRequests++;

    // Check if circuit allows request
    if (!this.shouldAllowRequest()) {
      circuit.stats.rejectedRequests++;
      const timeUntilRetry = Math.max(
        0,
        this.options.resetTimeout - (Date.now() - circuit.stats.lastFailureTime)
      );

      console.warn(
        `🚫 Circuit breaker [${this.serviceName}] OPEN - rejecting request. ` +
        `Retry in ${Math.ceil(timeUntilRetry / 1000)}s. ` +
        `Context: ${JSON.stringify(context || {})}`
      );

      throw new CircuitOpenError(
        this.serviceName,
        timeUntilRetry,
        circuit.stats.failures
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);

      console.error(
        `❌ Circuit breaker [${this.serviceName}] recorded failure ` +
        `(${circuit.failureTimestamps.length}/${this.options.failureThreshold}). ` +
        `State: ${circuit.state}. Error: ${(error as Error).message}`
      );

      throw error;
    }
  }

  /**
   * Execute with a fallback value if circuit is open
   */
  async executeWithFallback<T>(
    fn: () => Promise<T>,
    fallback: T,
    context?: Record<string, unknown>
  ): Promise<{ result: T; fromFallback: boolean; circuitOpen: boolean }> {
    try {
      const result = await this.execute(fn, context);
      return { result, fromFallback: false, circuitOpen: false };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return { result: fallback, fromFallback: true, circuitOpen: true };
      }
      // Re-throw non-circuit errors
      throw error;
    }
  }

  /**
   * Force reset the circuit (for admin use)
   */
  reset(): void {
    const circuit = circuitState.get(this.serviceName)!;
    circuit.state = 'CLOSED';
    circuit.failureTimestamps = [];
    circuit.stats.consecutiveSuccesses = 0;
    console.log(`🔄 Circuit breaker [${this.serviceName}] manually reset`);
  }

  /**
   * Force open the circuit (for testing/maintenance)
   */
  forceOpen(): void {
    this.transitionTo('OPEN');
    const circuit = circuitState.get(this.serviceName)!;
    circuit.stats.lastFailureTime = Date.now();
    console.log(`⚡ Circuit breaker [${this.serviceName}] manually opened`);
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitOpenError extends Error {
  public readonly serviceName: string;
  public readonly retryAfterMs: number;
  public readonly failureCount: number;

  constructor(serviceName: string, retryAfterMs: number, failureCount: number) {
    super(
      `Service ${serviceName} circuit is OPEN. ` +
      `${failureCount} failures recorded. ` +
      `Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`
    );
    this.name = 'CircuitOpenError';
    this.serviceName = serviceName;
    this.retryAfterMs = retryAfterMs;
    this.failureCount = failureCount;
  }
}

// Pre-configured circuit breakers for common services
export const circuitBreakers = {
  // SMS service - open after 5 failures, wait 2 minutes before retry
  sms: new CircuitBreaker('clicksend-sms', {
    failureThreshold: 5,
    resetTimeout: 120000,
    successThreshold: 2,
    failureWindow: 300000,
  }),

  // Email service - more tolerant, open after 10 failures
  email: new CircuitBreaker('resend-email', {
    failureThreshold: 10,
    resetTimeout: 60000,
    successThreshold: 3,
    failureWindow: 300000,
  }),

  // Voice service - open after 3 failures (more expensive)
  voice: new CircuitBreaker('clicksend-voice', {
    failureThreshold: 3,
    resetTimeout: 180000,
    successThreshold: 2,
    failureWindow: 300000,
  }),

  // Push notifications - very tolerant
  push: new CircuitBreaker('push-notifications', {
    failureThreshold: 15,
    resetTimeout: 60000,
    successThreshold: 3,
    failureWindow: 300000,
  }),
};

/**
 * Get all circuit breaker states (for admin monitoring)
 */
export function getAllCircuitStates(): Record<string, {
  state: CircuitState;
  stats: CircuitStats;
  timeSinceLastFailure: number | null;
  timeSinceLastSuccess: number | null;
}> {
  const now = Date.now();
  const states: Record<string, any> = {};

  for (const [name, circuit] of circuitState.entries()) {
    states[name] = {
      state: circuit.state,
      stats: circuit.stats,
      timeSinceLastFailure: circuit.stats.lastFailureTime
        ? now - circuit.stats.lastFailureTime
        : null,
      timeSinceLastSuccess: circuit.stats.lastSuccessTime
        ? now - circuit.stats.lastSuccessTime
        : null,
    };
  }

  return states;
}

/**
 * Reset all circuit breakers (for admin use)
 */
export function resetAllCircuits(): void {
  for (const breaker of Object.values(circuitBreakers)) {
    breaker.reset();
  }
  console.log('🔄 All circuit breakers reset');
}

/**
 * useTimeSimulation Hook
 *
 * Manages time simulation for the parking map.
 * Allows users to scrub forward/backward to see parking status at different times.
 */

import { useState, useCallback, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface UseTimeSimulationOptions {
  maxHoursAhead?: number; // Default 48 hours
  maxHoursBehind?: number; // Default 0 (no past)
  updateInterval?: number; // Auto-update interval in ms (0 = disabled)
}

export interface UseTimeSimulationResult {
  simulatedTime: Date;
  setSimulatedTime: (time: Date) => void;
  offsetHours: number;
  setOffsetHours: (hours: number) => void;
  resetToNow: () => void;
  isLive: boolean;
  formattedTime: string;
  formattedDate: string;
  timeRange: {
    min: Date;
    max: Date;
    minHours: number;
    maxHours: number;
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useTimeSimulation(
  options: UseTimeSimulationOptions = {}
): UseTimeSimulationResult {
  const { maxHoursAhead = 48, maxHoursBehind = 0 } = options;

  const [now] = useState(() => new Date());
  const [offsetHours, setOffsetHours] = useState(0);

  /**
   * Calculate simulated time from offset
   */
  const simulatedTime = useMemo(() => {
    const time = new Date();
    time.setHours(time.getHours() + offsetHours);
    return time;
  }, [offsetHours]);

  /**
   * Set simulated time directly
   */
  const setSimulatedTime = useCallback(
    (time: Date) => {
      const currentTime = new Date();
      const diffMs = time.getTime() - currentTime.getTime();
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));

      // Clamp to valid range
      const clampedHours = Math.max(-maxHoursBehind, Math.min(maxHoursAhead, diffHours));
      setOffsetHours(clampedHours);
    },
    [maxHoursAhead, maxHoursBehind]
  );

  /**
   * Set offset hours directly (clamped)
   */
  const setOffsetHoursClamped = useCallback(
    (hours: number) => {
      const clamped = Math.max(-maxHoursBehind, Math.min(maxHoursAhead, hours));
      setOffsetHours(clamped);
    },
    [maxHoursAhead, maxHoursBehind]
  );

  /**
   * Reset to current time
   */
  const resetToNow = useCallback(() => {
    setOffsetHours(0);
  }, []);

  /**
   * Check if viewing current time
   */
  const isLive = useMemo(() => Math.abs(offsetHours) < 0.5, [offsetHours]);

  /**
   * Format time for display
   */
  const formattedTime = useMemo(
    () =>
      simulatedTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    [simulatedTime]
  );

  /**
   * Format date for display
   */
  const formattedDate = useMemo(
    () =>
      simulatedTime.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [simulatedTime]
  );

  /**
   * Calculate time range
   */
  const timeRange = useMemo(() => {
    const currentTime = new Date();
    const minTime = new Date(currentTime);
    minTime.setHours(minTime.getHours() - maxHoursBehind);
    const maxTime = new Date(currentTime);
    maxTime.setHours(maxTime.getHours() + maxHoursAhead);

    return {
      min: minTime,
      max: maxTime,
      minHours: -maxHoursBehind,
      maxHours: maxHoursAhead,
    };
  }, [maxHoursAhead, maxHoursBehind]);

  return {
    simulatedTime,
    setSimulatedTime,
    offsetHours,
    setOffsetHours: setOffsetHoursClamped,
    resetToNow,
    isLive,
    formattedTime,
    formattedDate,
    timeRange,
  };
}

export default useTimeSimulation;

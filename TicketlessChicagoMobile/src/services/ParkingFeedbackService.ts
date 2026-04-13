/**
 * Parking Feedback Service — Layer 2 of accuracy measurement system.
 *
 * Collects user feedback after each parking event:
 *   1. Did parking actually occur? (not a false positive / red light)
 *   2. Is the street/block correct?
 *   3. Which side of the street? (N/S/E/W)
 *
 * Feedback is submitted to /api/mobile/parking-feedback which updates
 * the parking_diagnostics row for accuracy tracking and learning.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiClient } from './ApiClient';
import { Logger } from '../utils/Logger';

const log = Logger.createLogger('ParkingFeedback');

const STORAGE_KEY = 'parking_feedback_pending_v1';

export interface ParkingFeedback {
  // Set when parking notification fires — before user responds
  address: string;
  streetName: string;       // Resolved street name (e.g., "LAWRENCE")
  streetDirection: string;  // N, S, E, W
  resolvedSide: string;     // N, S, E, W — what the system determined
  timestamp: number;        // When parking was detected

  // User responses (null = not yet answered)
  confirmedParking: boolean | null;   // Q1: Did parking occur?
  confirmedBlock: boolean | null;     // Q2: Is the street/block correct?
  reportedSide: string | null;        // Q3: N, S, E, W

  // Submission state
  submitted: boolean;
}

class ParkingFeedbackServiceClass {
  private pending: ParkingFeedback | null = null;

  /**
   * Record that a parking event occurred. Called from BackgroundTaskService
   * after a parking check completes. Sets up the feedback prompt.
   */
  async recordParkingEvent(params: {
    address: string;
    streetName: string;
    streetDirection: string;
    resolvedSide: string;
  }): Promise<void> {
    this.pending = {
      address: params.address,
      streetName: params.streetName,
      streetDirection: params.streetDirection,
      resolvedSide: params.resolvedSide,
      timestamp: Date.now(),
      confirmedParking: null,
      confirmedBlock: null,
      reportedSide: null,
      submitted: false,
    };
    await this.persist();
    log.info(`Feedback pending for: ${params.address} (side: ${params.resolvedSide})`);
  }

  /**
   * Get the current pending feedback (for UI to display).
   * Returns null if no feedback is pending or it's too old (>4 hours).
   */
  async getPending(): Promise<ParkingFeedback | null> {
    if (!this.pending) {
      await this.loadFromStorage();
    }
    if (!this.pending) return null;

    // Expire after 4 hours
    if (Date.now() - this.pending.timestamp > 4 * 60 * 60 * 1000) {
      this.pending = null;
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Don't show if already submitted
    if (this.pending.submitted) return null;

    return this.pending;
  }

  /**
   * Submit user's answer to question 1: Did parking occur?
   */
  async answerParking(confirmed: boolean): Promise<void> {
    if (!this.pending) return;
    this.pending.confirmedParking = confirmed;
    await this.persist();

    if (!confirmed) {
      // False positive — submit immediately, no more questions needed
      await this.submitFeedback();
    }
  }

  /**
   * Submit user's answer to question 2: Is the block correct?
   */
  async answerBlock(correct: boolean): Promise<void> {
    if (!this.pending) return;
    this.pending.confirmedBlock = correct;
    await this.persist();
  }

  /**
   * Submit user's answer to question 3: Which side of the street?
   * Also triggers final submission.
   */
  async answerSide(side: 'N' | 'S' | 'E' | 'W'): Promise<void> {
    if (!this.pending) return;
    this.pending.reportedSide = side;
    await this.persist();
    await this.submitFeedback();
  }

  /**
   * Skip feedback (user doesn't want to answer).
   */
  async skip(): Promise<void> {
    this.pending = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
    log.info('Feedback skipped');
  }

  /**
   * Submit all collected feedback to the server.
   */
  private async submitFeedback(): Promise<void> {
    if (!this.pending) return;

    try {
      await ApiClient.authPost('/api/mobile/parking-feedback', {
        confirmed_parking: this.pending.confirmedParking,
        confirmed_block: this.pending.confirmedBlock,
        reported_side: this.pending.reportedSide,
      });

      this.pending.submitted = true;
      await this.persist();
      log.info(`Feedback submitted: parking=${this.pending.confirmedParking}, block=${this.pending.confirmedBlock}, side=${this.pending.reportedSide}`);

      // Clear after successful submission
      this.pending = null;
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      log.warn('Failed to submit feedback (will retry):', err);
      // Keep in storage for retry on next app open
    }
  }

  private async persist(): Promise<void> {
    if (this.pending) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.pending));
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.pending = JSON.parse(stored);
      }
    } catch {
      // Ignore parse errors
    }
  }
}

export const ParkingFeedbackService = new ParkingFeedbackServiceClass();

/**
 * Simple event emitter for app-wide events
 */
type EventCallback = (...args: any[]) => void;

class AppEventsService {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[AppEvents] Error in listener for "${event}":`, error);
      }
    });
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

export default new AppEventsService();

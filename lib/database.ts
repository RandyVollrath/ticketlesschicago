// Database schema and utilities
// This is a mock implementation - replace with your preferred database (PostgreSQL, MongoDB, etc.)

import { User, Vehicle, Obligation, Reminder, AutoRegistrationRequest } from '../types';

// Mock database - in a real app, this would be your database connection
class MockDatabase {
  private users: Map<string, User> = new Map();
  private vehicles: Map<string, Vehicle> = new Map();
  private obligations: Map<string, Obligation> = new Map();
  private reminders: Map<string, Reminder> = new Map();
  private autoRegistrations: Map<string, AutoRegistrationRequest> = new Map();

  // User operations
  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const user: User = {
      ...userData,
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      vehicles: []
    };
    
    this.users.set(user.id, user);
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Vehicle operations
  async createVehicle(vehicleData: Omit<Vehicle, 'id' | 'createdAt'>): Promise<Vehicle> {
    const vehicle: Vehicle = {
      ...vehicleData,
      id: `vehicle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    
    this.vehicles.set(vehicle.id, vehicle);
    
    // Update user's vehicles array
    const user = this.users.get(vehicle.userId);
    if (user) {
      user.vehicles.push(vehicle);
      this.users.set(user.id, user);
    }
    
    return vehicle;
  }

  async getVehiclesByUserId(userId: string): Promise<Vehicle[]> {
    const vehicles: Vehicle[] = [];
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.userId === userId) {
        vehicles.push(vehicle);
      }
    }
    return vehicles;
  }

  // Obligation operations
  async createObligation(obligationData: Omit<Obligation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Obligation> {
    const obligation: Obligation = {
      ...obligationData,
      id: `obligation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reminders: []
    };
    
    this.obligations.set(obligation.id, obligation);
    return obligation;
  }

  async getObligationsByUserId(userId: string): Promise<Obligation[]> {
    const obligations: Obligation[] = [];
    for (const obligation of this.obligations.values()) {
      if (obligation.userId === userId) {
        obligations.push(obligation);
      }
    }
    return obligations;
  }

  async updateObligation(id: string, updates: Partial<Obligation>): Promise<Obligation | null> {
    const obligation = this.obligations.get(id);
    if (!obligation) return null;

    const updatedObligation = {
      ...obligation,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.obligations.set(id, updatedObligation);
    return updatedObligation;
  }

  async getUpcomingObligations(days: number = 30): Promise<Obligation[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);
    
    const upcomingObligations: Obligation[] = [];
    for (const obligation of this.obligations.values()) {
      if (!obligation.completed && new Date(obligation.dueDate) <= cutoffDate) {
        upcomingObligations.push(obligation);
      }
    }
    
    return upcomingObligations.sort((a, b) => 
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );
  }

  // Reminder operations
  async createReminder(reminderData: Omit<Reminder, 'id'>): Promise<Reminder> {
    const reminder: Reminder = {
      ...reminderData,
      id: `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    this.reminders.set(reminder.id, reminder);
    
    // Add to obligation's reminders array
    const obligation = this.obligations.get(reminder.obligationId);
    if (obligation) {
      obligation.reminders.push(reminder);
      this.obligations.set(obligation.id, obligation);
    }
    
    return reminder;
  }

  async getPendingReminders(): Promise<Reminder[]> {
    const now = new Date();
    const pendingReminders: Reminder[] = [];
    
    for (const reminder of this.reminders.values()) {
      if (!reminder.sent && new Date(reminder.scheduledFor) <= now) {
        pendingReminders.push(reminder);
      }
    }
    
    return pendingReminders;
  }

  async markReminderSent(id: string): Promise<Reminder | null> {
    const reminder = this.reminders.get(id);
    if (!reminder) return null;

    reminder.sent = true;
    reminder.sentAt = new Date().toISOString();
    this.reminders.set(id, reminder);
    
    return reminder;
  }
}

// Export singleton instance
export const db = new MockDatabase();

// Database initialization function
export async function initializeDatabase(): Promise<void> {
  // In a real application, this would set up database connections,
  // run migrations, create indexes, etc.
  console.log('Database initialized');
}

// Helper functions for Chicago-specific logic
export function calculateNextCityStickerDue(currentYear: number): string {
  return `${currentYear}-07-31`;
}

export function calculateNextEmissionsDue(vehicleYear: number, currentYear: number): string | null {
  // Emissions required for vehicles 4+ years old, every 2 years
  if (currentYear - vehicleYear < 4) return null;
  
  // Determine if this is an emissions year for this vehicle
  const isEmissionsYear = vehicleYear % 2 === currentYear % 2;
  const emissionsYear = isEmissionsYear ? currentYear : currentYear + 1;
  
  return `${emissionsYear}-12-31`;
}
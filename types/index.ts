export interface User {
  id: string;
  email: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  preferences: NotificationPreferences;
  vehicles: Vehicle[];
}

export interface Vehicle {
  id: string;
  userId: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vin?: string;
  createdAt: string;
}

export interface Obligation {
  id: string;
  userId: string;
  vehicleId: string;
  type: ObligationType;
  dueDate: string;
  description: string;
  completed: boolean;
  completedAt?: string;
  autoRegister: boolean;
  cost?: number;
  reminders: Reminder[];
  createdAt: string;
  updatedAt: string;
}

export type ObligationType = 'city-sticker' | 'emissions' | 'vehicle-registration' | 'parking-permits';

export interface Reminder {
  id: string;
  obligationId: string;
  type: 'email' | 'sms' | 'push';
  scheduledFor: string;
  sent: boolean;
  sentAt?: string;
  error?: string;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  reminderDays: number[]; // Days before due date to send reminders (e.g., [30, 7, 1])
}

export interface AutoRegistrationRequest {
  id: string;
  userId: string;
  obligationId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  completedAt?: string;
  error?: string;
  cost: number;
  paymentStatus: 'pending' | 'paid' | 'failed';
}

// Chicago-specific constants
export const CHICAGO_OBLIGATIONS = {
  CITY_STICKER: {
    type: 'city-sticker' as const,
    dueDate: '07-31', // July 31st annually
    description: 'City of Chicago vehicle sticker registration',
    baseCost: 96.50, // 2024 rate for regular vehicles
    website: 'https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/vehicle_stickers.html'
  },
  EMISSIONS: {
    type: 'emissions' as const,
    dueDate: '12-31', // December 31st biennially
    description: 'Illinois emissions test',
    baseCost: 20, // Approximate cost
    website: 'https://www2.illinoisepa.gov/topics/air-quality/mobile-sources/vehicle-emissions-testing'
  }
} as const;
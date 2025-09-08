export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          phone: string | null
          created_at: string
          updated_at: string
          email_verified: boolean
          phone_verified: boolean
          notification_preferences: Json
        }
        Insert: {
          id?: string
          email: string
          phone?: string | null
          created_at?: string
          updated_at?: string
          email_verified?: boolean
          phone_verified?: boolean
          notification_preferences?: Json
        }
        Update: {
          id?: string
          email?: string
          phone?: string | null
          created_at?: string
          updated_at?: string
          email_verified?: boolean
          phone_verified?: boolean
          notification_preferences?: Json
        }
      }
      vehicles: {
        Row: {
          id: string
          user_id: string
          make: string | null
          model: string | null
          year: number | null
          license_plate: string | null
          vin: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          make?: string | null
          model?: string | null
          year?: number | null
          license_plate?: string | null
          vin?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          make?: string | null
          model?: string | null
          year?: number | null
          license_plate?: string | null
          vin?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      city_sticker_reminders: {
        Row: {
          id: string
          user_id: string
          vehicle_id: string | null
          renewal_date: string
          auto_renew_enabled: boolean
          reminder_sent: boolean
          reminder_sent_at: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          updated_at: string
          notes: string | null
        }
        Insert: {
          id?: string
          user_id: string
          vehicle_id?: string | null
          renewal_date: string
          auto_renew_enabled?: boolean
          reminder_sent?: boolean
          reminder_sent_at?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          notes?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          vehicle_id?: string | null
          renewal_date?: string
          auto_renew_enabled?: boolean
          reminder_sent?: boolean
          reminder_sent_at?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          notes?: string | null
        }
      }
      auto_renewal_requests: {
        Row: {
          id: string
          user_id: string
          city_sticker_reminder_id: string
          status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
          requested_at: string
          processed_at: string | null
          error_message: string | null
          cost_estimate: number | null
          payment_required: boolean
          payment_completed: boolean
          notes: string | null
        }
        Insert: {
          id?: string
          user_id: string
          city_sticker_reminder_id: string
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
          requested_at?: string
          processed_at?: string | null
          error_message?: string | null
          cost_estimate?: number | null
          payment_required?: boolean
          payment_completed?: boolean
          notes?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          city_sticker_reminder_id?: string
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
          requested_at?: string
          processed_at?: string | null
          error_message?: string | null
          cost_estimate?: number | null
          payment_required?: boolean
          payment_completed?: boolean
          notes?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
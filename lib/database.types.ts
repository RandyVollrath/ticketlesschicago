export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      affiliate_commission_tracker: {
        Row: {
          adjusted_at: string | null
          adjusted_by: string | null
          commission_adjusted: boolean | null
          created_at: string | null
          customer_email: string
          expected_commission: number
          id: string
          plan: string
          referral_id: string
          stripe_session_id: string
          total_amount: number
        }
        Insert: {
          adjusted_at?: string | null
          adjusted_by?: string | null
          commission_adjusted?: boolean | null
          created_at?: string | null
          customer_email: string
          expected_commission: number
          id?: string
          plan: string
          referral_id: string
          stripe_session_id: string
          total_amount: number
        }
        Update: {
          adjusted_at?: string | null
          adjusted_by?: string | null
          commission_adjusted?: boolean | null
          created_at?: string | null
          customer_email?: string
          expected_commission?: number
          id?: string
          plan?: string
          referral_id?: string
          stripe_session_id?: string
          total_amount?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action_details: Json | null
          action_type: string
          admin_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          error_message: string | null
          id: string
          ip_address: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          admin_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          status: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          admin_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      auto_renewal_requests: {
        Row: {
          city_sticker_reminder_id: string
          cost_estimate: number | null
          error_message: string | null
          id: string
          notes: string | null
          payment_completed: boolean | null
          payment_required: boolean | null
          processed_at: string | null
          requested_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          city_sticker_reminder_id: string
          cost_estimate?: number | null
          error_message?: string | null
          id?: string
          notes?: string | null
          payment_completed?: boolean | null
          payment_required?: boolean | null
          processed_at?: string | null
          requested_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          city_sticker_reminder_id?: string
          cost_estimate?: number | null
          error_message?: string | null
          id?: string
          notes?: string | null
          payment_completed?: boolean | null
          payment_required?: boolean | null
          processed_at?: string | null
          requested_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_renewal_requests_city_sticker_reminder_id_fkey"
            columns: ["city_sticker_reminder_id"]
            isOneToOne: false
            referencedRelation: "city_sticker_reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      boston_street_sweeping: {
        Row: {
          created_at: string | null
          dist: string | null
          dist_name: string | null
          end_time: string
          every_day: boolean | null
          friday: boolean | null
          from_street: string | null
          hista: number | null
          id: number
          losta: number | null
          main_id: number | null
          miles: number | null
          monday: boolean | null
          north_end_pilot: boolean | null
          one_way: boolean | null
          parent: string | null
          saturday: boolean | null
          section: string | null
          segment_lat: number | null
          segment_lng: number | null
          side: string | null
          st_name: string
          start_time: string
          sunday: boolean | null
          thursday: boolean | null
          to_street: string | null
          tuesday: boolean | null
          updated_at: string | null
          wednesday: boolean | null
          week_1: boolean | null
          week_2: boolean | null
          week_3: boolean | null
          week_4: boolean | null
          week_5: boolean | null
          year_round: boolean | null
        }
        Insert: {
          created_at?: string | null
          dist?: string | null
          dist_name?: string | null
          end_time: string
          every_day?: boolean | null
          friday?: boolean | null
          from_street?: string | null
          hista?: number | null
          id?: number
          losta?: number | null
          main_id?: number | null
          miles?: number | null
          monday?: boolean | null
          north_end_pilot?: boolean | null
          one_way?: boolean | null
          parent?: string | null
          saturday?: boolean | null
          section?: string | null
          segment_lat?: number | null
          segment_lng?: number | null
          side?: string | null
          st_name: string
          start_time: string
          sunday?: boolean | null
          thursday?: boolean | null
          to_street?: string | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
          week_1?: boolean | null
          week_2?: boolean | null
          week_3?: boolean | null
          week_4?: boolean | null
          week_5?: boolean | null
          year_round?: boolean | null
        }
        Update: {
          created_at?: string | null
          dist?: string | null
          dist_name?: string | null
          end_time?: string
          every_day?: boolean | null
          friday?: boolean | null
          from_street?: string | null
          hista?: number | null
          id?: number
          losta?: number | null
          main_id?: number | null
          miles?: number | null
          monday?: boolean | null
          north_end_pilot?: boolean | null
          one_way?: boolean | null
          parent?: string | null
          saturday?: boolean | null
          section?: string | null
          segment_lat?: number | null
          segment_lng?: number | null
          side?: string | null
          st_name?: string
          start_time?: string
          sunday?: boolean | null
          thursday?: boolean | null
          to_street?: string | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
          week_1?: boolean | null
          week_2?: boolean | null
          week_3?: boolean | null
          week_4?: boolean | null
          week_5?: boolean | null
          year_round?: boolean | null
        }
        Relationships: []
      }
      city_sticker_reminders: {
        Row: {
          auto_renew_enabled: boolean | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          id: string
          notes: string | null
          reminder_sent: boolean | null
          reminder_sent_at: string | null
          renewal_date: string
          updated_at: string | null
          user_id: string
          vehicle_id: string | null
        }
        Insert: {
          auto_renew_enabled?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          renewal_date: string
          updated_at?: string | null
          user_id: string
          vehicle_id?: string | null
        }
        Update: {
          auto_renew_enabled?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          renewal_date?: string
          updated_at?: string | null
          user_id?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      contested_tickets_foia: {
        Row: {
          contest_type: string | null
          created_at: string | null
          disposition: string | null
          disposition_date: string | null
          hearing_location: string | null
          hearing_officer: string | null
          id: number
          notes: string | null
          reason: string | null
          street_direction: string | null
          street_name: string | null
          street_number: string | null
          ticket_number: string
          violation_code: string | null
          violation_date: string | null
          violation_description: string | null
          ward: string | null
        }
        Insert: {
          contest_type?: string | null
          created_at?: string | null
          disposition?: string | null
          disposition_date?: string | null
          hearing_location?: string | null
          hearing_officer?: string | null
          id?: number
          notes?: string | null
          reason?: string | null
          street_direction?: string | null
          street_name?: string | null
          street_number?: string | null
          ticket_number: string
          violation_code?: string | null
          violation_date?: string | null
          violation_description?: string | null
          ward?: string | null
        }
        Update: {
          contest_type?: string | null
          created_at?: string | null
          disposition?: string | null
          disposition_date?: string | null
          hearing_location?: string | null
          hearing_officer?: string | null
          id?: number
          notes?: string | null
          reason?: string | null
          street_direction?: string | null
          street_name?: string | null
          street_number?: string | null
          ticket_number?: string
          violation_code?: string | null
          violation_date?: string | null
          violation_description?: string | null
          ward?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string | null
          id: string
          name: string | null
          phone: string
          referral_code: string | null
          referred_by_code: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name?: string | null
          phone: string
          referral_code?: string | null
          referred_by_code?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string | null
          phone?: string
          referral_code?: string | null
          referred_by_code?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      drip_campaign_status: {
        Row: {
          campaign_name: string
          created_at: string | null
          email: string
          id: string
          proof_opened: boolean | null
          proof_sent: boolean | null
          proof_sent_at: string | null
          soft_sell_opened: boolean | null
          soft_sell_sent: boolean | null
          soft_sell_sent_at: string | null
          unsubscribed: boolean | null
          unsubscribed_at: string | null
          updated_at: string | null
          upgraded_at: string | null
          upgraded_to_protection: boolean | null
          user_id: string
          welcome_opened: boolean | null
          welcome_sent: boolean | null
          welcome_sent_at: string | null
        }
        Insert: {
          campaign_name?: string
          created_at?: string | null
          email: string
          id?: string
          proof_opened?: boolean | null
          proof_sent?: boolean | null
          proof_sent_at?: string | null
          soft_sell_opened?: boolean | null
          soft_sell_sent?: boolean | null
          soft_sell_sent_at?: string | null
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string | null
          upgraded_at?: string | null
          upgraded_to_protection?: boolean | null
          user_id: string
          welcome_opened?: boolean | null
          welcome_sent?: boolean | null
          welcome_sent_at?: string | null
        }
        Update: {
          campaign_name?: string
          created_at?: string | null
          email?: string
          id?: string
          proof_opened?: boolean | null
          proof_sent?: boolean | null
          proof_sent_at?: string | null
          soft_sell_opened?: boolean | null
          soft_sell_sent?: boolean | null
          soft_sell_sent_at?: string | null
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string | null
          upgraded_at?: string | null
          upgraded_to_protection?: boolean | null
          user_id?: string
          welcome_opened?: boolean | null
          welcome_sent?: boolean | null
          welcome_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drip_campaign_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_follow_up"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "drip_campaign_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_one_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "drip_campaign_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_users_with_addresses"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "drip_campaign_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_zero_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "drip_campaign_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      earnings: {
        Row: {
          created_at: string | null
          id: string
          job_amount: number
          job_id: string | null
          platform_fee: number
          shoveler_payout: number
          shoveler_phone: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_amount: number
          job_id?: string | null
          platform_fee: number
          shoveler_payout: number
          shoveler_phone: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_amount?: number
          job_id?: string | null
          platform_fee?: number
          shoveler_payout?: number
          shoveler_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "earnings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          cleaning_date: string | null
          days_before: number | null
          delivered_at: string | null
          email: string
          error_message: string | null
          id: string
          message: string | null
          message_type: string | null
          metadata: Json | null
          opened_at: string | null
          provider: string | null
          section: string | null
          sent_at: string | null
          status: string | null
          subject: string
          user_id: string | null
          ward: string | null
        }
        Insert: {
          cleaning_date?: string | null
          days_before?: number | null
          delivered_at?: string | null
          email: string
          error_message?: string | null
          id?: string
          message?: string | null
          message_type?: string | null
          metadata?: Json | null
          opened_at?: string | null
          provider?: string | null
          section?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          user_id?: string | null
          ward?: string | null
        }
        Update: {
          cleaning_date?: string | null
          days_before?: number | null
          delivered_at?: string | null
          email?: string
          error_message?: string | null
          id?: string
          message?: string | null
          message_type?: string | null
          metadata?: Json | null
          opened_at?: string | null
          provider?: string | null
          section?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          user_id?: string | null
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      emissions_reminders: {
        Row: {
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          id: string
          notes: string | null
          reminder_sent: boolean | null
          reminder_sent_at: string | null
          test_date: string
          updated_at: string | null
          user_id: string
          vehicle_id: string | null
        }
        Insert: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          test_date: string
          updated_at?: string | null
          user_id: string
          vehicle_id?: string | null
        }
        Update: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          test_date?: string
          updated_at?: string | null
          user_id?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      incoming_sms: {
        Row: {
          clicksend_data: Json | null
          clicksend_message_id: string | null
          created_at: string | null
          email_sent: boolean | null
          from_number: string
          id: number
          matched_user_email: string | null
          message_body: string
          processed: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          clicksend_data?: Json | null
          clicksend_message_id?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          from_number: string
          id?: number
          matched_user_email?: string | null
          message_body: string
          processed?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          clicksend_data?: Json | null
          clicksend_message_id?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          from_number?: string
          id?: number
          matched_user_email?: string | null
          message_body?: string
          processed?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      job_messages: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          message: string
          sender_phone: string
          sender_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          message: string
          sender_phone: string
          sender_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          message?: string
          sender_phone?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          accepted_at: string | null
          address: string
          after_pic: string | null
          arrived_at: string | null
          auto_complete_at: string | null
          backup_assigned_at: string | null
          backup_bonus: number | null
          backup_plower_id: string | null
          bid_deadline: string | null
          bid_mode: boolean | null
          bids: Json | null
          broadcasted_at: string | null
          cancellation_fee: number | null
          cancellation_fee_paid: boolean | null
          cancelled_at: string | null
          cancelled_by: string | null
          chat_history: Json | null
          claimed_at: string | null
          completed_at: string | null
          cool_with_teens: boolean | null
          created_at: string | null
          customer_phone: string
          description: string | null
          final_price: number | null
          flexibility_minutes: number | null
          id: string
          lat: number | null
          long: number | null
          max_price: number | null
          neighborhood: string | null
          offered_price: number | null
          on_the_way_at: string | null
          paid_out: boolean | null
          payment_intent_id: string | null
          payment_status: string | null
          pics: Json | null
          platform_fee_cents: number | null
          schedule_notified: boolean | null
          scheduled_for: string | null
          selected_bid_index: number | null
          service_type: string | null
          shoveler_phone: string | null
          status: string | null
          surge_multiplier: number | null
          total_price_cents: number | null
          weather_note: string | null
        }
        Insert: {
          accepted_at?: string | null
          address: string
          after_pic?: string | null
          arrived_at?: string | null
          auto_complete_at?: string | null
          backup_assigned_at?: string | null
          backup_bonus?: number | null
          backup_plower_id?: string | null
          bid_deadline?: string | null
          bid_mode?: boolean | null
          bids?: Json | null
          broadcasted_at?: string | null
          cancellation_fee?: number | null
          cancellation_fee_paid?: boolean | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          chat_history?: Json | null
          claimed_at?: string | null
          completed_at?: string | null
          cool_with_teens?: boolean | null
          created_at?: string | null
          customer_phone: string
          description?: string | null
          final_price?: number | null
          flexibility_minutes?: number | null
          id?: string
          lat?: number | null
          long?: number | null
          max_price?: number | null
          neighborhood?: string | null
          offered_price?: number | null
          on_the_way_at?: string | null
          paid_out?: boolean | null
          payment_intent_id?: string | null
          payment_status?: string | null
          pics?: Json | null
          platform_fee_cents?: number | null
          schedule_notified?: boolean | null
          scheduled_for?: string | null
          selected_bid_index?: number | null
          service_type?: string | null
          shoveler_phone?: string | null
          status?: string | null
          surge_multiplier?: number | null
          total_price_cents?: number | null
          weather_note?: string | null
        }
        Update: {
          accepted_at?: string | null
          address?: string
          after_pic?: string | null
          arrived_at?: string | null
          auto_complete_at?: string | null
          backup_assigned_at?: string | null
          backup_bonus?: number | null
          backup_plower_id?: string | null
          bid_deadline?: string | null
          bid_mode?: boolean | null
          bids?: Json | null
          broadcasted_at?: string | null
          cancellation_fee?: number | null
          cancellation_fee_paid?: boolean | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          chat_history?: Json | null
          claimed_at?: string | null
          completed_at?: string | null
          cool_with_teens?: boolean | null
          created_at?: string | null
          customer_phone?: string
          description?: string | null
          final_price?: number | null
          flexibility_minutes?: number | null
          id?: string
          lat?: number | null
          long?: number | null
          max_price?: number | null
          neighborhood?: string | null
          offered_price?: number | null
          on_the_way_at?: string | null
          paid_out?: boolean | null
          payment_intent_id?: string | null
          payment_status?: string | null
          pics?: Json | null
          platform_fee_cents?: number | null
          schedule_notified?: boolean | null
          scheduled_for?: string | null
          selected_bid_index?: number | null
          service_type?: string | null
          shoveler_phone?: string | null
          status?: string | null
          surge_multiplier?: number | null
          total_price_cents?: number | null
          weather_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_backup_plower_id_fkey"
            columns: ["backup_plower_id"]
            isOneToOne: false
            referencedRelation: "shovelers"
            referencedColumns: ["id"]
          },
        ]
      }
      la_street_sweeping: {
        Row: {
          boundaries: string | null
          council_district: string | null
          created_at: string | null
          day_of_week: string | null
          geom: unknown
          id: number
          route_no: string
          time_end: string | null
          time_start: string | null
        }
        Insert: {
          boundaries?: string | null
          council_district?: string | null
          created_at?: string | null
          day_of_week?: string | null
          geom?: unknown
          id?: number
          route_no: string
          time_end?: string | null
          time_start?: string | null
        }
        Update: {
          boundaries?: string | null
          council_district?: string | null
          created_at?: string | null
          day_of_week?: string | null
          geom?: unknown
          id?: number
          route_no?: string
          time_end?: string | null
          time_start?: string | null
        }
        Relationships: []
      }
      message_audit_log: {
        Row: {
          context_data: Json
          cost_cents: number | null
          created_at: string | null
          delivery_status: string | null
          delivery_updated_at: string | null
          error_details: Json | null
          external_message_id: string | null
          id: string
          message_channel: string
          message_key: string
          message_preview: string | null
          metadata: Json | null
          reason: string | null
          result: string
          timestamp: string
          user_email: string | null
          user_id: string | null
          user_phone: string | null
        }
        Insert: {
          context_data?: Json
          cost_cents?: number | null
          created_at?: string | null
          delivery_status?: string | null
          delivery_updated_at?: string | null
          error_details?: Json | null
          external_message_id?: string | null
          id?: string
          message_channel: string
          message_key: string
          message_preview?: string | null
          metadata?: Json | null
          reason?: string | null
          result: string
          timestamp?: string
          user_email?: string | null
          user_id?: string | null
          user_phone?: string | null
        }
        Update: {
          context_data?: Json
          cost_cents?: number | null
          created_at?: string | null
          delivery_status?: string | null
          delivery_updated_at?: string | null
          error_details?: Json | null
          external_message_id?: string | null
          id?: string
          message_channel?: string
          message_key?: string
          message_preview?: string | null
          metadata?: Json | null
          reason?: string | null
          result?: string
          timestamp?: string
          user_email?: string | null
          user_id?: string | null
          user_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_follow_up"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_one_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_users_with_addresses"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_zero_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          message_key: string | null
          metadata: Json | null
          notification_type: string
          sent_at: string | null
          user_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string | null
          id?: string
          message_key?: string | null
          metadata?: Json | null
          notification_type: string
          sent_at?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          message_key?: string | null
          metadata?: Json | null
          notification_type?: string
          sent_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      obligations: {
        Row: {
          auto_renew_enabled: boolean | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          due_date: string
          id: string
          notes: string | null
          type: string
          updated_at: string | null
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          auto_renew_enabled?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          due_date: string
          id?: string
          notes?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          auto_renew_enabled?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_permit_zones: {
        Row: {
          address_range_high: number
          address_range_low: number
          buffer: string | null
          created_at: string | null
          id: number
          odd_even: string | null
          row_id: string
          status: string
          street_direction: string | null
          street_name: string
          street_type: string | null
          updated_at: string | null
          ward_high: number | null
          ward_low: number | null
          zone: string
        }
        Insert: {
          address_range_high: number
          address_range_low: number
          buffer?: string | null
          created_at?: string | null
          id?: number
          odd_even?: string | null
          row_id: string
          status: string
          street_direction?: string | null
          street_name: string
          street_type?: string | null
          updated_at?: string | null
          ward_high?: number | null
          ward_low?: number | null
          zone: string
        }
        Update: {
          address_range_high?: number
          address_range_low?: number
          buffer?: string | null
          created_at?: string | null
          id?: number
          odd_even?: string | null
          row_id?: string
          status?: string
          street_direction?: string | null
          street_name?: string
          street_type?: string | null
          updated_at?: string | null
          ward_high?: number | null
          ward_low?: number | null
          zone?: string
        }
        Relationships: []
      }
      parking_permit_zones_sync: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: number
          last_synced_at: string
          sync_status: string
          total_records: number
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: number
          last_synced_at: string
          sync_status: string
          total_records: number
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: number
          last_synced_at?: string
          sync_status?: string
          total_records?: number
        }
        Relationships: []
      }
      payment_failure_notifications: {
        Row: {
          created_at: string | null
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          max_retries: number | null
          message: string | null
          next_retry_at: string | null
          notification_type: string
          provider: string | null
          provider_message_id: string | null
          recipient: string
          renewal_charge_id: string | null
          retry_count: number | null
          sent_at: string | null
          status: string
          subject: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          max_retries?: number | null
          message?: string | null
          next_retry_at?: string | null
          notification_type: string
          provider?: string | null
          provider_message_id?: string | null
          recipient: string
          renewal_charge_id?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          max_retries?: number | null
          message?: string | null
          next_retry_at?: string | null
          notification_type?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string
          renewal_charge_id?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_failure_notifications_renewal_charge_id_fkey"
            columns: ["renewal_charge_id"]
            isOneToOne: false
            referencedRelation: "renewal_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_requests: {
        Row: {
          admin_notes: string | null
          amount: number
          cashapp_handle: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          shoveler_phone: string
          status: string | null
          venmo_handle: string | null
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          cashapp_handle?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          shoveler_phone: string
          status?: string | null
          venmo_handle?: string | null
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          cashapp_handle?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          shoveler_phone?: string
          status?: string | null
          venmo_handle?: string | null
        }
        Relationships: []
      }
      pending_signups: {
        Row: {
          address: string | null
          city_sticker: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          license_plate: string | null
          make: string | null
          model: string | null
          phone: string | null
          token: string | null
          vin: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city_sticker?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          license_plate?: string | null
          make?: string | null
          model?: string | null
          phone?: string | null
          token?: string | null
          vin?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city_sticker?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          license_plate?: string | null
          make?: string | null
          model?: string | null
          phone?: string | null
          token?: string | null
          vin?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      permit_zone_documents: {
        Row: {
          address: string
          created_at: string | null
          customer_code: string | null
          id: number
          id_document_filename: string
          id_document_url: string
          proof_of_residency_filename: string
          proof_of_residency_url: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string | null
          user_id: string | null
          verification_status: string
        }
        Insert: {
          address: string
          created_at?: string | null
          customer_code?: string | null
          id?: number
          id_document_filename: string
          id_document_url: string
          proof_of_residency_filename: string
          proof_of_residency_url: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string
        }
        Update: {
          address?: string
          created_at?: string | null
          customer_code?: string | null
          id?: number
          id_document_filename?: string
          id_document_url?: string
          proof_of_residency_filename?: string
          proof_of_residency_url?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "permit_zone_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permit_zone_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      protection_interest_survey: {
        Row: {
          additional_features: string[] | null
          comments: string | null
          created_at: string | null
          email: string | null
          id: string
          ip_address: string | null
          most_important_feature: string | null
          referral_source: string | null
          renewal_preference: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
          willing_to_pay: string | null
        }
        Insert: {
          additional_features?: string[] | null
          comments?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          most_important_feature?: string | null
          referral_source?: string | null
          renewal_preference?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
          willing_to_pay?: string | null
        }
        Update: {
          additional_features?: string[] | null
          comments?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          most_important_feature?: string | null
          referral_source?: string | null
          renewal_preference?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
          willing_to_pay?: string | null
        }
        Relationships: []
      }
      protection_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          app_version: string | null
          created_at: string | null
          device_id: string | null
          device_name: string | null
          id: string
          is_active: boolean | null
          last_used_at: string | null
          platform: string
          token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string | null
          device_id?: string | null
          device_name?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          platform: string
          token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string | null
          device_id?: string | null
          device_name?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          platform?: string
          token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          created_at: string | null
          id: number
          identifier: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: number
          identifier: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: number
          identifier?: string
        }
        Relationships: []
      }
      referral_credits: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          job_id: string | null
          owner_id: string
          owner_type: string
          redeemed: boolean | null
          redeemed_at: string | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          job_id?: string | null
          owner_id: string
          owner_type: string
          redeemed?: boolean | null
          redeemed_at?: string | null
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          job_id?: string | null
          owner_id?: string
          owner_type?: string
          redeemed?: boolean | null
          redeemed_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_state_history: {
        Row: {
          changed_by: string
          created_at: string | null
          from_state: Database["public"]["Enums"]["registration_state"] | null
          id: string
          metadata: Json | null
          reason: string | null
          registration_id: string
          to_state: Database["public"]["Enums"]["registration_state"]
        }
        Insert: {
          changed_by: string
          created_at?: string | null
          from_state?: Database["public"]["Enums"]["registration_state"] | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          registration_id: string
          to_state: Database["public"]["Enums"]["registration_state"]
        }
        Update: {
          changed_by?: string
          created_at?: string | null
          from_state?: Database["public"]["Enums"]["registration_state"] | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          registration_id?: string
          to_state?: Database["public"]["Enums"]["registration_state"]
        }
        Relationships: []
      }
      registrations: {
        Row: {
          city_confirmation_number: string | null
          completed_at: string | null
          created_at: string | null
          drivers_license_back: string | null
          drivers_license_front: string | null
          id: string
          insurance_card: string | null
          plate: string | null
          plate_state: string | null
          state: Database["public"]["Enums"]["registration_state"]
          state_changed_at: string | null
          state_changed_by: string | null
          state_notes: string | null
          submitted_at: string | null
          title_document: string | null
          updated_at: string | null
          user_id: string
          vin: string | null
        }
        Insert: {
          city_confirmation_number?: string | null
          completed_at?: string | null
          created_at?: string | null
          drivers_license_back?: string | null
          drivers_license_front?: string | null
          id?: string
          insurance_card?: string | null
          plate?: string | null
          plate_state?: string | null
          state?: Database["public"]["Enums"]["registration_state"]
          state_changed_at?: string | null
          state_changed_by?: string | null
          state_notes?: string | null
          submitted_at?: string | null
          title_document?: string | null
          updated_at?: string | null
          user_id: string
          vin?: string | null
        }
        Update: {
          city_confirmation_number?: string | null
          completed_at?: string | null
          created_at?: string | null
          drivers_license_back?: string | null
          drivers_license_front?: string | null
          id?: string
          insurance_card?: string | null
          plate?: string | null
          plate_state?: string | null
          state?: Database["public"]["Enums"]["registration_state"]
          state_changed_at?: string | null
          state_changed_by?: string | null
          state_notes?: string | null
          submitted_at?: string | null
          title_document?: string | null
          updated_at?: string | null
          user_id?: string
          vin?: string | null
        }
        Relationships: []
      }
      reimbursement_requests: {
        Row: {
          admin_notes: string | null
          back_photo_url: string
          created_at: string | null
          email: string
          first_name: string | null
          front_photo_url: string
          id: string
          last_name: string | null
          license_plate: string
          payment_details: string | null
          payment_method: string | null
          processed_at: string | null
          processed_by: string | null
          reimbursement_amount: number | null
          status: string | null
          ticket_amount: number
          ticket_date: string
          ticket_description: string | null
          ticket_number: string | null
          ticket_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          back_photo_url: string
          created_at?: string | null
          email: string
          first_name?: string | null
          front_photo_url: string
          id?: string
          last_name?: string | null
          license_plate: string
          payment_details?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reimbursement_amount?: number | null
          status?: string | null
          ticket_amount: number
          ticket_date: string
          ticket_description?: string | null
          ticket_number?: string | null
          ticket_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          back_photo_url?: string
          created_at?: string | null
          email?: string
          first_name?: string | null
          front_photo_url?: string
          id?: string
          last_name?: string | null
          license_plate?: string
          payment_details?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reimbursement_amount?: number | null
          status?: string | null
          ticket_amount?: number
          ticket_date?: string
          ticket_description?: string | null
          ticket_number?: string | null
          ticket_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          days_until_due: number
          error_message: string | null
          id: string
          method: string
          obligation_id: string | null
          sent_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          days_until_due: number
          error_message?: string | null
          id?: string
          method: string
          obligation_id?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          days_until_due?: number
          error_message?: string | null
          id?: string
          method?: string
          obligation_id?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "overdue_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "upcoming_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_charges: {
        Row: {
          amount: number
          charge_email_sent: boolean | null
          charge_email_sent_at: string | null
          charge_type: string
          charged_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          last_retry_at: string | null
          license_plate: string | null
          notes: string | null
          notification_sent: boolean | null
          notification_sent_at: string | null
          remitted_at: string | null
          remitter_confirmation_number: string | null
          remitter_status: string | null
          renewal_deadline: string
          renewal_due_date: string | null
          renewal_type: string | null
          retry_count: number | null
          status: string
          stripe_charge_id: string | null
          stripe_fee: number | null
          stripe_payment_intent_id: string | null
          total_charged: number
          updated_at: string | null
          user_id: string
          vehicle_type: string | null
        }
        Insert: {
          amount: number
          charge_email_sent?: boolean | null
          charge_email_sent_at?: string | null
          charge_type: string
          charged_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          license_plate?: string | null
          notes?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          remitted_at?: string | null
          remitter_confirmation_number?: string | null
          remitter_status?: string | null
          renewal_deadline: string
          renewal_due_date?: string | null
          renewal_type?: string | null
          retry_count?: number | null
          status?: string
          stripe_charge_id?: string | null
          stripe_fee?: number | null
          stripe_payment_intent_id?: string | null
          total_charged: number
          updated_at?: string | null
          user_id: string
          vehicle_type?: string | null
        }
        Update: {
          amount?: number
          charge_email_sent?: boolean | null
          charge_email_sent_at?: string | null
          charge_type?: string
          charged_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          license_plate?: string | null
          notes?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          remitted_at?: string | null
          remitter_confirmation_number?: string | null
          remitter_status?: string | null
          renewal_deadline?: string
          renewal_due_date?: string | null
          renewal_type?: string | null
          retry_count?: number | null
          status?: string
          stripe_charge_id?: string | null
          stripe_fee?: number | null
          stripe_payment_intent_id?: string | null
          total_charged?: number
          updated_at?: string | null
          user_id?: string
          vehicle_type?: string | null
        }
        Relationships: []
      }
      renewal_document_reviews: {
        Row: {
          auto_verification_confidence: number | null
          auto_verified: boolean | null
          created_at: string | null
          document_type: string
          document_url: string
          extracted_data: Json | null
          id: string
          order_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
        }
        Insert: {
          auto_verification_confidence?: number | null
          auto_verified?: boolean | null
          created_at?: string | null
          document_type: string
          document_url: string
          extracted_data?: Json | null
          id?: string
          order_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Update: {
          auto_verification_confidence?: number | null
          auto_verified?: boolean | null
          created_at?: string | null
          document_type?: string
          document_url?: string
          extracted_data?: Json | null
          id?: string
          order_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renewal_document_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "renewal_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_order_activity_log: {
        Row: {
          activity_type: string
          created_at: string | null
          description: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          order_id: string
          performed_by: string | null
          performed_by_type: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          description: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          order_id: string
          performed_by?: string | null
          performed_by_type?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          description?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          order_id?: string
          performed_by?: string | null
          performed_by_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renewal_order_activity_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "renewal_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_orders: {
        Row: {
          city: string
          city_confirmation_number: string | null
          completed_at: string | null
          created_at: string | null
          customer_email: string
          customer_name: string
          customer_notes: string | null
          customer_phone: string
          delivered_at: string | null
          documents: Json | null
          fulfillment_method: string | null
          id: string
          internal_notes: string | null
          license_plate: string
          license_state: string
          make: string | null
          model: string | null
          needs_manual_followup: boolean | null
          notifications_sent: Json | null
          order_number: string
          paid_at: string | null
          partner_id: string
          payment_status: string | null
          permit_fee: number | null
          permit_requested: boolean | null
          pickup_location: string | null
          portal_confirmation_number: string | null
          portal_error: string | null
          processing_started_at: string | null
          pushed_to_portal: boolean | null
          pushed_to_portal_at: string | null
          remitter_notes: string | null
          renewal_due_date: string | null
          service_fee: number | null
          shipped_at: string | null
          state: string
          status: string | null
          sticker_applied: boolean | null
          sticker_applied_at: string | null
          sticker_expires_at: string | null
          sticker_issued_at: string | null
          sticker_number: string | null
          sticker_price: number
          sticker_reminder_count: number | null
          sticker_reminder_date: string | null
          sticker_type: string
          street_address: string
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          submitted_at: string | null
          total_amount: number
          tracking_number: string | null
          updated_at: string | null
          vin: string | null
          ward: number | null
          year: number | null
          zip_code: string
        }
        Insert: {
          city: string
          city_confirmation_number?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email: string
          customer_name: string
          customer_notes?: string | null
          customer_phone: string
          delivered_at?: string | null
          documents?: Json | null
          fulfillment_method?: string | null
          id?: string
          internal_notes?: string | null
          license_plate: string
          license_state?: string
          make?: string | null
          model?: string | null
          needs_manual_followup?: boolean | null
          notifications_sent?: Json | null
          order_number: string
          paid_at?: string | null
          partner_id: string
          payment_status?: string | null
          permit_fee?: number | null
          permit_requested?: boolean | null
          pickup_location?: string | null
          portal_confirmation_number?: string | null
          portal_error?: string | null
          processing_started_at?: string | null
          pushed_to_portal?: boolean | null
          pushed_to_portal_at?: string | null
          remitter_notes?: string | null
          renewal_due_date?: string | null
          service_fee?: number | null
          shipped_at?: string | null
          state?: string
          status?: string | null
          sticker_applied?: boolean | null
          sticker_applied_at?: string | null
          sticker_expires_at?: string | null
          sticker_issued_at?: string | null
          sticker_number?: string | null
          sticker_price: number
          sticker_reminder_count?: number | null
          sticker_reminder_date?: string | null
          sticker_type: string
          street_address: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          submitted_at?: string | null
          total_amount: number
          tracking_number?: string | null
          updated_at?: string | null
          vin?: string | null
          ward?: number | null
          year?: number | null
          zip_code: string
        }
        Update: {
          city?: string
          city_confirmation_number?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email?: string
          customer_name?: string
          customer_notes?: string | null
          customer_phone?: string
          delivered_at?: string | null
          documents?: Json | null
          fulfillment_method?: string | null
          id?: string
          internal_notes?: string | null
          license_plate?: string
          license_state?: string
          make?: string | null
          model?: string | null
          needs_manual_followup?: boolean | null
          notifications_sent?: Json | null
          order_number?: string
          paid_at?: string | null
          partner_id?: string
          payment_status?: string | null
          permit_fee?: number | null
          permit_requested?: boolean | null
          pickup_location?: string | null
          portal_confirmation_number?: string | null
          portal_error?: string | null
          processing_started_at?: string | null
          pushed_to_portal?: boolean | null
          pushed_to_portal_at?: string | null
          remitter_notes?: string | null
          renewal_due_date?: string | null
          service_fee?: number | null
          shipped_at?: string | null
          state?: string
          status?: string | null
          sticker_applied?: boolean | null
          sticker_applied_at?: string | null
          sticker_expires_at?: string | null
          sticker_issued_at?: string | null
          sticker_number?: string | null
          sticker_price?: number
          sticker_reminder_count?: number | null
          sticker_reminder_date?: string | null
          sticker_type?: string
          street_address?: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          submitted_at?: string | null
          total_amount?: number
          tracking_number?: string | null
          updated_at?: string | null
          vin?: string | null
          ward?: number | null
          year?: number | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "renewal_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_partner_stats: {
        Row: {
          completed_today_count: number | null
          last_updated: string | null
          orders_this_month: number | null
          orders_this_week: number | null
          orders_today: number | null
          partner_id: string
          pending_review_count: number | null
          ready_for_pickup_count: number | null
          revenue_this_month: number | null
          revenue_this_week: number | null
          revenue_today: number | null
          total_orders: number | null
          total_revenue: number | null
        }
        Insert: {
          completed_today_count?: number | null
          last_updated?: string | null
          orders_this_month?: number | null
          orders_this_week?: number | null
          orders_today?: number | null
          partner_id: string
          pending_review_count?: number | null
          ready_for_pickup_count?: number | null
          revenue_this_month?: number | null
          revenue_this_week?: number | null
          revenue_today?: number | null
          total_orders?: number | null
          total_revenue?: number | null
        }
        Update: {
          completed_today_count?: number | null
          last_updated?: string | null
          orders_this_month?: number | null
          orders_this_week?: number | null
          orders_today?: number | null
          partner_id?: string
          pending_review_count?: number | null
          ready_for_pickup_count?: number | null
          revenue_this_month?: number | null
          revenue_this_week?: number | null
          revenue_today?: number | null
          total_orders?: number | null
          total_revenue?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "renewal_partner_stats_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "renewal_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_partners: {
        Row: {
          allow_digital_intake: boolean | null
          allow_walk_in: boolean | null
          api_key: string | null
          auto_forward_payments: boolean | null
          business_address: string | null
          business_type: string
          commission_percentage: number | null
          created_at: string | null
          ein: string | null
          email: string
          id: string
          license_number: string | null
          name: string
          notification_email: string | null
          notify_daily_digest: boolean | null
          notify_instant_alerts: boolean | null
          onboarding_completed: boolean | null
          payout_enabled: boolean | null
          phone: string | null
          portal_credentials_encrypted: string | null
          portal_integration_type: string | null
          require_appointment: boolean | null
          service_fee_amount: number | null
          status: string | null
          stripe_account_status: string | null
          stripe_connected_account_id: string | null
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          allow_digital_intake?: boolean | null
          allow_walk_in?: boolean | null
          api_key?: string | null
          auto_forward_payments?: boolean | null
          business_address?: string | null
          business_type: string
          commission_percentage?: number | null
          created_at?: string | null
          ein?: string | null
          email: string
          id?: string
          license_number?: string | null
          name: string
          notification_email?: string | null
          notify_daily_digest?: boolean | null
          notify_instant_alerts?: boolean | null
          onboarding_completed?: boolean | null
          payout_enabled?: boolean | null
          phone?: string | null
          portal_credentials_encrypted?: string | null
          portal_integration_type?: string | null
          require_appointment?: boolean | null
          service_fee_amount?: number | null
          status?: string | null
          stripe_account_status?: string | null
          stripe_connected_account_id?: string | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          allow_digital_intake?: boolean | null
          allow_walk_in?: boolean | null
          api_key?: string | null
          auto_forward_payments?: boolean | null
          business_address?: string | null
          business_type?: string
          commission_percentage?: number | null
          created_at?: string | null
          ein?: string | null
          email?: string
          id?: string
          license_number?: string | null
          name?: string
          notification_email?: string | null
          notify_daily_digest?: boolean | null
          notify_instant_alerts?: boolean | null
          onboarding_completed?: boolean | null
          payout_enabled?: boolean | null
          phone?: string | null
          portal_credentials_encrypted?: string | null
          portal_integration_type?: string | null
          require_appointment?: boolean | null
          service_fee_amount?: number | null
          status?: string | null
          stripe_account_status?: string | null
          stripe_connected_account_id?: string | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          created_at: string | null
          customer_phone: string
          id: string
          job_id: string
          rating: number
          shoveler_phone: string
          tip_amount: number | null
        }
        Insert: {
          created_at?: string | null
          customer_phone: string
          id?: string
          job_id: string
          rating: number
          shoveler_phone: string
          tip_amount?: number | null
        }
        Update: {
          created_at?: string | null
          customer_phone?: string
          id?: string
          job_id?: string
          rating?: number
          shoveler_phone?: string
          tip_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sd_street_sweeping: {
        Row: {
          cdcode: string | null
          cpcode: string | null
          created_at: string | null
          id: number
          lhighaddr: string | null
          llowaddr: string | null
          objectid: number | null
          posted: string | null
          rd20full: string | null
          rhighaddr: string | null
          rlowaddr: string | null
          sapid: string | null
          schedule: string | null
          schedule2: string | null
          segment_lat: number | null
          segment_lng: number | null
          updated_at: string | null
          xstrt1: string | null
          xstrt2: string | null
          zip: string | null
        }
        Insert: {
          cdcode?: string | null
          cpcode?: string | null
          created_at?: string | null
          id?: number
          lhighaddr?: string | null
          llowaddr?: string | null
          objectid?: number | null
          posted?: string | null
          rd20full?: string | null
          rhighaddr?: string | null
          rlowaddr?: string | null
          sapid?: string | null
          schedule?: string | null
          schedule2?: string | null
          segment_lat?: number | null
          segment_lng?: number | null
          updated_at?: string | null
          xstrt1?: string | null
          xstrt2?: string | null
          zip?: string | null
        }
        Update: {
          cdcode?: string | null
          cpcode?: string | null
          created_at?: string | null
          id?: number
          lhighaddr?: string | null
          llowaddr?: string | null
          objectid?: number | null
          posted?: string | null
          rd20full?: string | null
          rhighaddr?: string | null
          rlowaddr?: string | null
          sapid?: string | null
          schedule?: string | null
          schedule2?: string | null
          segment_lat?: number | null
          segment_lng?: number | null
          updated_at?: string | null
          xstrt1?: string | null
          xstrt2?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      sf_street_sweeping: {
        Row: {
          block_side: string | null
          block_sweep_id: string | null
          cnn: string
          cnn_right_left: string | null
          corridor: string
          created_at: string | null
          from_hour: number
          full_name: string | null
          geom: unknown
          holidays: number
          id: number
          limits: string | null
          to_hour: number
          updated_at: string | null
          week_day: string
          week1: number
          week2: number
          week3: number
          week4: number
          week5: number
        }
        Insert: {
          block_side?: string | null
          block_sweep_id?: string | null
          cnn: string
          cnn_right_left?: string | null
          corridor: string
          created_at?: string | null
          from_hour: number
          full_name?: string | null
          geom?: unknown
          holidays?: number
          id?: number
          limits?: string | null
          to_hour: number
          updated_at?: string | null
          week_day: string
          week1?: number
          week2?: number
          week3?: number
          week4?: number
          week5?: number
        }
        Update: {
          block_side?: string | null
          block_sweep_id?: string | null
          cnn?: string
          cnn_right_left?: string | null
          corridor?: string
          created_at?: string | null
          from_hour?: number
          full_name?: string | null
          geom?: unknown
          holidays?: number
          id?: number
          limits?: string | null
          to_hour?: number
          updated_at?: string | null
          week_day?: string
          week1?: number
          week2?: number
          week3?: number
          week4?: number
          week5?: number
        }
        Relationships: []
      }
      shovelers: {
        Row: {
          active: boolean | null
          availability: Json | null
          avg_rating: number | null
          cashapp_handle: string | null
          created_at: string | null
          has_truck: boolean | null
          id: string
          id_document_url: string | null
          is_online: boolean | null
          is_verified: boolean | null
          jobs_cancelled_by_plower: number | null
          jobs_claimed: number | null
          jobs_completed: number | null
          last_seen_at: string | null
          lat: number | null
          long: number | null
          name: string | null
          neighborhood: string | null
          no_show_strikes: number | null
          phone: string
          profile_pic_url: string | null
          rate: number | null
          referral_code: string | null
          referred_by_id: string | null
          show_on_leaderboard: boolean | null
          skills: string[] | null
          sms_notify_threshold: number | null
          stripe_connect_account_id: string | null
          stripe_connect_onboarded: boolean | null
          tagline: string | null
          total_reviews: number | null
          total_tips: number | null
          venmo_handle: string | null
          verified: boolean | null
        }
        Insert: {
          active?: boolean | null
          availability?: Json | null
          avg_rating?: number | null
          cashapp_handle?: string | null
          created_at?: string | null
          has_truck?: boolean | null
          id?: string
          id_document_url?: string | null
          is_online?: boolean | null
          is_verified?: boolean | null
          jobs_cancelled_by_plower?: number | null
          jobs_claimed?: number | null
          jobs_completed?: number | null
          last_seen_at?: string | null
          lat?: number | null
          long?: number | null
          name?: string | null
          neighborhood?: string | null
          no_show_strikes?: number | null
          phone: string
          profile_pic_url?: string | null
          rate?: number | null
          referral_code?: string | null
          referred_by_id?: string | null
          show_on_leaderboard?: boolean | null
          skills?: string[] | null
          sms_notify_threshold?: number | null
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded?: boolean | null
          tagline?: string | null
          total_reviews?: number | null
          total_tips?: number | null
          venmo_handle?: string | null
          verified?: boolean | null
        }
        Update: {
          active?: boolean | null
          availability?: Json | null
          avg_rating?: number | null
          cashapp_handle?: string | null
          created_at?: string | null
          has_truck?: boolean | null
          id?: string
          id_document_url?: string | null
          is_online?: boolean | null
          is_verified?: boolean | null
          jobs_cancelled_by_plower?: number | null
          jobs_claimed?: number | null
          jobs_completed?: number | null
          last_seen_at?: string | null
          lat?: number | null
          long?: number | null
          name?: string | null
          neighborhood?: string | null
          no_show_strikes?: number | null
          phone?: string
          profile_pic_url?: string | null
          rate?: number | null
          referral_code?: string | null
          referred_by_id?: string | null
          show_on_leaderboard?: boolean | null
          skills?: string[] | null
          sms_notify_threshold?: number | null
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded?: boolean | null
          tagline?: string | null
          total_reviews?: number | null
          total_tips?: number | null
          venmo_handle?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "shovelers_referred_by_id_fkey"
            columns: ["referred_by_id"]
            isOneToOne: false
            referencedRelation: "shovelers"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_tokens: {
        Row: {
          created_at: string | null
          data: Json
          expires_at: string
          id: string
          token: string
          used: boolean | null
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          data: Json
          expires_at: string
          id?: string
          token: string
          used?: boolean | null
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json
          expires_at?: string
          id?: string
          token?: string
          used?: boolean | null
          used_at?: string | null
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          cleaning_date: string | null
          cost: number | null
          days_before: number | null
          delivered_at: string | null
          error_message: string | null
          id: string
          message: string
          message_type: string | null
          metadata: Json | null
          phone_number: string
          provider: string | null
          section: string | null
          sent_at: string | null
          status: string | null
          user_id: string | null
          ward: string | null
        }
        Insert: {
          cleaning_date?: string | null
          cost?: number | null
          days_before?: number | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          message: string
          message_type?: string | null
          metadata?: Json | null
          phone_number: string
          provider?: string | null
          section?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
          ward?: string | null
        }
        Update: {
          cleaning_date?: string | null
          cost?: number | null
          days_before?: number | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          message?: string
          message_type?: string | null
          metadata?: Json | null
          phone_number?: string
          provider?: string | null
          section?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      snow_events: {
        Row: {
          ban_triggered_at: string | null
          created_at: string | null
          detected_at: string | null
          event_date: string
          forecast_sent: boolean | null
          forecast_sent_at: string | null
          forecast_source: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          snow_amount_inches: number | null
          two_inch_ban_triggered: boolean | null
          updated_at: string | null
        }
        Insert: {
          ban_triggered_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          event_date: string
          forecast_sent?: boolean | null
          forecast_sent_at?: string | null
          forecast_source?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          snow_amount_inches?: number | null
          two_inch_ban_triggered?: boolean | null
          updated_at?: string | null
        }
        Update: {
          ban_triggered_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          event_date?: string
          forecast_sent?: boolean | null
          forecast_sent_at?: string | null
          forecast_source?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          snow_amount_inches?: number | null
          two_inch_ban_triggered?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      snow_route_status: {
        Row: {
          activation_date: string | null
          created_at: string | null
          deactivation_date: string | null
          id: number
          is_active: boolean | null
          notes: string | null
          snow_amount_inches: number | null
          updated_at: string | null
        }
        Insert: {
          activation_date?: string | null
          created_at?: string | null
          deactivation_date?: string | null
          id?: number
          is_active?: boolean | null
          notes?: string | null
          snow_amount_inches?: number | null
          updated_at?: string | null
        }
        Update: {
          activation_date?: string | null
          created_at?: string | null
          deactivation_date?: string | null
          id?: number
          is_active?: boolean | null
          notes?: string | null
          snow_amount_inches?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      snow_routes: {
        Row: {
          created_at: string | null
          from_street: string | null
          geom: unknown
          id: number
          object_id: number | null
          on_street: string
          restrict_type: string | null
          shape_length: number | null
          to_street: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          from_street?: string | null
          geom?: unknown
          id?: number
          object_id?: number | null
          on_street: string
          restrict_type?: string | null
          shape_length?: number | null
          to_street?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          from_street?: string | null
          geom?: unknown
          id?: number
          object_id?: number | null
          on_street?: string
          restrict_type?: string | null
          shape_length?: number | null
          to_street?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      sticker_notifications: {
        Row: {
          created_at: string | null
          id: string
          license_plate: string | null
          sent_at: string | null
          sent_by: string | null
          sticker_type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          license_plate?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sticker_type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          license_plate?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sticker_type?: string
          user_id?: string
        }
        Relationships: []
      }
      storm_alerts: {
        Row: {
          active: boolean | null
          created_at: string | null
          expires_at: string | null
          id: string
          notified_count: number | null
          snow_inches: number
          surge_multiplier: number | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          notified_count?: number | null
          snow_inches: number
          surge_multiplier?: number | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          notified_count?: number | null
          snow_inches?: number
          surge_multiplier?: number | null
        }
        Relationships: []
      }
      storm_events: {
        Row: {
          created_at: string | null
          end_time: string
          forecast_inches: number
          id: string
          is_active: boolean | null
          notified_plowers: boolean | null
          start_time: string
          surge_multiplier: number | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          forecast_inches: number
          id?: string
          is_active?: boolean | null
          notified_plowers?: boolean | null
          start_time: string
          surge_multiplier?: number | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          forecast_inches?: number
          id?: string
          is_active?: boolean | null
          notified_plowers?: boolean | null
          start_time?: string
          surge_multiplier?: number | null
        }
        Relationships: []
      }
      street_cleaning_schedule: {
        Row: {
          cleaning_date: string | null
          created_at: string | null
          east_block: string | null
          east_block_number: string | null
          east_direction: string | null
          east_street: string | null
          geom: unknown
          geom_simplified: unknown
          id: string
          north_block: string | null
          north_block_number: string | null
          north_direction: string | null
          north_street: string | null
          section: string | null
          side: string | null
          south_block: string | null
          south_block_number: string | null
          south_direction: string | null
          south_street: string | null
          street_name: string | null
          ward: string | null
          ward_section: string | null
          west_block: string | null
          west_block_number: string | null
          west_direction: string | null
          west_street: string | null
        }
        Insert: {
          cleaning_date?: string | null
          created_at?: string | null
          east_block?: string | null
          east_block_number?: string | null
          east_direction?: string | null
          east_street?: string | null
          geom?: unknown
          geom_simplified?: unknown
          id?: string
          north_block?: string | null
          north_block_number?: string | null
          north_direction?: string | null
          north_street?: string | null
          section?: string | null
          side?: string | null
          south_block?: string | null
          south_block_number?: string | null
          south_direction?: string | null
          south_street?: string | null
          street_name?: string | null
          ward?: string | null
          ward_section?: string | null
          west_block?: string | null
          west_block_number?: string | null
          west_direction?: string | null
          west_street?: string | null
        }
        Update: {
          cleaning_date?: string | null
          created_at?: string | null
          east_block?: string | null
          east_block_number?: string | null
          east_direction?: string | null
          east_street?: string | null
          geom?: unknown
          geom_simplified?: unknown
          id?: string
          north_block?: string | null
          north_block_number?: string | null
          north_direction?: string | null
          north_street?: string | null
          section?: string | null
          side?: string | null
          south_block?: string | null
          south_block_number?: string | null
          south_direction?: string | null
          south_street?: string | null
          street_name?: string | null
          ward?: string | null
          ward_section?: string | null
          west_block?: string | null
          west_block_number?: string | null
          west_direction?: string | null
          west_street?: string | null
        }
        Relationships: []
      }
      ticket_contests: {
        Row: {
          admin_notes: string | null
          attorney_requested: boolean | null
          contest_grounds: string[] | null
          contest_letter: string | null
          created_at: string | null
          evidence_checklist: Json | null
          evidence_completeness: Json | null
          evidence_photos: Json | null
          evidence_quality_score: number | null
          extracted_data: Json | null
          filing_method: string | null
          id: string
          license_plate: string | null
          status: string | null
          submitted_at: string | null
          supporting_documents: Json | null
          ticket_amount: number | null
          ticket_date: string | null
          ticket_location: string | null
          ticket_number: string | null
          ticket_photo_url: string
          updated_at: string | null
          user_id: string
          violation_code: string | null
          violation_description: string | null
          witness_statements: string | null
        }
        Insert: {
          admin_notes?: string | null
          attorney_requested?: boolean | null
          contest_grounds?: string[] | null
          contest_letter?: string | null
          created_at?: string | null
          evidence_checklist?: Json | null
          evidence_completeness?: Json | null
          evidence_photos?: Json | null
          evidence_quality_score?: number | null
          extracted_data?: Json | null
          filing_method?: string | null
          id?: string
          license_plate?: string | null
          status?: string | null
          submitted_at?: string | null
          supporting_documents?: Json | null
          ticket_amount?: number | null
          ticket_date?: string | null
          ticket_location?: string | null
          ticket_number?: string | null
          ticket_photo_url: string
          updated_at?: string | null
          user_id: string
          violation_code?: string | null
          violation_description?: string | null
          witness_statements?: string | null
        }
        Update: {
          admin_notes?: string | null
          attorney_requested?: boolean | null
          contest_grounds?: string[] | null
          contest_letter?: string | null
          created_at?: string | null
          evidence_checklist?: Json | null
          evidence_completeness?: Json | null
          evidence_photos?: Json | null
          evidence_quality_score?: number | null
          extracted_data?: Json | null
          filing_method?: string | null
          id?: string
          license_plate?: string | null
          status?: string | null
          submitted_at?: string | null
          supporting_documents?: Json | null
          ticket_amount?: number | null
          ticket_date?: string | null
          ticket_location?: string | null
          ticket_number?: string | null
          ticket_photo_url?: string
          updated_at?: string | null
          user_id?: string
          violation_code?: string | null
          violation_description?: string | null
          witness_statements?: string | null
        }
        Relationships: []
      }
      towed_vehicles: {
        Row: {
          color: string | null
          created_at: string | null
          id: number
          inventory_number: string | null
          make: string | null
          notified_users: string[] | null
          plate: string
          state: string | null
          style: string | null
          tow_date: string
          tow_facility_phone: string | null
          towed_to_address: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: number
          inventory_number?: string | null
          make?: string | null
          notified_users?: string[] | null
          plate: string
          state?: string | null
          style?: string | null
          tow_date: string
          tow_facility_phone?: string | null
          towed_to_address?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: number
          inventory_number?: string | null
          make?: string | null
          notified_users?: string[] | null
          plate?: string
          state?: string | null
          style?: string | null
          tow_date?: string
          tow_facility_phone?: string | null
          towed_to_address?: string | null
        }
        Relationships: []
      }
      user_addresses: {
        Row: {
          created_at: string | null
          full_address: string
          id: string
          is_primary: boolean | null
          label: string | null
          notify_days_array: number[] | null
          section: string
          snooze_created_at: string | null
          snooze_reason: string | null
          snooze_until_date: string | null
          updated_at: string | null
          user_id: string | null
          ward: string
        }
        Insert: {
          created_at?: string | null
          full_address: string
          id?: string
          is_primary?: boolean | null
          label?: string | null
          notify_days_array?: number[] | null
          section: string
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          updated_at?: string | null
          user_id?: string | null
          ward: string
        }
        Update: {
          created_at?: string | null
          full_address?: string
          id?: string
          is_primary?: boolean | null
          label?: string | null
          notify_days_array?: number[] | null
          section?: string
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          updated_at?: string | null
          user_id?: string | null
          ward?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          consent_granted: boolean
          consent_text: string
          consent_type: string
          created_at: string | null
          id: number
          ip_address: string | null
          metadata: Json | null
          stripe_session_id: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          consent_granted?: boolean
          consent_text: string
          consent_type: string
          created_at?: string | null
          id?: number
          ip_address?: string | null
          metadata?: Json | null
          stripe_session_id?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          consent_granted?: boolean
          consent_text?: string
          consent_type?: string
          created_at?: string | null
          id?: number
          ip_address?: string | null
          metadata?: Json | null
          stripe_session_id?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          channels: string[] | null
          cleaning_date: string | null
          created_at: string | null
          days_before: number | null
          error_message: string | null
          id: string
          metadata: Json | null
          notification_type: string
          section: string | null
          sent_at: string | null
          status: string | null
          user_id: string | null
          ward: string | null
        }
        Insert: {
          channels?: string[] | null
          cleaning_date?: string | null
          created_at?: string | null
          days_before?: number | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          notification_type: string
          section?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
          ward?: string | null
        }
        Update: {
          channels?: string[] | null
          cleaning_date?: string | null
          created_at?: string | null
          days_before?: number | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          notification_type?: string
          section?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_passkeys: {
        Row: {
          counter: number
          created_at: string | null
          credential_id: string
          id: string
          last_used: string | null
          name: string | null
          public_key: string
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string | null
          credential_id: string
          id?: string
          last_used?: string | null
          name?: string | null
          public_key: string
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string | null
          credential_id?: string
          id?: string
          last_used?: string | null
          name?: string | null
          public_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          affiliate_id: string | null
          affiliate_signup_date: string | null
          city: string | null
          city_sticker_expiry: string | null
          city_sticker_purchase_confirmed_at: string | null
          city_stickers_only: boolean | null
          concierge_service: boolean | null
          consent_ip_address: string | null
          consent_protection_purchase: string | null
          created_at: string | null
          drivers_license_url: string | null
          email: string | null
          email_forwarding_address: string | null
          email_verified: boolean | null
          emissions_completed: boolean | null
          emissions_completed_at: string | null
          emissions_date: string | null
          emissions_test_year: number | null
          first_name: string | null
          foia_data_emails: Json | null
          foia_emails_added_at: string | null
          foia_emails_updated_at: string | null
          follow_up_sms: boolean | null
          guarantee_opt_in_year: number | null
          has_permit_zone: boolean | null
          has_protection: boolean
          has_contesting: boolean
          has_vanity_plate: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          is_canary: boolean | null
          is_paid: boolean | null
          last_name: string | null
          license_back_last_accessed_at: string | null
          license_image_back_uploaded_at: string | null
          license_image_back_verified: boolean | null
          license_image_path: string | null
          license_image_path_back: string | null
          license_image_uploaded_at: string | null
          license_image_verification_notes: string | null
          license_image_verified: boolean | null
          license_image_verified_at: string | null
          license_image_verified_by: string | null
          license_last_accessed_at: string | null
          license_plate: string | null
          license_plate_expiry: string | null
          license_plate_is_personalized: boolean | null
          license_plate_is_vanity: boolean | null
          license_plate_last_accessed_at: string | null
          license_plate_renewal_cost: number | null
          license_plate_street_cleaning: string | null
          license_plate_type: string | null
          license_reuse_consent_given: boolean | null
          license_reuse_consent_given_at: string | null
          license_state: string | null
          license_valid_until: string | null
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          marketing_consent: boolean | null
          notification_preferences: Json | null
          notify_days_array: number[] | null
          notify_days_before: number | null
          notify_email: boolean | null
          notify_evening_before: boolean | null
          notify_sms: boolean | null
          notify_snow: boolean | null
          notify_snow_ban: boolean | null
          notify_snow_confirmation: boolean | null
          notify_snow_confirmation_email: boolean | null
          notify_snow_confirmation_sms: boolean | null
          notify_snow_forecast: boolean | null
          notify_snow_forecast_email: boolean | null
          notify_snow_forecast_sms: boolean | null
          notify_winter_ban: boolean | null
          notify_winter_parking: boolean | null
          on_snow_route: boolean | null
          payment_authorized_at: string | null
          permit_application_status: string | null
          permit_expiry_date: string | null
          permit_requested: boolean | null
          permit_zone_number: string | null
          phone: string | null
          phone_call_days_before: number[] | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_number: string | null
          phone_verified: boolean | null
          profile_confirmed_at: string | null
          profile_confirmed_for_year: number | null
          proof_of_residency_url: string | null
          property_tax_fetch_failed: boolean | null
          property_tax_fetch_notes: string | null
          property_tax_last_fetched_at: string | null
          property_tax_needs_refresh: boolean | null
          push_subscription: Json | null
          referral_pro_earned: boolean | null
          reminder_days: number[] | null
          renewal_notification_days: number | null
          renewal_status: string | null
          residency_forwarding_consent_given: boolean | null
          residency_forwarding_consent_given_at: string | null
          residency_forwarding_enabled: boolean | null
          residency_proof_path: string | null
          residency_proof_type: string | null
          residency_proof_uploaded_at: string | null
          residency_proof_verified: boolean | null
          residency_proof_verified_at: string | null
          role: string | null
          rv_weight: number | null
          sms_gateway: string | null
          sms_opt_out_method: string | null
          sms_opt_out_voids_guarantee: boolean | null
          sms_opted_out_at: string | null
          sms_pro: boolean | null
          sms_pro_expires_at: string | null
          sms_trial_ends: string | null
          sms_trial_expires_at: string | null
          sms_trial_first_sent: boolean | null
          snooze_created_at: string | null
          snooze_reason: string | null
          snooze_until_date: string | null
          snow_route_street: string | null
          spending_limit: number | null
          sticker_expected_delivery: string | null
          sticker_purchased_at: string | null
          street_address: string | null
          street_side: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          subscription_canceled_at: string | null
          subscription_started_at: string | null
          subscription_status: string | null
          third_party_processing_consent: boolean | null
          third_party_processing_consent_at: string | null
          timezone: string | null
          trailer_weight: number | null
          updated_at: string | null
          user_id: string
          utilityapi_authorization_uid: string | null
          utilityapi_connected: boolean | null
          utilityapi_connected_at: string | null
          utilityapi_form_uid: string | null
          utilityapi_latest_bill_date: string | null
          utilityapi_latest_bill_pdf_url: string | null
          utilityapi_latest_bill_uid: string | null
          utilityapi_utility: string | null
          vehicle_type: string | null
          vehicle_year: number | null
          vehicle_zone: string | null
          vin: string | null
          voice_call_days_before: number[] | null
          voice_call_time: string | null
          voice_calls_enabled: boolean | null
          voice_preference: string | null
          zip_code: string | null
        }
        Insert: {
          affiliate_id?: string | null
          affiliate_signup_date?: string | null
          city?: string | null
          city_sticker_expiry?: string | null
          city_sticker_purchase_confirmed_at?: string | null
          city_stickers_only?: boolean | null
          concierge_service?: boolean | null
          consent_ip_address?: string | null
          consent_protection_purchase?: string | null
          created_at?: string | null
          drivers_license_url?: string | null
          email?: string | null
          email_forwarding_address?: string | null
          email_verified?: boolean | null
          emissions_completed?: boolean | null
          emissions_completed_at?: string | null
          emissions_date?: string | null
          emissions_test_year?: number | null
          first_name?: string | null
          foia_data_emails?: Json | null
          foia_emails_added_at?: string | null
          foia_emails_updated_at?: string | null
          follow_up_sms?: boolean | null
          guarantee_opt_in_year?: number | null
          has_permit_zone?: boolean | null
          has_protection?: boolean
          has_contesting?: boolean
          has_vanity_plate?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          is_canary?: boolean | null
          is_paid?: boolean | null
          last_name?: string | null
          license_back_last_accessed_at?: string | null
          license_image_back_uploaded_at?: string | null
          license_image_back_verified?: boolean | null
          license_image_path?: string | null
          license_image_path_back?: string | null
          license_image_uploaded_at?: string | null
          license_image_verification_notes?: string | null
          license_image_verified?: boolean | null
          license_image_verified_at?: string | null
          license_image_verified_by?: string | null
          license_last_accessed_at?: string | null
          license_plate?: string | null
          license_plate_expiry?: string | null
          license_plate_is_personalized?: boolean | null
          license_plate_is_vanity?: boolean | null
          license_plate_last_accessed_at?: string | null
          license_plate_renewal_cost?: number | null
          license_plate_street_cleaning?: string | null
          license_plate_type?: string | null
          license_reuse_consent_given?: boolean | null
          license_reuse_consent_given_at?: string | null
          license_state?: string | null
          license_valid_until?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          marketing_consent?: boolean | null
          notification_preferences?: Json | null
          notify_days_array?: number[] | null
          notify_days_before?: number | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          notify_snow?: boolean | null
          notify_snow_ban?: boolean | null
          notify_snow_confirmation?: boolean | null
          notify_snow_confirmation_email?: boolean | null
          notify_snow_confirmation_sms?: boolean | null
          notify_snow_forecast?: boolean | null
          notify_snow_forecast_email?: boolean | null
          notify_snow_forecast_sms?: boolean | null
          notify_winter_ban?: boolean | null
          notify_winter_parking?: boolean | null
          on_snow_route?: boolean | null
          payment_authorized_at?: string | null
          permit_application_status?: string | null
          permit_expiry_date?: string | null
          permit_requested?: boolean | null
          permit_zone_number?: string | null
          phone?: string | null
          phone_call_days_before?: number[] | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          phone_verified?: boolean | null
          profile_confirmed_at?: string | null
          profile_confirmed_for_year?: number | null
          proof_of_residency_url?: string | null
          property_tax_fetch_failed?: boolean | null
          property_tax_fetch_notes?: string | null
          property_tax_last_fetched_at?: string | null
          property_tax_needs_refresh?: boolean | null
          push_subscription?: Json | null
          referral_pro_earned?: boolean | null
          reminder_days?: number[] | null
          renewal_notification_days?: number | null
          renewal_status?: string | null
          residency_forwarding_consent_given?: boolean | null
          residency_forwarding_consent_given_at?: string | null
          residency_forwarding_enabled?: boolean | null
          residency_proof_path?: string | null
          residency_proof_type?: string | null
          residency_proof_uploaded_at?: string | null
          residency_proof_verified?: boolean | null
          residency_proof_verified_at?: string | null
          role?: string | null
          rv_weight?: number | null
          sms_gateway?: string | null
          sms_opt_out_method?: string | null
          sms_opt_out_voids_guarantee?: boolean | null
          sms_opted_out_at?: string | null
          sms_pro?: boolean | null
          sms_pro_expires_at?: string | null
          sms_trial_ends?: string | null
          sms_trial_expires_at?: string | null
          sms_trial_first_sent?: boolean | null
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          snow_route_street?: string | null
          spending_limit?: number | null
          sticker_expected_delivery?: string | null
          sticker_purchased_at?: string | null
          street_address?: string | null
          street_side?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          subscription_canceled_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          third_party_processing_consent?: boolean | null
          third_party_processing_consent_at?: string | null
          timezone?: string | null
          trailer_weight?: number | null
          updated_at?: string | null
          user_id: string
          utilityapi_authorization_uid?: string | null
          utilityapi_connected?: boolean | null
          utilityapi_connected_at?: string | null
          utilityapi_form_uid?: string | null
          utilityapi_latest_bill_date?: string | null
          utilityapi_latest_bill_pdf_url?: string | null
          utilityapi_latest_bill_uid?: string | null
          utilityapi_utility?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
          vehicle_zone?: string | null
          vin?: string | null
          voice_call_days_before?: number[] | null
          voice_call_time?: string | null
          voice_calls_enabled?: boolean | null
          voice_preference?: string | null
          zip_code?: string | null
        }
        Update: {
          affiliate_id?: string | null
          affiliate_signup_date?: string | null
          city?: string | null
          city_sticker_expiry?: string | null
          city_sticker_purchase_confirmed_at?: string | null
          city_stickers_only?: boolean | null
          concierge_service?: boolean | null
          consent_ip_address?: string | null
          consent_protection_purchase?: string | null
          created_at?: string | null
          drivers_license_url?: string | null
          email?: string | null
          email_forwarding_address?: string | null
          email_verified?: boolean | null
          emissions_completed?: boolean | null
          emissions_completed_at?: string | null
          emissions_date?: string | null
          emissions_test_year?: number | null
          first_name?: string | null
          foia_data_emails?: Json | null
          foia_emails_added_at?: string | null
          foia_emails_updated_at?: string | null
          follow_up_sms?: boolean | null
          guarantee_opt_in_year?: number | null
          has_permit_zone?: boolean | null
          has_protection?: boolean
          has_contesting?: boolean
          has_vanity_plate?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          is_canary?: boolean | null
          is_paid?: boolean | null
          last_name?: string | null
          license_back_last_accessed_at?: string | null
          license_image_back_uploaded_at?: string | null
          license_image_back_verified?: boolean | null
          license_image_path?: string | null
          license_image_path_back?: string | null
          license_image_uploaded_at?: string | null
          license_image_verification_notes?: string | null
          license_image_verified?: boolean | null
          license_image_verified_at?: string | null
          license_image_verified_by?: string | null
          license_last_accessed_at?: string | null
          license_plate?: string | null
          license_plate_expiry?: string | null
          license_plate_is_personalized?: boolean | null
          license_plate_is_vanity?: boolean | null
          license_plate_last_accessed_at?: string | null
          license_plate_renewal_cost?: number | null
          license_plate_street_cleaning?: string | null
          license_plate_type?: string | null
          license_reuse_consent_given?: boolean | null
          license_reuse_consent_given_at?: string | null
          license_state?: string | null
          license_valid_until?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          marketing_consent?: boolean | null
          notification_preferences?: Json | null
          notify_days_array?: number[] | null
          notify_days_before?: number | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          notify_snow?: boolean | null
          notify_snow_ban?: boolean | null
          notify_snow_confirmation?: boolean | null
          notify_snow_confirmation_email?: boolean | null
          notify_snow_confirmation_sms?: boolean | null
          notify_snow_forecast?: boolean | null
          notify_snow_forecast_email?: boolean | null
          notify_snow_forecast_sms?: boolean | null
          notify_winter_ban?: boolean | null
          notify_winter_parking?: boolean | null
          on_snow_route?: boolean | null
          payment_authorized_at?: string | null
          permit_application_status?: string | null
          permit_expiry_date?: string | null
          permit_requested?: boolean | null
          permit_zone_number?: string | null
          phone?: string | null
          phone_call_days_before?: number[] | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          phone_verified?: boolean | null
          profile_confirmed_at?: string | null
          profile_confirmed_for_year?: number | null
          proof_of_residency_url?: string | null
          property_tax_fetch_failed?: boolean | null
          property_tax_fetch_notes?: string | null
          property_tax_last_fetched_at?: string | null
          property_tax_needs_refresh?: boolean | null
          push_subscription?: Json | null
          referral_pro_earned?: boolean | null
          reminder_days?: number[] | null
          renewal_notification_days?: number | null
          renewal_status?: string | null
          residency_forwarding_consent_given?: boolean | null
          residency_forwarding_consent_given_at?: string | null
          residency_forwarding_enabled?: boolean | null
          residency_proof_path?: string | null
          residency_proof_type?: string | null
          residency_proof_uploaded_at?: string | null
          residency_proof_verified?: boolean | null
          residency_proof_verified_at?: string | null
          role?: string | null
          rv_weight?: number | null
          sms_gateway?: string | null
          sms_opt_out_method?: string | null
          sms_opt_out_voids_guarantee?: boolean | null
          sms_opted_out_at?: string | null
          sms_pro?: boolean | null
          sms_pro_expires_at?: string | null
          sms_trial_ends?: string | null
          sms_trial_expires_at?: string | null
          sms_trial_first_sent?: boolean | null
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          snow_route_street?: string | null
          spending_limit?: number | null
          sticker_expected_delivery?: string | null
          sticker_purchased_at?: string | null
          street_address?: string | null
          street_side?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          subscription_canceled_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          third_party_processing_consent?: boolean | null
          third_party_processing_consent_at?: string | null
          timezone?: string | null
          trailer_weight?: number | null
          updated_at?: string | null
          user_id?: string
          utilityapi_authorization_uid?: string | null
          utilityapi_connected?: boolean | null
          utilityapi_connected_at?: string | null
          utilityapi_form_uid?: string | null
          utilityapi_latest_bill_date?: string | null
          utilityapi_latest_bill_pdf_url?: string | null
          utilityapi_latest_bill_uid?: string | null
          utilityapi_utility?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
          vehicle_zone?: string | null
          vin?: string | null
          voice_call_days_before?: number[] | null
          voice_call_time?: string | null
          voice_calls_enabled?: boolean | null
          voice_preference?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      user_snow_ban_notifications: {
        Row: {
          channels: string[] | null
          created_at: string | null
          id: string
          notification_date: string
          notification_type: string | null
          sent_at: string | null
          snow_event_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          channels?: string[] | null
          created_at?: string | null
          id?: string
          notification_date: string
          notification_type?: string | null
          sent_at?: string | null
          snow_event_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          channels?: string[] | null
          created_at?: string | null
          id?: string
          notification_date?: string
          notification_type?: string | null
          sent_at?: string | null
          snow_event_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_snow_ban_notifications_snow_event_id_fkey"
            columns: ["snow_event_id"]
            isOneToOne: false
            referencedRelation: "snow_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_snow_ban_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_winter_ban_notifications: {
        Row: {
          channels: string[] | null
          created_at: string | null
          id: string
          notification_date: string
          notification_year: number
          sent_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          channels?: string[] | null
          created_at?: string | null
          id?: string
          notification_date: string
          notification_year: number
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          channels?: string[] | null
          created_at?: string | null
          id?: string
          notification_date?: string
          notification_year?: number
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_winter_ban_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          city_sticker_expiry: string | null
          city_stickers_only: boolean | null
          concierge_service: boolean | null
          created_at: string | null
          current_permit_document_id: number | null
          email: string
          email_verified: boolean | null
          emissions_date: string | null
          first_name: string | null
          follow_up_sms: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          id: string
          last_name: string | null
          license_plate: string | null
          license_plate_expiry: string | null
          license_plate_street_cleaning: string | null
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          notification_preferences: Json | null
          notify_days_array: number[] | null
          notify_evening_before: boolean | null
          phone: string | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_verified: boolean | null
          snooze_created_at: string | null
          snooze_reason: string | null
          snooze_until_date: string | null
          spending_limit: number | null
          street_address: string | null
          street_side: string | null
          subscription_status: string | null
          updated_at: string | null
          vehicle_type: string | null
          vehicle_year: number | null
          vin: string | null
          voice_preference: string | null
          zip_code: string | null
        }
        Insert: {
          city_sticker_expiry?: string | null
          city_stickers_only?: boolean | null
          concierge_service?: boolean | null
          created_at?: string | null
          current_permit_document_id?: number | null
          email: string
          email_verified?: boolean | null
          emissions_date?: string | null
          first_name?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          id?: string
          last_name?: string | null
          license_plate?: string | null
          license_plate_expiry?: string | null
          license_plate_street_cleaning?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          notification_preferences?: Json | null
          notify_days_array?: number[] | null
          notify_evening_before?: boolean | null
          phone?: string | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_verified?: boolean | null
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          spending_limit?: number | null
          street_address?: string | null
          street_side?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
          vin?: string | null
          voice_preference?: string | null
          zip_code?: string | null
        }
        Update: {
          city_sticker_expiry?: string | null
          city_stickers_only?: boolean | null
          concierge_service?: boolean | null
          created_at?: string | null
          current_permit_document_id?: number | null
          email?: string
          email_verified?: boolean | null
          emissions_date?: string | null
          first_name?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          id?: string
          last_name?: string | null
          license_plate?: string | null
          license_plate_expiry?: string | null
          license_plate_street_cleaning?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          notification_preferences?: Json | null
          notify_days_array?: number[] | null
          notify_evening_before?: boolean | null
          phone?: string | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_verified?: boolean | null
          snooze_created_at?: string | null
          snooze_reason?: string | null
          snooze_until_date?: string | null
          spending_limit?: number | null
          street_address?: string | null
          street_side?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
          vin?: string | null
          voice_preference?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_current_permit_document_id_fkey"
            columns: ["current_permit_document_id"]
            isOneToOne: false
            referencedRelation: "permit_zone_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_reminders: {
        Row: {
          city_sticker_completed: boolean | null
          city_sticker_expiry: string
          city_sticker_reminder_sent: boolean | null
          city_sticker_reminder_sent_at: string | null
          completed: boolean | null
          created_at: string | null
          email: string
          emissions_completed: boolean | null
          emissions_due_date: string | null
          emissions_reminder_sent: boolean | null
          emissions_reminder_sent_at: string | null
          id: string
          license_plate: string
          license_plate_expiry: string
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          notes: string | null
          notification_preferences: Json | null
          phone: string
          reminder_method: string | null
          reminder_sent: boolean | null
          reminder_sent_at: string | null
          sent_reminders: string[] | null
          service_plan: string | null
          subscription_id: string | null
          subscription_status: string | null
          updated_at: string | null
          user_id: string
          vin: string | null
          zip_code: string
        }
        Insert: {
          city_sticker_completed?: boolean | null
          city_sticker_expiry: string
          city_sticker_reminder_sent?: boolean | null
          city_sticker_reminder_sent_at?: string | null
          completed?: boolean | null
          created_at?: string | null
          email: string
          emissions_completed?: boolean | null
          emissions_due_date?: string | null
          emissions_reminder_sent?: boolean | null
          emissions_reminder_sent_at?: string | null
          id?: string
          license_plate: string
          license_plate_expiry: string
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          notes?: string | null
          notification_preferences?: Json | null
          phone: string
          reminder_method?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          sent_reminders?: string[] | null
          service_plan?: string | null
          subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id: string
          vin?: string | null
          zip_code: string
        }
        Update: {
          city_sticker_completed?: boolean | null
          city_sticker_expiry?: string
          city_sticker_reminder_sent?: boolean | null
          city_sticker_reminder_sent_at?: string | null
          completed?: boolean | null
          created_at?: string | null
          email?: string
          emissions_completed?: boolean | null
          emissions_due_date?: string | null
          emissions_reminder_sent?: boolean | null
          emissions_reminder_sent_at?: string | null
          id?: string
          license_plate?: string
          license_plate_expiry?: string
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          notes?: string | null
          notification_preferences?: Json | null
          phone?: string
          reminder_method?: string | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          sent_reminders?: string[] | null
          service_plan?: string | null
          subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string
          vin?: string | null
          zip_code?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          created_at: string | null
          id: string
          license_plate: string
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          make: string | null
          model: string | null
          subscription_id: string | null
          subscription_status: string | null
          updated_at: string | null
          user_id: string | null
          vin: string | null
          year: number | null
          zip_code: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          license_plate: string
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          make?: string | null
          model?: string | null
          subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string | null
          vin?: string | null
          year?: number | null
          zip_code?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          license_plate?: string
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          make?: string | null
          model?: string | null
          subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string | null
          vin?: string | null
          year?: number | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_follow_up"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_one_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_users_with_addresses"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "report_zero_day"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_health_checks: {
        Row: {
          alert_sent: boolean | null
          check_results: Json
          check_time: string
          created_at: string | null
          id: number
          overall_status: string
          webhook_name: string
        }
        Insert: {
          alert_sent?: boolean | null
          check_results: Json
          check_time?: string
          created_at?: string | null
          id?: number
          overall_status: string
          webhook_name: string
        }
        Update: {
          alert_sent?: boolean | null
          check_results?: Json
          check_time?: string
          created_at?: string | null
          id?: number
          overall_status?: string
          webhook_name?: string
        }
        Relationships: []
      }
      winter_overnight_parking_ban_streets: {
        Row: {
          created_at: string | null
          from_location: string
          id: string
          street_name: string
          to_location: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          from_location: string
          id?: string
          street_name: string
          to_location: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          from_location?: string
          id?: string
          street_name?: string
          to_location?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      contest_method_win_rates: {
        Row: {
          contest_type: string | null
          total_contests: number | null
          win_rate_percent: number | null
          wins: number | null
        }
        Relationships: []
      }
      dismissal_reasons: {
        Row: {
          count: number | null
          percentage: number | null
          reason: string | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      leaderboard_current_storm: {
        Row: {
          avg_rating: number | null
          display_name: string | null
          jobs_completed: number | null
          phone: string | null
          storm_earnings: number | null
        }
        Relationships: []
      }
      officer_win_rates: {
        Row: {
          hearing_officer: string | null
          liable: number | null
          not_liable: number | null
          not_liable_rate_percent: number | null
          total_cases: number | null
        }
        Relationships: []
      }
      overdue_obligations: {
        Row: {
          auto_renew_enabled: boolean | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          days_overdue: number | null
          due_date: string | null
          email: string | null
          id: string | null
          license_plate: string | null
          notes: string | null
          phone: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_follow_up: {
        Row: {
          email: string | null
          follow_up_sms: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          notify_days_array: number[] | null
          notify_email: boolean | null
          notify_evening_before: boolean | null
          notify_sms: boolean | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_number: string | null
          sms_pro: boolean | null
          snooze_until_date: string | null
          user_id: string | null
          voice_preference: string | null
        }
        Insert: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Update: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Relationships: []
      }
      report_one_day: {
        Row: {
          email: string | null
          follow_up_sms: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          notify_days_array: number[] | null
          notify_email: boolean | null
          notify_evening_before: boolean | null
          notify_sms: boolean | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_number: string | null
          sms_pro: boolean | null
          snooze_until_date: string | null
          user_id: string | null
          voice_preference: string | null
        }
        Insert: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Update: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Relationships: []
      }
      report_users_with_addresses: {
        Row: {
          email: string | null
          follow_up_sms: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          notify_days_array: number[] | null
          notify_email: boolean | null
          notify_evening_before: boolean | null
          notify_sms: boolean | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_number: string | null
          sms_pro: boolean | null
          snooze_until_date: string | null
          user_id: string | null
          voice_preference: string | null
        }
        Insert: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Update: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Relationships: []
      }
      report_zero_day: {
        Row: {
          email: string | null
          follow_up_sms: boolean | null
          home_address_full: string | null
          home_address_section: string | null
          home_address_ward: string | null
          notify_days_array: number[] | null
          notify_email: boolean | null
          notify_evening_before: boolean | null
          notify_sms: boolean | null
          phone_call_enabled: boolean | null
          phone_call_time_preference: string | null
          phone_number: string | null
          sms_pro: boolean | null
          snooze_until_date: string | null
          user_id: string | null
          voice_preference: string | null
        }
        Insert: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Update: {
          email?: string | null
          follow_up_sms?: boolean | null
          home_address_full?: string | null
          home_address_section?: string | null
          home_address_ward?: string | null
          notify_days_array?: number[] | null
          notify_email?: boolean | null
          notify_evening_before?: boolean | null
          notify_sms?: boolean | null
          phone_call_enabled?: boolean | null
          phone_call_time_preference?: string | null
          phone_number?: string | null
          sms_pro?: boolean | null
          snooze_until_date?: string | null
          user_id?: string | null
          voice_preference?: string | null
        }
        Relationships: []
      }
      upcoming_obligations: {
        Row: {
          auto_renew_enabled: boolean | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          days_until_due: number | null
          due_date: string | null
          email: string | null
          id: string | null
          license_plate: string | null
          notes: string | null
          notification_preferences: Json | null
          phone: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      violation_win_rates: {
        Row: {
          denied: number | null
          losses: number | null
          other: number | null
          total_contests: number | null
          violation_code: string | null
          violation_description: string | null
          win_rate_decided_percent: number | null
          win_rate_percent: number | null
          wins: number | null
        }
        Relationships: []
      }
      ward_win_rates: {
        Row: {
          total_contests: number | null
          ward: string | null
          win_rate_percent: number | null
          wins: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      activate_snow_ban: {
        Args: { p_notes?: string; p_snow_amount?: number }
        Returns: undefined
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      calculate_distance_from_point: {
        Args: {
          point_lat: number
          point_lng: number
          zone_section: string
          zone_ward: string
        }
        Returns: number
      }
      calculate_plate_renewal_cost: {
        Args: {
          is_personalized?: boolean
          is_vanity?: boolean
          plate_type: string
          rv_weight_lbs?: number
          trailer_weight_lbs?: number
        }
        Returns: number
      }
      check_all_parking_restrictions: {
        Args: { user_lat: number; user_lng: number }
        Returns: Json
      }
      cleanup_expired_signup_tokens: { Args: never; Returns: number }
      deactivate_push_token: { Args: { p_token: string }; Returns: undefined }
      deactivate_snow_ban: { Args: { p_notes?: string }; Returns: undefined }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      find_nearest_sf_street: {
        Args: { lat: number; lng: number; max_distance_meters?: number }
        Returns: {
          block_side: string
          cnn: string
          corridor: string
          distance_meters: number
          from_hour: number
          full_name: string
          holidays: number
          id: number
          limits: string
          to_hour: number
          week_day: string
          week1: number
          week2: number
          week3: number
          week4: number
          week5: number
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_active_snow_event: {
        Args: never
        Returns: {
          event_date: string
          id: string
          snow_amount_inches: number
          two_inch_ban_triggered: boolean
        }[]
      }
      get_nearby_shovelers: {
        Args: {
          job_lat: number
          job_long: number
          max_distance_miles?: number
          max_rate?: number
        }
        Returns: {
          distance_miles: number
          id: string
          name: string
          phone: string
          rate: number
          skills: string[]
        }[]
      }
      get_next_cleaning_date: {
        Args: { p_section: string; p_ward: string }
        Returns: string
      }
      get_obligations_needing_reminders: {
        Args: { days_ahead: number }
        Returns: {
          due_date: string
          email: string
          license_plate: string
          notification_preferences: Json
          obligation_id: string
          phone: string
          type: string
          user_id: string
          vehicle_id: string
        }[]
      }
      get_permit_zone_at_location: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          distance: number
          hours: string
          street_name: string
          zone_name: string
        }[]
      }
      get_permit_zone_at_location_enhanced: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          address_range: string
          distance: number
          restricted_hours: string
          status: string
          street_full: string
          zone_name: string
        }[]
      }
      get_sf_streets_in_bounds: {
        Args: { ne_lat: number; ne_lng: number; sw_lat: number; sw_lng: number }
        Returns: {
          block_side: string
          cnn: string
          corridor: string
          from_hour: number
          full_name: string
          geometry: Json
          holidays: number
          id: number
          limits: string
          to_hour: number
          week_day: string
          week1: number
          week2: number
          week3: number
          week4: number
          week5: number
        }[]
      }
      get_snow_ban_status: {
        Args: never
        Returns: {
          activation_date: string
          hours_until_winter_ban: number
          is_active: boolean
          is_winter_ban_hours: boolean
          severity: string
          snow_amount_inches: number
        }[]
      }
      get_snow_route_at_location: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          distance: number
          street_name: string
        }[]
      }
      get_snow_route_at_location_enhanced: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          ban_activation_date: string
          distance: number
          is_ban_active: boolean
          restrict_type: string
          street_name: string
        }[]
      }
      get_street_cleaning_at_location: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          distance: number
          schedule: string
          street_name: string
        }[]
      }
      get_street_cleaning_at_location_enhanced: {
        Args: { distance_meters?: number; user_lat: number; user_lng: number }
        Returns: {
          distance: number
          geometry_type: string
          next_cleaning_date: string
          section: string
          street_name: string
          ward: string
        }[]
      }
      get_user_push_tokens: {
        Args: { p_user_id: string }
        Returns: {
          device_name: string
          id: string
          platform: string
          token: string
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      haversine_distance: {
        Args: { lat1: number; lat2: number; long1: number; long2: number }
        Returns: number
      }
      is_address_on_winter_ban_street: {
        Args: { p_full_address: string }
        Returns: boolean
      }
      is_winter_ban_hours: { Args: never; Returns: boolean }
      log_reminder: {
        Args: {
          p_days_until_due: number
          p_error_message?: string
          p_method: string
          p_obligation_id: string
          p_status?: string
          p_user_id: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mark_snow_ban_triggered: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      refresh_foia_statistics: { Args: never; Returns: undefined }
      register_push_token: {
        Args: {
          p_app_version?: string
          p_device_id?: string
          p_device_name?: string
          p_platform: string
          p_token: string
          p_user_id: string
        }
        Returns: string
      }
      should_trigger_two_inch_ban: { Args: never; Returns: boolean }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      registration_state:
        | "idle"
        | "started"
        | "needs_info"
        | "info_complete"
        | "awaiting_submission"
        | "submitted"
        | "processing"
        | "delayed"
        | "completed"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      registration_state: [
        "idle",
        "started",
        "needs_info",
        "info_complete",
        "awaiting_submission",
        "submitted",
        "processing",
        "delayed",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const

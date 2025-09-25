-- Add service access tracking to vehicle_reminders table
-- This tracks which services each user has paid for

-- Add service_access column to track which services the user has access to
ALTER TABLE public.vehicle_reminders 
ADD COLUMN IF NOT EXISTS service_access JSONB DEFAULT '{"ticketless": false, "mystreetcleaning": false}'::jsonb;

-- Update existing records based on their current status
-- All existing paid TicketLess users should also get MSC access
UPDATE public.vehicle_reminders 
SET service_access = jsonb_build_object(
    'ticketless', 
    CASE 
        WHEN subscription_status = 'active' AND service_plan IN ('pro', 'annual', 'monthly') THEN true
        ELSE false
    END,
    'mystreetcleaning', 
    CASE 
        WHEN subscription_status = 'active' AND service_plan IN ('pro', 'annual', 'monthly') THEN true
        ELSE false
    END
)
WHERE service_access IS NULL OR service_access = '{"ticketless": false, "mystreetcleaning": false}'::jsonb;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_service_access_ticketless ON public.vehicle_reminders ((service_access->>'ticketless'));
CREATE INDEX IF NOT EXISTS idx_service_access_msc ON public.vehicle_reminders ((service_access->>'mystreetcleaning'));

-- Create a view for easy querying of service access
CREATE OR REPLACE VIEW public.user_service_access AS
SELECT 
    user_id,
    email,
    service_plan,
    subscription_status,
    (service_access->>'ticketless')::boolean as has_ticketless,
    (service_access->>'mystreetcleaning')::boolean as has_mystreetcleaning,
    created_at,
    updated_at
FROM public.vehicle_reminders;

-- Grant permissions
GRANT SELECT ON public.user_service_access TO authenticated;
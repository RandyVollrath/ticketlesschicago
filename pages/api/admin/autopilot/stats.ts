/**
 * Admin API: Get Autopilot Stats
 *
 * Returns stats from autopilot tables for the admin dashboard
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch all stats in parallel
    const [
      { count: usersCount },
      { count: platesCount },
      { count: pendingTicketsCount },
      { count: pendingEvidenceCount },
      { count: lettersCount },
      { data: vaEmailSetting },
      { data: pendingEvidenceTickets },
      { data: exportJobs },
      { data: vaUploads },
    ] = await Promise.all([
      // Active users
      supabaseAdmin
        .from('autopilot_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),

      // Monitored plates
      supabaseAdmin
        .from('monitored_plates')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),

      // Pending tickets
      supabaseAdmin
        .from('detected_tickets')
        .select('*', { count: 'exact', head: true })
        .in('status', ['found', 'needs_approval', 'evidence_received']),

      // Pending evidence
      supabaseAdmin
        .from('detected_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_evidence'),

      // Letters sent
      supabaseAdmin
        .from('contest_letters')
        .select('*', { count: 'exact', head: true })
        .in('status', ['sent', 'delivered']),

      // VA email setting
      supabaseAdmin
        .from('autopilot_admin_settings')
        .select('value')
        .eq('key', 'va_email')
        .single(),

      // Pending evidence tickets with profiles
      supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            defense_type,
            status
          ),
          user_profiles!detected_tickets_user_id_fkey (
            first_name,
            last_name,
            full_name
          )
        `)
        .eq('status', 'pending_evidence')
        .order('evidence_deadline', { ascending: true })
        .limit(20),

      // Export jobs
      supabaseAdmin
        .from('plate_export_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),

      // VA uploads
      supabaseAdmin
        .from('va_uploads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: usersCount || 0,
        totalPlates: platesCount || 0,
        pendingTickets: pendingTicketsCount || 0,
        pendingEvidence: pendingEvidenceCount || 0,
        lettersSent: lettersCount || 0,
      },
      vaEmail: vaEmailSetting?.value?.email || '',
      pendingEvidenceTickets: pendingEvidenceTickets || [],
      exportJobs: exportJobs || [],
      vaUploads: vaUploads || [],
    });

  } catch (error: any) {
    console.error('Error fetching autopilot stats:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch stats',
    });
  }
}

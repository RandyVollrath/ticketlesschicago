import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import EmailForwardingSetup from '../components/EmailForwardingSetup';

export default function UtilityEvidencePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [utilityForwardingEmail, setUtilityForwardingEmail] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData?.user) {
          setError('Please sign in to view utility evidence setup.');
          return;
        }

        const uid = authData.user.id;
        setUserId(uid);

        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('email_forwarding_address')
          .eq('user_id', uid)
          .single();

        const fallbackUtilityAddress = `${uid}@bills.autopilotamerica.com`;
        setUtilityForwardingEmail(profileData?.email_forwarding_address || fallbackUtilityAddress);
      } catch (e: any) {
        setError(e?.message || 'Failed to load utility evidence data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <>
      <Head>
        <title>Utility Evidence | Ticketless Chicago</title>
      </Head>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Utility Evidence Setup</h1>
          <Link href="/settings" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to Settings
          </Link>
        </div>

        {loading && <p className="text-sm text-gray-600">Loading utility evidence setup...</p>}
        {!loading && error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Your User UUID</h2>
              <p className="mt-1 font-mono text-xs text-gray-700 break-all">{userId}</p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h2 className="text-sm font-semibold text-blue-900">Utility Bills Forwarding Address</h2>
              <p className="mt-2 font-mono text-xs text-blue-900 break-all">{utilityForwardingEmail}</p>
            </div>

            <EmailForwardingSetup forwardingEmail={utilityForwardingEmail} />
          </div>
        )}
      </main>
    </>
  );
}

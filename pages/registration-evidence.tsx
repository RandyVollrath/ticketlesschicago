import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import RegistrationForwardingSetup from '../components/RegistrationForwardingSetup';

interface ReceiptRow {
  id: string;
  source_type: 'city_sticker' | 'license_plate';
  sender_email: string;
  email_subject: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  screenshot_path: string | null;
  forwarded_at: string;
  parsed_purchase_date: string | null;
  parsed_order_id: string | null;
  parsed_amount_cents: number | null;
}

export default function RegistrationEvidencePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [registrationForwardingEmail, setRegistrationForwardingEmail] = useState<string>('');
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData?.user) {
          setError('Please sign in to view registration evidence setup.');
          return;
        }

        const uid = authData.user.id;
        setUserId(uid);
        setRegistrationForwardingEmail(`${uid}@receipts.autopilotamerica.com`);

        const { data: receiptRows, error: receiptsError } = await supabase
          .from('registration_evidence_receipts' as any)
          .select('*')
          .order('forwarded_at', { ascending: false })
          .limit(100);

        if (receiptsError) {
          setError(receiptsError.message);
          return;
        }

        setReceipts((receiptRows || []) as unknown as ReceiptRow[]);
      } catch (e: any) {
        setError(e?.message || 'Failed to load registration evidence data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const stats = useMemo(() => {
    const city = receipts.filter((r) => r.source_type === 'city_sticker').length;
    const plate = receipts.filter((r) => r.source_type === 'license_plate').length;
    return { total: receipts.length, city, plate };
  }, [receipts]);

  return (
    <>
      <Head>
        <title>Registration Evidence | Ticketless Chicago</title>
      </Head>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Registration Evidence</h1>
          <Link href="/settings" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to Settings
          </Link>
        </div>

        {loading && <p className="text-sm text-gray-600">Loading evidence setup...</p>}

        {!loading && error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Your User UUID</h2>
              <p className="mt-1 font-mono text-xs text-gray-700 break-all">{userId}</p>
              <p className="mt-2 text-xs text-gray-500">
                This UUID powers your forwarding address and ties receipts to your account.
              </p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h2 className="text-sm font-semibold text-blue-900">Forwarding Addresses</h2>
              <p className="mt-2 text-xs text-blue-800">
                Registration receipts inbox (SEBIS + ILSOS):
              </p>
              <p className="font-mono text-xs text-blue-900 break-all">{registrationForwardingEmail}</p>
            </div>

            <RegistrationForwardingSetup forwardingEmail={registrationForwardingEmail} />

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              Need utility-bill forwarding for permit residency proof?{' '}
              <Link href="/utility-evidence" className="font-medium text-blue-600 hover:text-blue-700">
                Open Utility Evidence Setup
              </Link>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-gray-900">Receipt History</h2>
              <p className="mt-1 text-sm text-gray-600">
                Stored receipts: {stats.total} total ({stats.city} city sticker, {stats.plate} plate sticker)
              </p>

              {receipts.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No forwarded registration receipts yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Forwarded</th>
                        <th className="px-3 py-2">Order</th>
                        <th className="px-3 py-2">Amount</th>
                        <th className="px-3 py-2">Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {receipts.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2">
                            {r.source_type === 'city_sticker' ? 'City Sticker' : 'Plate Sticker'}
                          </td>
                          <td className="px-3 py-2">
                            {new Date(r.forwarded_at).toLocaleString()}
                          </td>
                          <td className="px-3 py-2">{r.parsed_order_id || '—'}</td>
                          <td className="px-3 py-2">
                            {r.parsed_amount_cents != null ? `$${(r.parsed_amount_cents / 100).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {r.storage_path ? `${r.storage_bucket || 'registration-evidence'}:${r.storage_path}` : 'Email content only'}
                            {r.screenshot_path ? ' + screenshot' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

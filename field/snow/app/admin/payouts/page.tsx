"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PendingPayout {
  shovelerPhone: string;
  shovelerName: string | null;
  venmoHandle: string | null;
  cashappHandle: string | null;
  totalOwed: number;
  jobCount: number;
  jobs: Array<{
    id: string;
    address: string;
    amount: number;
    completedAt: string;
  }>;
}

interface PayoutRequest {
  id: string;
  shoveler_phone: string;
  amount: number;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  status: string;
  created_at: string;
}

export default function AdminPayoutsPage() {
  const [pendingPayouts, setPendingPayouts] = useState<PendingPayout[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchPayoutData();
  }, []);

  const fetchPayoutData = async () => {
    try {
      const res = await fetch("/api/admin/payouts");
      const data = await res.json();
      setPendingPayouts(data.pendingPayouts || []);
      setPayoutRequests(data.payoutRequests || []);
    } catch (err) {
      console.error("Error fetching payouts:", err);
    }
    setLoading(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getVenmoLink = (handle: string, amount: number) => {
    return `https://venmo.com/${handle}?txn=pay&amount=${amount}&note=SnowSOS%20Payout`;
  };

  const getCashAppLink = (handle: string, amount: number) => {
    return `https://cash.app/$${handle}/${amount}`;
  };

  const markAsPaid = async (requestId: string) => {
    try {
      const res = await fetch("/api/admin/payouts/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });

      if (res.ok) {
        fetchPayoutData();
      }
    } catch (err) {
      console.error("Error marking as paid:", err);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900 p-6">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-sky-600 text-sm hover:underline">
              &larr; Back to Admin
            </Link>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
              Payout Dashboard
            </h1>
          </div>
          <Link
            href="/admin/stats"
            className="text-sky-600 hover:underline text-sm"
          >
            View Stats &rarr;
          </Link>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <>
            {/* Pending Payout Requests */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Payout Requests ({payoutRequests.filter(r => r.status === "pending").length} pending)
              </h2>

              {payoutRequests.filter(r => r.status === "pending").length === 0 ? (
                <p className="text-slate-500">No pending payout requests</p>
              ) : (
                <div className="grid gap-4">
                  {payoutRequests
                    .filter((r) => r.status === "pending")
                    .map((request) => (
                      <div
                        key={request.id}
                        className="bg-white dark:bg-slate-800 rounded-xl shadow p-4"
                      >
                        <div className="flex flex-col sm:flex-row justify-between gap-4">
                          <div>
                            <p className="font-medium text-slate-800 dark:text-white">
                              {request.shoveler_phone}
                            </p>
                            <p className="text-2xl font-bold text-green-600">
                              ${request.amount.toFixed(2)}
                            </p>
                            <p className="text-xs text-slate-500">
                              Requested: {new Date(request.created_at).toLocaleString()}
                            </p>
                          </div>

                          <div className="flex flex-col gap-2">
                            {request.venmo_handle && (
                              <button
                                onClick={() => {
                                  const link = getVenmoLink(request.venmo_handle!, request.amount);
                                  copyToClipboard(link, `venmo-${request.id}`);
                                  window.open(link, "_blank");
                                }}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                              >
                                {copiedId === `venmo-${request.id}` ? "Copied!" : `Pay via Venmo (@${request.venmo_handle})`}
                              </button>
                            )}

                            {request.cashapp_handle && (
                              <button
                                onClick={() => {
                                  const link = getCashAppLink(request.cashapp_handle!, request.amount);
                                  copyToClipboard(link, `cashapp-${request.id}`);
                                  window.open(link, "_blank");
                                }}
                                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                              >
                                {copiedId === `cashapp-${request.id}` ? "Copied!" : `Pay via Cash App ($${request.cashapp_handle})`}
                              </button>
                            )}

                            <button
                              onClick={() => markAsPaid(request.id)}
                              className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white px-4 py-2 rounded-lg text-sm font-medium"
                            >
                              Mark as Paid
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </section>

            {/* Plowers with Unpaid Earnings */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Plowers with Unpaid Earnings
              </h2>

              {pendingPayouts.length === 0 ? (
                <p className="text-slate-500">All plowers are paid up!</p>
              ) : (
                <div className="grid gap-4">
                  {pendingPayouts.map((payout) => (
                    <div
                      key={payout.shovelerPhone}
                      className="bg-white dark:bg-slate-800 rounded-xl shadow p-4"
                    >
                      <div className="flex flex-col sm:flex-row justify-between gap-4">
                        <div>
                          <p className="font-medium text-slate-800 dark:text-white">
                            {payout.shovelerName || payout.shovelerPhone}
                          </p>
                          <p className="text-sm text-slate-500">{payout.shovelerPhone}</p>
                          <p className="text-xl font-bold text-amber-600">
                            ${payout.totalOwed.toFixed(2)} owed
                          </p>
                          <p className="text-xs text-slate-400">
                            {payout.jobCount} completed job{payout.jobCount !== 1 ? "s" : ""}
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          {payout.venmoHandle && (
                            <button
                              onClick={() => {
                                const link = getVenmoLink(payout.venmoHandle!, payout.totalOwed);
                                copyToClipboard(link, `venmo-${payout.shovelerPhone}`);
                                window.open(link, "_blank");
                              }}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                            >
                              {copiedId === `venmo-${payout.shovelerPhone}` ? "Copied!" : `Venmo @${payout.venmoHandle}`}
                            </button>
                          )}

                          {payout.cashappHandle && (
                            <button
                              onClick={() => {
                                const link = getCashAppLink(payout.cashappHandle!, payout.totalOwed);
                                copyToClipboard(link, `cashapp-${payout.shovelerPhone}`);
                                window.open(link, "_blank");
                              }}
                              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                            >
                              {copiedId === `cashapp-${payout.shovelerPhone}` ? "Copied!" : `Cash App $${payout.cashappHandle}`}
                            </button>
                          )}

                          {!payout.venmoHandle && !payout.cashappHandle && (
                            <p className="text-sm text-red-500">No payment method</p>
                          )}
                        </div>
                      </div>

                      {/* Job details */}
                      <details className="mt-3">
                        <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-700">
                          View jobs
                        </summary>
                        <div className="mt-2 space-y-1">
                          {payout.jobs.map((job) => (
                            <div
                              key={job.id}
                              className="text-xs text-slate-600 dark:text-slate-400 flex justify-between"
                            >
                              <span>{job.address.substring(0, 40)}...</span>
                              <span className="font-medium">${job.amount}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recently Paid */}
            <section>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Recently Completed Payouts
              </h2>

              {payoutRequests.filter(r => r.status === "completed").length === 0 ? (
                <p className="text-slate-500">No completed payouts yet</p>
              ) : (
                <div className="grid gap-2">
                  {payoutRequests
                    .filter((r) => r.status === "completed")
                    .slice(0, 10)
                    .map((request) => (
                      <div
                        key={request.id}
                        className="bg-white dark:bg-slate-800 rounded-lg p-3 flex justify-between items-center"
                      >
                        <div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {request.shoveler_phone}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(request.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <p className="font-medium text-green-600">${request.amount}</p>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

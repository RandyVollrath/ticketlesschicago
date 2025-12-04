"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Dispute {
  id: string;
  job_id: string;
  customer_phone: string;
  plower_id: string | null;
  reason: string;
  photos: string[];
  status: "open" | "reviewed" | "resolved";
  admin_notes: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  job?: {
    id: string;
    address: string;
    description: string | null;
    max_price: number | null;
    completed_at: string | null;
    pics: { url: string; type: string }[];
  };
  plower?: {
    id: string;
    name: string | null;
    phone: string;
    avg_rating: number;
    no_show_strikes: number;
  };
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "reviewed" | "resolved">("open");
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [resolution, setResolution] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchDisputes = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/disputes?status=${filter}`);
      const data = await res.json();
      if (data.disputes) {
        setDisputes(data.disputes);
      }
    } catch (error) {
      console.error("Failed to fetch disputes:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const updateDisputeStatus = async (disputeId: string, newStatus: "reviewed" | "resolved") => {
    setUpdating(true);
    try {
      const res = await fetch("/api/admin/disputes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          status: newStatus,
          adminNotes: adminNotes || null,
          resolution: newStatus === "resolved" ? resolution : null,
        }),
      });

      if (res.ok) {
        setSelectedDispute(null);
        setAdminNotes("");
        setResolution("");
        fetchDisputes();
      }
    } catch (error) {
      console.error("Failed to update dispute:", error);
    } finally {
      setUpdating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Open</span>;
      case "reviewed":
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Reviewed</span>;
      case "resolved":
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Resolved</span>;
      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-sky-600 hover:underline text-sm">
              &larr; Back to Admin
            </Link>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mt-2">
              Dispute Management
            </h1>
          </div>

          <div className="flex gap-2">
            {(["all", "open", "reviewed", "resolved"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  filter === f
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-500">Loading disputes...</div>
        ) : disputes.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl">
            <p className="text-slate-500 dark:text-slate-400">
              No {filter === "all" ? "" : filter} disputes found.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((dispute) => (
              <div
                key={dispute.id}
                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getStatusBadge(dispute.status)}
                      <span className="text-sm text-slate-500">
                        {new Date(dispute.created_at).toLocaleDateString()} at{" "}
                        {new Date(dispute.created_at).toLocaleTimeString()}
                      </span>
                    </div>

                    <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
                      Job: {dispute.job?.address || dispute.job_id.substring(0, 8)}
                    </h3>

                    <p className="text-slate-600 dark:text-slate-300 mb-3">
                      {dispute.reason}
                    </p>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">Customer:</span>{" "}
                        <span className="text-slate-700 dark:text-slate-300">
                          {dispute.customer_phone}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Plower:</span>{" "}
                        <span className="text-slate-700 dark:text-slate-300">
                          {dispute.plower?.name || "Unknown"} ({dispute.plower?.phone || "N/A"})
                        </span>
                      </div>
                      {dispute.job?.max_price && (
                        <div>
                          <span className="text-slate-500">Job Price:</span>{" "}
                          <span className="text-slate-700 dark:text-slate-300">
                            ${dispute.job.max_price}
                          </span>
                        </div>
                      )}
                      {dispute.plower && (
                        <div>
                          <span className="text-slate-500">Plower Rating:</span>{" "}
                          <span className="text-slate-700 dark:text-slate-300">
                            {dispute.plower.avg_rating.toFixed(1)} ({dispute.plower.no_show_strikes} strikes)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Photos */}
                    {(dispute.photos?.length > 0 || dispute.job?.pics?.length) && (
                      <div className="mt-4">
                        <p className="text-sm text-slate-500 mb-2">Photos:</p>
                        <div className="flex gap-2 flex-wrap">
                          {dispute.photos?.map((url, i) => (
                            <a
                              key={`dispute-${i}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-lg overflow-hidden"
                            >
                              <img
                                src={url}
                                alt={`Dispute photo ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </a>
                          ))}
                          {dispute.job?.pics?.map((pic, i) => (
                            <a
                              key={`job-${i}`}
                              href={pic.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-lg overflow-hidden relative"
                            >
                              <img
                                src={pic.url}
                                alt={`Job ${pic.type} photo`}
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs text-center py-0.5">
                                {pic.type}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {dispute.admin_notes && (
                      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
                        <p className="text-sm text-slate-500">Admin Notes:</p>
                        <p className="text-slate-700 dark:text-slate-300">{dispute.admin_notes}</p>
                      </div>
                    )}

                    {dispute.resolution && (
                      <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <p className="text-sm text-green-600">Resolution:</p>
                        <p className="text-green-800 dark:text-green-300">{dispute.resolution}</p>
                      </div>
                    )}
                  </div>

                  {dispute.status !== "resolved" && (
                    <button
                      onClick={() => {
                        setSelectedDispute(dispute);
                        setAdminNotes(dispute.admin_notes || "");
                      }}
                      className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700"
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Review Modal */}
        {selectedDispute && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-lg w-full">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">
                Review Dispute
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Admin Notes
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                  rows={3}
                  placeholder="Internal notes about this dispute..."
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Resolution (for closing)
                </label>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                  rows={2}
                  placeholder="How was this resolved? (e.g., Refund issued, Plower warned)"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedDispute(null)}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300"
                  disabled={updating}
                >
                  Cancel
                </button>
                <button
                  onClick={() => updateDisputeStatus(selectedDispute.id, "reviewed")}
                  className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
                  disabled={updating}
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => updateDisputeStatus(selectedDispute.id, "resolved")}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  disabled={updating || !resolution}
                >
                  Resolve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

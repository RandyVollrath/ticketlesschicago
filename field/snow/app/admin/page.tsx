"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Bid {
  shoveler_phone: string;
  shoveler_name?: string;
  amount: number;
  timestamp: string;
}

interface Job {
  id: string;
  customer_phone: string;
  address: string;
  description: string | null;
  max_price: number | null;
  lat: number | null;
  long: number | null;
  status: string;
  shoveler_phone: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  bid_mode: boolean;
  bids: Bid[];
  bid_deadline: string | null;
  selected_bid_index: number | null;
  service_type: string;
  surge_multiplier: number;
}

interface Shoveler {
  id: string;
  phone: string;
  name: string | null;
  rate: number;
  skills: string[];
  lat: number | null;
  long: number | null;
  verified: boolean;
  active: boolean;
  created_at: string;
  has_truck: boolean;
  venmo_handle: string | null;
  cashapp_handle: string | null;
}

interface Earning {
  id: string;
  job_id: string;
  shoveler_phone: string;
  job_amount: number;
  platform_fee: number;
  shoveler_payout: number;
  created_at: string;
}

interface EarningsTotals {
  totalRevenue: number;
  platformFees: number;
  shovelerPayouts: number;
}

export default function AdminDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shovelers, setShovelers] = useState<Shoveler[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [earningsTotals, setEarningsTotals] = useState<EarningsTotals>({ totalRevenue: 0, platformFees: 0, shovelerPayouts: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "shovelers" | "earnings">("jobs");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [jobsRes, shovelersRes, earningsRes] = await Promise.all([
        fetch("/api/jobs/list"),
        fetch("/api/shovelers/add"),
        fetch("/api/earnings"),
      ]);

      const jobsData = await jobsRes.json();
      const shovelersData = await shovelersRes.json();
      const earningsData = await earningsRes.json();

      setJobs(jobsData.jobs || []);
      setShovelers(shovelersData.shovelers || []);
      setEarnings(earningsData.earnings || []);
      setEarningsTotals(earningsData.totals || { totalRevenue: 0, platformFees: 0, shovelerPayouts: 0 });
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setLoading(false);
  };

  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const claimedJobs = jobs.filter((j) => j.status === "claimed");
  const inProgressJobs = jobs.filter((j) => j.status === "in_progress");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const activeShovelers = shovelers.filter((s) => s.active);
  const shovelerWithLocation = shovelers.filter((s) => s.lat && s.long);

  const filteredJobs = statusFilter === "all"
    ? jobs
    : jobs.filter((j) => j.status === statusFilter);

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      claimed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      in_progress: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
      completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    };
    return styles[status] || "bg-gray-100 text-gray-800";
  };

  // Get shoveler by phone for Quick Pay
  const getShovelerByPhone = (phone: string) => {
    return shovelers.find((s) => s.phone === phone);
  };

  // Copy to clipboard helper
  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Quick Pay component
  const QuickPayButton = ({ job }: { job: Job }) => {
    if (!job.shoveler_phone) return null;

    const shoveler = getShovelerByPhone(job.shoveler_phone);
    if (!shoveler) return null;

    const payoutAmount = job.max_price ? (job.max_price * 0.9).toFixed(2) : "45.00";

    return (
      <div className="flex items-center gap-2 mt-2">
        {shoveler.venmo_handle && (
          <button
            onClick={() => copyToClipboard(`@${shoveler.venmo_handle} $${payoutAmount}`, "Venmo")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              copiedText === "Venmo"
                ? "bg-green-500 text-white"
                : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
            }`}
          >
            {copiedText === "Venmo" ? "Copied!" : `Venmo @${shoveler.venmo_handle}`}
          </button>
        )}
        {shoveler.cashapp_handle && (
          <button
            onClick={() => copyToClipboard(`$${shoveler.cashapp_handle} $${payoutAmount}`, "CashApp")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              copiedText === "CashApp"
                ? "bg-green-500 text-white"
                : "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300"
            }`}
          >
            {copiedText === "CashApp" ? "Copied!" : `CashApp $${shoveler.cashapp_handle}`}
          </button>
        )}
        <span className="text-xs text-slate-500">
          ${payoutAmount} (90%)
        </span>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <Link
              href="/"
              className="text-sky-600 dark:text-sky-400 hover:underline text-sm mb-2 inline-block"
            >
              &larr; Back to site
            </Link>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white">
              SnowSOS Admin
            </h1>
          </div>
          <button
            onClick={fetchData}
            className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-bold text-yellow-600">{pendingJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Claimed</p>
            <p className="text-2xl font-bold text-blue-600">{claimedJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">In Progress</p>
            <p className="text-2xl font-bold text-purple-600">{inProgressJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Completed</p>
            <p className="text-2xl font-bold text-green-600">{completedJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Active Plowers</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">
              {activeShovelers.length}
              <span className="text-sm font-normal text-slate-500"> ({shovelerWithLocation.length} with location)</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("jobs")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "jobs"
                ? "bg-sky-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            Jobs ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab("shovelers")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "shovelers"
                ? "bg-sky-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            Plowers ({shovelers.length})
          </button>
          <button
            onClick={() => setActiveTab("earnings")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "earnings"
                ? "bg-sky-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            Earnings
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">Loading...</p>
          </div>
        ) : activeTab === "jobs" ? (
          <>
            {/* Job Filters */}
            <div className="mb-4 flex gap-2 flex-wrap">
              {["all", "pending", "claimed", "in_progress", "completed", "cancelled"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    statusFilter === status
                      ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {status === "all" ? "All" : status.replace("_", " ")}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
              {filteredJobs.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-slate-500 dark:text-slate-400">No jobs found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Budget</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Customer</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Plower / Quick Pay</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {filteredJobs.map((job) => (
                        <>
                          <tr
                            key={job.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-750 ${job.bid_mode ? "cursor-pointer" : ""}`}
                            onClick={() => job.bid_mode && setExpandedJob(expandedJob === job.id ? null : job.id)}
                          >
                            <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-300">
                              <div className="flex items-center gap-2 flex-wrap">
                                {job.id.substring(0, 8)}
                                {job.bid_mode && (
                                  <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 rounded">
                                    BID
                                  </span>
                                )}
                                {job.service_type === "truck" && (
                                  <span className="text-lg" title="Truck required">&#128668;</span>
                                )}
                                {job.service_type === "shovel" && (
                                  <span className="text-lg" title="Shovel only">&#128119;</span>
                                )}
                                {job.surge_multiplier > 1 && (
                                  <span className="text-lg animate-pulse" title="Surge pricing">&#128293;</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm text-slate-800 dark:text-white max-w-xs truncate">
                                {job.address}
                              </div>
                              {job.description && job.description !== "Snow removal requested" && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                  {job.description}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {job.max_price ? (
                                <span className="text-green-600 dark:text-green-400 font-medium">
                                  ${job.max_price}
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                              {job.bid_mode && job.bids && job.bids.length > 0 && (
                                <div className="text-xs text-orange-600 dark:text-orange-400">
                                  {job.bids.length} bid{job.bids.length !== 1 ? "s" : ""}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {formatPhone(job.customer_phone)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(job.status)}`}>
                                {job.status.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm text-slate-600 dark:text-slate-300">
                                {job.shoveler_phone ? formatPhone(job.shoveler_phone) : "-"}
                              </div>
                              {/* Quick Pay button for completed jobs */}
                              {(job.status === "completed" || job.status === "claimed" || job.status === "in_progress") && (
                                <QuickPayButton job={job} />
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                              {formatDate(job.created_at)}
                            </td>
                          </tr>
                          {/* Expanded bid details */}
                          {expandedJob === job.id && job.bid_mode && job.bids && job.bids.length > 0 && (
                            <tr key={`${job.id}-bids`}>
                              <td colSpan={7} className="px-4 py-3 bg-orange-50 dark:bg-orange-900/20">
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                  Bids for Job #{job.id.substring(0, 8)}
                                  {job.bid_deadline && (
                                    <span className="ml-2 text-xs text-slate-500">
                                      Deadline: {formatDate(job.bid_deadline)}
                                    </span>
                                  )}
                                </div>
                                <div className="grid gap-2">
                                  {job.bids.map((bid, idx) => (
                                    <div
                                      key={idx}
                                      className={`flex items-center justify-between p-2 rounded ${
                                        job.selected_bid_index === idx
                                          ? "bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700"
                                          : "bg-white dark:bg-slate-800"
                                      }`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm text-slate-500">#{idx + 1}</span>
                                        <span className="text-sm text-slate-700 dark:text-slate-300">
                                          {bid.shoveler_name || formatPhone(bid.shoveler_phone)}
                                        </span>
                                        {job.selected_bid_index === idx && (
                                          <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded">
                                            WINNER
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="font-medium text-green-600 dark:text-green-400">
                                          ${bid.amount}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                          {formatDate(bid.timestamp)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : activeTab === "earnings" ? (
          <>
            {/* Earnings Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Revenue</p>
                <p className="text-2xl font-bold text-slate-800 dark:text-white">${earningsTotals.totalRevenue.toFixed(2)}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Platform Fees (10%)</p>
                <p className="text-2xl font-bold text-green-600">${earningsTotals.platformFees.toFixed(2)}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Plower Payouts</p>
                <p className="text-2xl font-bold text-sky-600">${earningsTotals.shovelerPayouts.toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
              {earnings.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-slate-500 dark:text-slate-400">No earnings recorded yet.</p>
                  <p className="text-sm text-slate-400 mt-2">Earnings are recorded when jobs are completed.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Job ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Plower</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Job Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Platform Fee</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Plower Payout</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Quick Pay</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {earnings.map((earning) => {
                        const shoveler = getShovelerByPhone(earning.shoveler_phone);
                        return (
                          <tr key={earning.id} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                            <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-300">
                              {earning.job_id.substring(0, 8)}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {shoveler?.name || formatPhone(earning.shoveler_phone)}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-800 dark:text-white font-medium">
                              ${earning.job_amount.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400">
                              ${earning.platform_fee.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-sky-600 dark:text-sky-400 font-medium">
                              ${earning.shoveler_payout.toFixed(2)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                {shoveler?.venmo_handle && (
                                  <button
                                    onClick={() => copyToClipboard(`@${shoveler.venmo_handle} $${earning.shoveler_payout.toFixed(2)}`, `Venmo-${earning.id}`)}
                                    className={`px-2 py-1 text-xs font-medium rounded transition-all ${
                                      copiedText === `Venmo-${earning.id}`
                                        ? "bg-green-500 text-white"
                                        : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                                    }`}
                                  >
                                    {copiedText === `Venmo-${earning.id}` ? "Copied!" : `@${shoveler.venmo_handle}`}
                                  </button>
                                )}
                                {shoveler?.cashapp_handle && (
                                  <button
                                    onClick={() => copyToClipboard(`$${shoveler.cashapp_handle} $${earning.shoveler_payout.toFixed(2)}`, `CashApp-${earning.id}`)}
                                    className={`px-2 py-1 text-xs font-medium rounded transition-all ${
                                      copiedText === `CashApp-${earning.id}`
                                        ? "bg-green-500 text-white"
                                        : "bg-green-100 text-green-700 hover:bg-green-200"
                                    }`}
                                  >
                                    {copiedText === `CashApp-${earning.id}` ? "Copied!" : `$${shoveler.cashapp_handle}`}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                              {formatDate(earning.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
            {shovelers.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-slate-500 dark:text-slate-400">No plowers registered yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Phone</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Equipment</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Payment</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Location</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {shovelers.map((shoveler) => (
                      <tr key={shoveler.id} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                        <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                          {shoveler.name || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                          {formatPhone(shoveler.phone)}
                        </td>
                        <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400 font-medium">
                          ${shoveler.rate}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {shoveler.has_truck && (
                              <span className="text-xl" title="Has truck with plow">&#128668;</span>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {shoveler.skills?.map((skill) => (
                                <span
                                  key={skill}
                                  className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-600 rounded-full text-slate-600 dark:text-slate-300"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-1">
                            {shoveler.venmo_handle && (
                              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">
                                @{shoveler.venmo_handle}
                              </span>
                            )}
                            {shoveler.cashapp_handle && (
                              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded">
                                ${shoveler.cashapp_handle}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {shoveler.lat && shoveler.long ? (
                            <span className="text-green-600 dark:text-green-400">
                              {shoveler.lat.toFixed(3)}, {shoveler.long.toFixed(3)}
                            </span>
                          ) : (
                            <span className="text-slate-400">No location</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                              shoveler.active
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {shoveler.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

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
}

export default function AdminDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shovelers, setShovelers] = useState<Shoveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "shovelers">("jobs");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [jobsRes, shovelersRes] = await Promise.all([
        fetch("/api/jobs/list"),
        fetch("/api/shovelers/add"),
      ]);

      const jobsData = await jobsRes.json();
      const shovelersData = await shovelersRes.json();

      setJobs(jobsData.jobs || []);
      setShovelers(shovelersData.shovelers || []);
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
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Active Shovelers</p>
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
            Shovelers ({shovelers.length})
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Shoveler</th>
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
                              <div className="flex items-center gap-2">
                                {job.id.substring(0, 8)}
                                {job.bid_mode && (
                                  <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 rounded">
                                    BID
                                  </span>
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
                              {job.lat && job.long && (
                                <div className="text-xs text-green-600 dark:text-green-400">
                                  Geo: {job.lat.toFixed(4)}, {job.long.toFixed(4)}
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
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {job.shoveler_phone ? formatPhone(job.shoveler_phone) : "-"}
                              {job.selected_bid_index !== null && job.bids && job.bids[job.selected_bid_index] && (
                                <div className="text-xs text-green-600 dark:text-green-400">
                                  Won: ${job.bids[job.selected_bid_index].amount}
                                </div>
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
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
            {shovelers.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-slate-500 dark:text-slate-400">No shovelers registered yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Phone</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Skills</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Location</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Joined</th>
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
                          {shoveler.verified && (
                            <span className="ml-1 text-blue-500" title="Verified">&#10003;</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                          {formatDate(shoveler.created_at)}
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

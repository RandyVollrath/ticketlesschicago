"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Job {
  id: string;
  customer_phone: string;
  address: string;
  description: string | null;
  status: string;
  shoveler_phone: string | null;
  created_at: string;
}

interface Shoveler {
  id: string;
  phone: string;
  name: string | null;
  active: boolean;
  created_at: string;
}

export default function AdminDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shovelers, setShovelers] = useState<Shoveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "shovelers">("jobs");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
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
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const activeShovelers = shovelers.filter((s) => s.active);

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
    return date.toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "claimed":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "cancelled":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
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
            className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow">
            <p className="text-sm text-slate-500 dark:text-slate-400">Pending Jobs</p>
            <p className="text-3xl font-bold text-yellow-600">{pendingJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow">
            <p className="text-sm text-slate-500 dark:text-slate-400">In Progress</p>
            <p className="text-3xl font-bold text-blue-600">{claimedJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow">
            <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
            <p className="text-3xl font-bold text-green-600">{completedJobs.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow">
            <p className="text-sm text-slate-500 dark:text-slate-400">Active Shovelers</p>
            <p className="text-3xl font-bold text-slate-800 dark:text-white">{activeShovelers.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("jobs")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "jobs"
                ? "bg-sky-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            Jobs ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab("shovelers")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "shovelers"
                ? "bg-sky-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
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
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
            {jobs.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-slate-500 dark:text-slate-400">No jobs yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Address
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Customer
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Shoveler
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                        <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-300">
                          {job.id.substring(0, 8)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800 dark:text-white">{job.address}</div>
                          {job.description && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {job.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                          {formatPhone(job.customer_phone)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                              job.status
                            )}`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                          {job.shoveler_phone ? formatPhone(job.shoveler_phone) : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                          {formatDate(job.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Phone
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                        Joined
                      </th>
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
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                              shoveler.active
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                            }`}
                          >
                            {shoveler.active ? "Active" : "Inactive"}
                          </span>
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

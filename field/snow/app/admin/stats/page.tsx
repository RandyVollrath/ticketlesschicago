"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  overview: {
    totalJobs: number;
    completedJobs: number;
    pendingJobs: number;
    claimedJobs: number;
    cancelledJobs: number;
    conversionRate: string;
  };
  today: {
    jobs: number;
    completed: number;
    revenue: number;
  };
  thisWeek: {
    jobs: number;
    completed: number;
    revenue: number;
  };
  thisMonth: {
    jobs: number;
  };
  revenue: {
    total: number;
    average: number;
  };
  plowers: {
    total: number;
    online: number;
    active: number;
  };
  customers: {
    total: number;
  };
  topPlowers: Array<{
    phone: string;
    name: string;
    count: number;
    revenue: number;
  }>;
  hourlyDistribution: number[];
  recentJobs: Array<{
    id: string;
    shortId: string;
    address: string;
    status: string;
    price: number;
    createdAt: string;
    completedAt: string | null;
  }>;
}

export default function AdminStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
    setLoading(false);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "claimed":
      case "in_progress":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "cancelled":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
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
              Analytics Dashboard
            </h1>
          </div>
          <Link
            href="/admin/payouts"
            className="text-sky-600 hover:underline text-sm"
          >
            Payouts &rarr;
          </Link>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : stats ? (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <p className="text-sm text-slate-500">Total Jobs</p>
                <p className="text-3xl font-bold text-slate-800 dark:text-white">
                  {stats.overview.totalJobs}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <p className="text-sm text-slate-500">Completed</p>
                <p className="text-3xl font-bold text-green-600">
                  {stats.overview.completedJobs}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <p className="text-sm text-slate-500">Conversion Rate</p>
                <p className="text-3xl font-bold text-sky-600">
                  {stats.overview.conversionRate}%
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <p className="text-sm text-slate-500">Total Revenue</p>
                <p className="text-3xl font-bold text-emerald-600">
                  {formatCurrency(stats.revenue.total)}
                </p>
              </div>
            </div>

            {/* Time-based Stats */}
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <h3 className="font-semibold text-slate-800 dark:text-white mb-2">
                  Today
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jobs Posted</span>
                    <span className="font-medium text-slate-800 dark:text-white">
                      {stats.today.jobs}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Completed</span>
                    <span className="font-medium text-green-600">
                      {stats.today.completed}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Revenue</span>
                    <span className="font-medium text-emerald-600">
                      {formatCurrency(stats.today.revenue)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <h3 className="font-semibold text-slate-800 dark:text-white mb-2">
                  This Week
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jobs Posted</span>
                    <span className="font-medium text-slate-800 dark:text-white">
                      {stats.thisWeek.jobs}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Completed</span>
                    <span className="font-medium text-green-600">
                      {stats.thisWeek.completed}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Revenue</span>
                    <span className="font-medium text-emerald-600">
                      {formatCurrency(stats.thisWeek.revenue)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <h3 className="font-semibold text-slate-800 dark:text-white mb-2">
                  Plowers
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Registered</span>
                    <span className="font-medium text-slate-800 dark:text-white">
                      {stats.plowers.total}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Online Now</span>
                    <span className="font-medium text-green-600">
                      {stats.plowers.online}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Active (completed 1+)</span>
                    <span className="font-medium text-sky-600">
                      {stats.plowers.active}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Plowers */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Top Plowers
              </h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Rank
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Jobs
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {stats.topPlowers.map((plower, idx) => (
                      <tr key={plower.phone}>
                        <td className="px-4 py-3 text-slate-800 dark:text-white">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800 dark:text-white">
                            {plower.name}
                          </p>
                          <p className="text-xs text-slate-500">{plower.phone}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-white">
                          {plower.count}
                        </td>
                        <td className="px-4 py-3 font-medium text-emerald-600">
                          {formatCurrency(plower.revenue)}
                        </td>
                      </tr>
                    ))}
                    {stats.topPlowers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          No completed jobs yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Hourly Activity */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Today&apos;s Activity by Hour
              </h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                <div className="flex items-end gap-1 h-32">
                  {stats.hourlyDistribution.map((count, hour) => {
                    const maxCount = Math.max(...stats.hourlyDistribution, 1);
                    const height = (count / maxCount) * 100;
                    return (
                      <div
                        key={hour}
                        className="flex-1 bg-sky-500 rounded-t hover:bg-sky-600 transition-colors relative group"
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`${hour}:00 - ${count} jobs`}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-slate-500">
                  <span>12am</span>
                  <span>6am</span>
                  <span>12pm</span>
                  <span>6pm</span>
                  <span>12am</span>
                </div>
              </div>
            </section>

            {/* Recent Jobs */}
            <section>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
                Recent Jobs
              </h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Address
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Price
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {stats.recentJobs.map((job) => (
                        <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                          <td className="px-4 py-3 font-mono text-sm text-slate-800 dark:text-white">
                            <Link href={`/job/${job.id}`} className="text-sky-600 hover:underline">
                              {job.shortId}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-800 dark:text-white max-w-xs truncate">
                            {job.address}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                                job.status
                              )}`}
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-white">
                            {job.price > 0 ? formatCurrency(job.price) : "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">
                            {new Date(job.createdAt).toLocaleDateString()}{" "}
                            {new Date(job.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        ) : (
          <p className="text-red-500">Failed to load stats</p>
        )}
      </div>
    </main>
  );
}

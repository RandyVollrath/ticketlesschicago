"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface JobPic {
  url: string;
  type: string;
  uploaded_at: string;
}

interface Job {
  id: string;
  shortId: string;
  address: string;
  neighborhood: string | null;
  description: string;
  maxPrice: number | null;
  serviceType: string;
  bidMode: boolean;
  pics: JobPic[];
  createdAt: string;
  weatherNote: string | null;
  surgeMultiplier: number;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [selectedNeighborhood, setSelectedNeighborhood] = useState("");
  const [selectedServiceType, setSelectedServiceType] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    fetchJobs();
  }, [selectedNeighborhood, selectedServiceType, sortBy]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedNeighborhood) params.set("neighborhood", selectedNeighborhood);
      if (selectedServiceType) params.set("serviceType", selectedServiceType);
      params.set("sortBy", sortBy);

      const res = await fetch(`/api/jobs/browse?${params.toString()}`);
      const data = await res.json();

      if (data.jobs) {
        setJobs(data.jobs);
        setTotal(data.total);
        setNeighborhoods(data.neighborhoods || []);
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
    }
    setLoading(false);
  };

  const getTimeAgo = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getServiceIcon = (type: string) => {
    switch (type) {
      case "truck":
        return "🚛";
      case "shovel":
        return "🧑";
      default:
        return "⚡";
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/" className="text-sky-600 text-sm hover:underline">
                &larr; Home
              </Link>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                Open Jobs
              </h1>
              <p className="text-sm text-slate-500">{total} jobs available</p>
            </div>
            <Link
              href="/plower/dashboard"
              className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg font-medium"
            >
              Plower Login
            </Link>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-wrap gap-3">
            {/* Neighborhood Filter */}
            <select
              value={selectedNeighborhood}
              onChange={(e) => setSelectedNeighborhood(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
            >
              <option value="">All Neighborhoods</option>
              {neighborhoods.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            {/* Service Type Filter */}
            <select
              value={selectedServiceType}
              onChange={(e) => setSelectedServiceType(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
            >
              <option value="">All Types</option>
              <option value="truck">Truck Plow</option>
              <option value="shovel">Hand Shovel</option>
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
            >
              <option value="newest">Newest First</option>
              <option value="price_high">Highest Budget</option>
              <option value="price_low">Lowest Budget</option>
            </select>
          </div>
        </div>
      </div>

      {/* Jobs Grid */}
      <div className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-sky-500 border-t-transparent"></div>
            <p className="mt-2 text-slate-500">Loading jobs...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl">
            <div className="text-5xl mb-4">❄️</div>
            <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-2">
              No open jobs right now
            </h2>
            <p className="text-slate-500 mb-4">Check back during the next snowfall!</p>
            <Link
              href="/"
              className="text-sky-600 hover:underline"
            >
              Post a job &rarr;
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/plower/dashboard?claim=${job.id}`}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden group"
              >
                {/* Image Area */}
                <div className="h-40 bg-slate-200 dark:bg-slate-700 relative overflow-hidden">
                  {job.pics && job.pics.length > 0 ? (
                    <Image
                      src={job.pics[0].url}
                      alt="Job location"
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-6xl text-slate-400">
                      ❄️
                    </div>
                  )}

                  {/* Badges */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    <span className="bg-white/90 dark:bg-slate-800/90 px-2 py-1 rounded text-sm font-medium">
                      {getServiceIcon(job.serviceType)} {job.serviceType === "any" ? "Any" : job.serviceType}
                    </span>
                    {job.bidMode && (
                      <span className="bg-amber-400 text-amber-900 px-2 py-1 rounded text-sm font-medium">
                        Bidding
                      </span>
                    )}
                  </div>

                  {/* Price Badge */}
                  {job.maxPrice && (
                    <div className="absolute bottom-2 right-2 bg-green-500 text-white px-3 py-1 rounded-full font-bold">
                      ${job.maxPrice}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      {job.neighborhood && (
                        <span className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wide">
                          {job.neighborhood}
                        </span>
                      )}
                      <h3 className="font-semibold text-slate-800 dark:text-white line-clamp-1">
                        {job.address.split(",")[0]}
                      </h3>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {getTimeAgo(job.createdAt)}
                    </span>
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-3">
                    {job.description}
                  </p>

                  {job.weatherNote && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span>⚠️</span>
                      <span>{job.weatherNote}</span>
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                    <span className="text-sm font-medium text-sky-600 dark:text-sky-400 group-hover:underline">
                      View &amp; Claim &rarr;
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface OpenJob {
  id: string;
  shortId: string;
  address: string;
  description: string | null;
  maxPrice: number | null;
  bidMode: boolean;
  bidCount: number;
  bidDeadline: string | null;
  distanceMiles?: number;
  surgeMultiplier: number;
  weatherNote: string | null;
  createdAt: string;
  serviceType: "truck" | "shovel" | "any";
  customerPhone: string;
}

interface PlowerInfo {
  phone: string;
  name: string | null;
  rate: number;
  lat: number | null;
  long: number | null;
  has_truck: boolean;
}

export default function PlowerDashboard() {
  const [jobs, setJobs] = useState<OpenJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [plower, setPlower] = useState<PlowerInfo | null>(null);
  const [phone, setPhone] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sortBy, setSortBy] = useState<"pay" | "distance" | "newest">("pay");
  const [serviceFilter, setServiceFilter] = useState<"all" | "truck" | "shovel">("all");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const fetchJobs = useCallback(async () => {
    if (!plower) return;

    try {
      const params = new URLSearchParams({ sort: sortBy });
      if (plower.lat && plower.long) {
        params.set("lat", plower.lat.toString());
        params.set("long", plower.long.toString());
      }
      params.set("maxRate", plower.rate.toString());
      if (plower.has_truck) {
        params.set("hasTruck", "true");
      }

      const res = await fetch(`/api/jobs/open?${params}`);
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error("Error fetching jobs:", err);
    }
    setLoading(false);
  }, [plower, sortBy]);

  // Login handler
  const handleLogin = async () => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }

    try {
      const res = await fetch(`/api/shovelers/add?phone=+1${phoneDigits}`);
      const data = await res.json();

      if (data.shoveler) {
        setPlower(data.shoveler);
        setIsLoggedIn(true);
        localStorage.setItem("plowerPhone", `+1${phoneDigits}`);
        setError(null);
      } else {
        setError("Phone not registered. Sign up first!");
      }
    } catch {
      setError("Error checking registration");
    }
  };

  // Check for saved login
  useEffect(() => {
    const savedPhone = localStorage.getItem("plowerPhone");
    if (savedPhone) {
      fetch(`/api/shovelers/add?phone=${savedPhone}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.shoveler) {
            setPlower(data.shoveler);
            setIsLoggedIn(true);
          }
        })
        .catch(console.error);
    }
  }, []);

  // Fetch jobs and set up realtime
  useEffect(() => {
    if (!isLoggedIn || !plower) return;

    fetchJobs();

    // Set up Supabase realtime subscription
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const channel = supabase
        .channel("jobs-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobs" },
          () => {
            fetchJobs();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      // Fallback: poll every 10 seconds
      const interval = setInterval(fetchJobs, 10000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, plower, fetchJobs]);

  // CLAIM & CALL - claims job, opens phone dialer, sends SMS
  const handleClaimAndCall = async (job: OpenJob) => {
    if (!plower) return;
    setClaiming(job.id);
    setError(null);

    try {
      const res = await fetch(`/api/jobs/claim/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shovelerPhone: plower.phone,
          claimAndCall: true
        }),
      });

      const data = await res.json();

      if (res.ok) {
        // Open phone dialer with customer number
        const customerPhone = job.customerPhone.replace("+1", "");
        window.location.href = `tel:${customerPhone}`;

        // Brief delay then redirect to job chat
        setTimeout(() => {
          window.location.href = `/job/${job.id}?phone=${encodeURIComponent(plower.phone)}`;
        }, 500);
      } else {
        setError(data.error || "Failed to claim job");
      }
    } catch {
      setError("Network error");
    }
    setClaiming(null);
  };

  // Submit bid
  const handleBid = async (jobId: string) => {
    if (!plower) return;
    const amount = parseInt(bidAmount[jobId] || "0", 10);
    if (!amount || amount < 10 || amount > 500) {
      setError("Bid must be between $10 and $500");
      return;
    }

    setClaiming(jobId);
    setError(null);

    try {
      const res = await fetch(`/api/bids/submit/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shovelerPhone: plower.phone, amount }),
      });

      const data = await res.json();

      if (res.ok) {
        setError(null);
        setBidAmount((prev) => ({ ...prev, [jobId]: "" }));
        fetchJobs();
        alert(`Bid of $${amount} submitted! You are bid #${data.bid.position}`);
      } else {
        setError(data.error || "Failed to submit bid");
      }
    } catch {
      setError("Network error");
    }
    setClaiming(null);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Filter jobs by service type
  const filteredJobs = jobs.filter((job) => {
    if (serviceFilter === "all") return true;
    if (serviceFilter === "truck") {
      return job.serviceType === "truck" || job.serviceType === "any";
    }
    if (serviceFilter === "shovel") {
      return job.serviceType === "shovel" || job.serviceType === "any";
    }
    return true;
  });

  // Service type badge
  const getServiceBadge = (type: string) => {
    if (type === "truck") {
      return <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">&#128668; Truck</span>;
    }
    if (type === "shovel") {
      return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded">&#128119; Shovel</span>;
    }
    return <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded">&#9889; Any</span>;
  };

  // Login screen
  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
            Plower Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mb-6">
            Enter your registered phone to view available jobs
          </p>

          <div className="space-y-4">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="(312) 555-1234"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />

            {error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}

            <button
              onClick={handleLogin}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-6 rounded-lg"
            >
              View Jobs
            </button>

            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Not registered?{" "}
              <Link href="/shovel" className="text-sky-600 hover:underline">
                Sign up here
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <Link href="/" className="text-sky-600 text-sm hover:underline">
              &larr; Back
            </Link>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
              Available Jobs
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              {plower?.name || "Plower"} - ${plower?.rate}/job
              {plower?.has_truck && <span className="ml-2">&#128668; Truck</span>}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Sort buttons */}
            {(["pay", "distance", "newest"] as const).map((sort) => (
              <button
                key={sort}
                onClick={() => setSortBy(sort)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  sortBy === sort
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                {sort === "pay" ? "Top Pay" : sort === "distance" ? "Nearest" : "Newest"}
              </button>
            ))}
          </div>
        </div>

        {/* Service Type Filter */}
        <div className="flex gap-2 mb-4">
          {(["all", "truck", "shovel"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setServiceFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                serviceFilter === filter
                  ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
            >
              {filter === "all" ? "All Jobs" : filter === "truck" ? "&#128668; Truck" : "&#128119; Shovel"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Job List */}
        {loading ? (
          <div className="text-center py-12 text-slate-500">Loading jobs...</div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">&#10052;</div>
            <p className="text-slate-600 dark:text-slate-400">
              No open jobs right now. Check back soon!
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredJobs.map((job) => (
              <div
                key={job.id}
                className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 sm:p-6"
              >
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-mono text-sm text-slate-500">
                        #{job.shortId}
                      </span>
                      {getServiceBadge(job.serviceType)}
                      {job.bidMode && (
                        <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 rounded">
                          BIDDING ({job.bidCount} bids)
                        </span>
                      )}
                      {/* SURGE BADGE - Fire emoji for >4" snow */}
                      {job.surgeMultiplier > 1 && (
                        <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded animate-pulse">
                          &#128293; SURGE +{Math.round((job.surgeMultiplier - 1) * 100)}%
                        </span>
                      )}
                    </div>

                    <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
                      {job.address}
                    </h3>

                    {job.description && job.description !== "Snow removal requested" && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        {job.description}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 text-sm">
                      {job.maxPrice && (
                        <span className="text-green-600 dark:text-green-400 font-medium text-lg">
                          ${job.maxPrice}
                        </span>
                      )}
                      {job.distanceMiles !== undefined && (
                        <span className="text-slate-500">
                          {job.distanceMiles} mi away
                        </span>
                      )}
                      <span className="text-slate-400">
                        {formatTime(job.createdAt)}
                      </span>
                    </div>

                    {job.weatherNote && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        &#127786; {job.weatherNote}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:w-48">
                    {job.bidMode ? (
                      <>
                        <div className="flex gap-2">
                          <span className="text-slate-500 self-center">$</span>
                          <input
                            type="number"
                            value={bidAmount[job.id] || ""}
                            onChange={(e) =>
                              setBidAmount((prev) => ({
                                ...prev,
                                [job.id]: e.target.value,
                              }))
                            }
                            placeholder={plower?.rate?.toString() || "50"}
                            min="10"
                            max="500"
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                          />
                        </div>
                        <button
                          onClick={() => handleBid(job.id)}
                          disabled={claiming === job.id}
                          className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium py-2 px-4 rounded-lg text-sm"
                        >
                          {claiming === job.id ? "..." : "Submit Bid"}
                        </button>
                      </>
                    ) : (
                      /* BIG GREEN CLAIM & CALL BUTTON */
                      <button
                        onClick={() => handleClaimAndCall(job)}
                        disabled={claiming === job.id}
                        className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-bold py-4 px-6 rounded-lg text-lg shadow-lg transition-all hover:scale-105"
                      >
                        {claiming === job.id ? (
                          "Claiming..."
                        ) : (
                          <>
                            &#128222; CLAIM & CALL
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("plowerPhone");
              setIsLoggedIn(false);
              setPlower(null);
            }}
            className="text-sm text-slate-500 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

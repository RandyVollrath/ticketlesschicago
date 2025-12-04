"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

interface AvailabilitySlot {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string;
  end: string;
}

interface PlowerInfo {
  phone: string;
  name: string | null;
  rate: number;
  lat: number | null;
  long: number | null;
  has_truck: boolean;
  is_online: boolean;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  avg_rating: number;
  total_reviews: number;
  show_on_leaderboard: boolean;
  profile_pic_url: string | null;
  tagline: string | null;
  neighborhood: string | null;
  availability: AvailabilitySlot[];
  // Reliability tracking
  jobs_claimed: number;
  jobs_completed: number;
  jobs_cancelled_by_plower: number;
  no_show_strikes: number;
  is_verified: boolean;
  // Stripe Connect
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
  // SMS preferences
  sms_notify_threshold: number;
}

interface TodayEarnings {
  total: number;
  jobs: number;
  pending: number;
  bonuses: number;
}

// Tier calculation helper
function calculateTier(jobsCompleted: number, reliabilityScore: number): { tier: string; icon: string; color: string } {
  if (jobsCompleted >= 100 && reliabilityScore >= 0.9) {
    return { tier: "Diamond", icon: "💎", color: "text-cyan-400" };
  }
  if (jobsCompleted >= 50) {
    return { tier: "Gold", icon: "🥇", color: "text-yellow-400" };
  }
  if (jobsCompleted >= 10) {
    return { tier: "Silver", icon: "🥈", color: "text-gray-400" };
  }
  return { tier: "Bronze", icon: "🥉", color: "text-amber-600" };
}

// High-paying job threshold
const HIGH_PAY_THRESHOLD = 75;

export default function PlowerDashboard() {
  const [jobs, setJobs] = useState<OpenJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [plower, setPlower] = useState<PlowerInfo | null>(null);
  const [phone, setPhone] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [sortBy, setSortBy] = useState<"pay" | "distance" | "newest">("pay");
  const [serviceFilter, setServiceFilter] = useState<"all" | "truck" | "shovel">("all");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [todayEarnings, setTodayEarnings] = useState<TodayEarnings>({ total: 0, jobs: 0, pending: 0, bonuses: 0 });
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutSuccess, setPayoutSuccess] = useState(false);
  const [stormMode, setStormMode] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editTagline, setEditTagline] = useState("");
  const [editPicUrl, setEditPicUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editAvailability, setEditAvailability] = useState<AvailabilitySlot[]>([]);
  const [showAvailability, setShowAvailability] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapData, setHeatmapData] = useState<{
    points: Array<{ lat: number; lng: number; price: number; surgeMultiplier: number; jobId: string; neighborhood?: string }>;
    hotZones: Array<{ neighborhood: string; jobCount: number; avgPrice: number }>;
    globalSurgeMultiplier: number;
    isStormMode: boolean;
  } | null>(null);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);
  const [startingStripeOnboard, setStartingStripeOnboard] = useState(false);
  const [smsThreshold, setSmsThreshold] = useState<number>(0);
  const [savingSmsThreshold, setSavingSmsThreshold] = useState(false);

  const DAYS = [
    { key: "mon" as const, label: "Mon" },
    { key: "tue" as const, label: "Tue" },
    { key: "wed" as const, label: "Wed" },
    { key: "thu" as const, label: "Thu" },
    { key: "fri" as const, label: "Fri" },
    { key: "sat" as const, label: "Sat" },
    { key: "sun" as const, label: "Sun" },
  ];

  // Track seen job IDs for new job alerts
  const seenJobIds = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  // Initialize audio for high-pay alerts
  useEffect(() => {
    audioRef.current = new Audio("/sounds/cha-ching.mp3");
    audioRef.current.volume = 0.7;
  }, []);

  // Alert for high-paying jobs
  const alertHighPayJob = useCallback((job: OpenJob) => {
    // Play sound
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Audio autoplay blocked, ignore
      });
    }

    // Vibrate (mobile)
    if ("vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }

    // Show notification if permitted
    if (Notification.permission === "granted") {
      new Notification(`$${job.maxPrice} Job Available!`, {
        body: job.address,
        icon: "/icon-192.png",
        tag: job.id,
        requireInteraction: true,
      });
    }
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fetch heatmap data
  const fetchHeatmap = useCallback(async () => {
    setLoadingHeatmap(true);
    try {
      const res = await fetch("/api/jobs/heatmap");
      const data = await res.json();
      setHeatmapData(data);
      if (data.isStormMode) {
        setStormMode(true);
      }
    } catch (err) {
      console.error("Error fetching heatmap:", err);
    }
    setLoadingHeatmap(false);
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!plower || !isOnline) return;

    try {
      const params = new URLSearchParams({ sort: sortBy });
      if (plower.lat && plower.long) {
        params.set("lat", plower.lat.toString());
        params.set("long", plower.long.toString());
      }
      params.set("maxRate", plower.rate.toString());
      params.set("phone", plower.phone);
      if (plower.has_truck) {
        params.set("hasTruck", "true");
      }

      const res = await fetch(`/api/jobs/open?${params}`);
      const data = await res.json();
      const newJobs: OpenJob[] = data.jobs || [];

      // Check for new high-paying jobs
      for (const job of newJobs) {
        if (!seenJobIds.current.has(job.id)) {
          seenJobIds.current.add(job.id);
          // Alert if high-paying (>$75) and online
          if (job.maxPrice && job.maxPrice >= HIGH_PAY_THRESHOLD && isOnline) {
            alertHighPayJob(job);
          }
        }
      }

      setJobs(newJobs);

      // Check for storm mode
      if (newJobs.some(j => j.surgeMultiplier >= 1.5)) {
        setStormMode(true);
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
    }
    setLoading(false);
  }, [plower, sortBy, isOnline, alertHighPayJob]);

  // Fetch today's earnings
  const fetchTodayEarnings = useCallback(async () => {
    if (!plower) return;

    try {
      const res = await fetch(`/api/plower/earnings?phone=${encodeURIComponent(plower.phone)}`);
      const data = await res.json();
      setTodayEarnings({
        total: data.todayTotal || 0,
        jobs: data.todayJobs || 0,
        pending: data.pendingPayout || 0,
        bonuses: data.todayBonuses || 0,
      });
    } catch (err) {
      console.error("Error fetching earnings:", err);
    }
  }, [plower]);

  // Toggle online/offline
  const toggleOnline = async () => {
    if (!plower) return;

    try {
      const res = await fetch("/api/plower/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: plower.phone,
          isOnline: !isOnline,
        }),
      });

      if (res.ok) {
        setIsOnline(!isOnline);
        if (!isOnline) {
          // Going online - clear seen jobs to enable alerts
          seenJobIds.current.clear();
        }
      }
    } catch {
      setError("Failed to update status");
    }
  };

  // Save profile
  const saveProfile = async () => {
    if (!plower) return;

    setSavingProfile(true);
    try {
      const res = await fetch("/api/plower/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: plower.phone,
          profilePicUrl: editPicUrl || null,
          tagline: editTagline || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPlower(data.shoveler);
        setShowProfileEdit(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save profile");
      }
    } catch {
      setError("Network error");
    }
    setSavingProfile(false);
  };

  // Save availability
  const saveAvailability = async () => {
    if (!plower) return;

    setSavingProfile(true);
    try {
      const res = await fetch("/api/plower/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: plower.phone,
          availability: editAvailability,
        }),
      });

      if (res.ok) {
        setPlower({ ...plower, availability: editAvailability });
        setShowAvailability(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save availability");
      }
    } catch {
      setError("Network error");
    }
    setSavingProfile(false);
  };

  // Add availability slot
  const addAvailabilitySlot = (day: AvailabilitySlot["day"]) => {
    setEditAvailability((prev) => [
      ...prev,
      { day, start: "08:00", end: "18:00" },
    ]);
  };

  // Remove availability slot
  const removeAvailabilitySlot = (index: number) => {
    setEditAvailability((prev) => prev.filter((_, i) => i !== index));
  };

  // Update availability slot
  const updateAvailabilitySlot = (
    index: number,
    field: "start" | "end",
    value: string
  ) => {
    setEditAvailability((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot))
    );
  };

  // Request payout
  const requestPayout = async () => {
    if (!plower || todayEarnings.pending <= 0) return;

    setRequestingPayout(true);
    try {
      const res = await fetch("/api/plower/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: plower.phone,
          amount: todayEarnings.pending,
        }),
      });

      if (res.ok) {
        setPayoutSuccess(true);
        setTimeout(() => setPayoutSuccess(false), 3000);
        fetchTodayEarnings();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to request payout");
      }
    } catch {
      setError("Network error");
    }
    setRequestingPayout(false);
  };

  // Start Stripe Connect onboarding
  const startStripeOnboarding = async () => {
    if (!plower) return;

    setStartingStripeOnboard(true);
    setError(null);

    try {
      const res = await fetch("/api/plower/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: plower.phone }),
      });

      const data = await res.json();

      if (res.ok && data.onboardingUrl) {
        // Redirect to Stripe onboarding
        window.location.href = data.onboardingUrl;
      } else if (data.alreadyOnboarded) {
        // Already set up, refresh plower data
        setPlower({ ...plower, stripe_connect_onboarded: true });
      } else {
        setError(data.error || "Failed to start payment setup");
      }
    } catch {
      setError("Network error");
    }
    setStartingStripeOnboard(false);
  };

  // Save SMS notification threshold
  const saveSmsThreshold = async (threshold: number) => {
    if (!plower) return;

    setSavingSmsThreshold(true);
    try {
      const res = await fetch("/api/plower/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: plower.phone,
          smsNotifyThreshold: threshold,
        }),
      });

      if (res.ok) {
        setPlower({ ...plower, sms_notify_threshold: threshold });
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save preference");
      }
    } catch {
      setError("Network error");
    }
    setSavingSmsThreshold(false);
  };

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
        setIsOnline(data.shoveler.is_online || false);
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
            setIsOnline(data.shoveler.is_online || false);
            setSmsThreshold(data.shoveler.sms_notify_threshold || 0);
          }
        })
        .catch(console.error);
    }
  }, []);

  // Check for Stripe return URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get("stripe");
    if (stripeStatus === "success" && plower) {
      // Refresh plower data to get updated Stripe status
      fetch(`/api/shovelers/add?phone=${plower.phone}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.shoveler) {
            setPlower(data.shoveler);
          }
        })
        .catch(console.error);
      // Clean up URL
      window.history.replaceState({}, "", "/plower/dashboard");
    }
  }, [plower?.phone]);

  // Fetch jobs and earnings when logged in
  useEffect(() => {
    if (!isLoggedIn || !plower) return;

    fetchTodayEarnings();

    if (isOnline) {
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
    } else {
      setJobs([]);
      setLoading(false);
    }
  }, [isLoggedIn, plower, isOnline, fetchJobs, fetchTodayEarnings]);

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
    <main className={`min-h-screen ${stormMode ? "bg-gradient-to-b from-purple-900 to-slate-900" : "bg-slate-100 dark:bg-slate-900"}`}>
      <div className="container mx-auto px-4 py-6">
        {/* Suspension Banner */}
        {plower && (plower.no_show_strikes || 0) >= 3 && (
          <div className="mb-4 p-4 bg-red-600 rounded-xl text-white text-center">
            <span className="font-bold text-lg">Account Suspended</span>
            <p className="text-sm opacity-90">
              Your account has been temporarily suspended due to {plower.no_show_strikes} no-shows.
              Contact support to appeal.
            </p>
          </div>
        )}

        {/* No-Show Warning Banner */}
        {plower && (plower.no_show_strikes || 0) > 0 && (plower.no_show_strikes || 0) < 3 && (
          <div className="mb-4 p-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-800 dark:text-amber-200">
            <span className="font-medium">Warning:</span> You have {plower.no_show_strikes} no-show strike(s).
            {3 - (plower.no_show_strikes || 0)} more and your account will be suspended.
          </div>
        )}

        {/* Storm Mode Banner */}
        {stormMode && (
          <div className="mb-4 p-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl text-white text-center animate-pulse">
            <span className="text-2xl mr-2">&#127786;</span>
            <span className="font-bold text-lg">STORM MODE ACTIVE</span>
            <span className="text-2xl ml-2">&#127786;</span>
            <p className="text-sm opacity-90">Surge pricing in effect - earn more per job!</p>
          </div>
        )}

        {/* Stripe Connect Onboarding Banner */}
        {plower && !plower.stripe_connect_onboarded && (
          <div className="mb-4 p-4 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl text-white">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">&#128179;</span>
                <div>
                  <p className="font-bold">Set up payouts with Stripe</p>
                  <p className="text-sm opacity-90">
                    Receive your earnings directly to your bank account
                  </p>
                </div>
              </div>
              <button
                onClick={startStripeOnboarding}
                disabled={startingStripeOnboard}
                className="bg-white text-indigo-700 font-bold py-2 px-6 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {startingStripeOnboard ? "Loading..." : "Set Up Now"}
              </button>
            </div>
          </div>
        )}

        {/* Stripe Connect Success Banner */}
        {plower?.stripe_connect_onboarded && (
          <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-xl text-green-800 dark:text-green-200 flex items-center gap-2">
            <span>&#9989;</span>
            <span>Stripe payments are set up! You can now receive direct deposits.</span>
          </div>
        )}

        {/* Profile Edit Modal */}
        {showProfileEdit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">
                Edit Profile
              </h2>

              <div className="space-y-4">
                {/* Profile Pic URL */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Profile Picture URL
                  </label>
                  <input
                    type="url"
                    value={editPicUrl}
                    onChange={(e) => setEditPicUrl(e.target.value)}
                    placeholder="https://example.com/your-photo.jpg"
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Paste a link to your photo (upload to imgur, etc.)
                  </p>
                </div>

                {/* Tagline */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tagline (60 chars max)
                  </label>
                  <input
                    type="text"
                    value={editTagline}
                    onChange={(e) => setEditTagline(e.target.value.slice(0, 60))}
                    placeholder="e.g. 'College student, fast & reliable!'"
                    maxLength={60}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {editTagline.length}/60 - Shows on job cards customers see
                  </p>
                </div>

                {/* Preview */}
                {(editPicUrl || editTagline) && (
                  <div className="p-3 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    <p className="text-xs text-slate-500 mb-2">Preview:</p>
                    <div className="flex items-center gap-3">
                      {editPicUrl ? (
                        <img
                          src={editPicUrl}
                          alt="Preview"
                          className="w-10 h-10 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-300 flex items-center justify-center">
                          &#128119;
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-800 dark:text-white text-sm">
                          {plower?.name || "Plower"}
                        </p>
                        {editTagline && (
                          <p className="text-xs text-slate-500 italic">"{editTagline}"</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowProfileEdit(false)}
                    className="flex-1 py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="flex-1 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white font-medium"
                  >
                    {savingProfile ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Availability Modal */}
        {showAvailability && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">
                Set Your Availability
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                Let customers know when you&apos;re available. Leave empty to show as always available.
              </p>

              <div className="space-y-4">
                {DAYS.map((day) => {
                  const daySlots = editAvailability.filter((s) => s.day === day.key);
                  return (
                    <div key={day.key} className="border-b border-slate-200 dark:border-slate-700 pb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {day.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => addAvailabilitySlot(day.key)}
                          className="text-sm text-sky-600 hover:underline"
                        >
                          + Add slot
                        </button>
                      </div>
                      {daySlots.length === 0 ? (
                        <p className="text-xs text-slate-400">Not available</p>
                      ) : (
                        <div className="space-y-2">
                          {editAvailability.map((slot, idx) => {
                            if (slot.day !== day.key) return null;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <input
                                  type="time"
                                  value={slot.start}
                                  onChange={(e) => updateAvailabilitySlot(idx, "start", e.target.value)}
                                  className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                />
                                <span className="text-slate-500">to</span>
                                <input
                                  type="time"
                                  value={slot.end}
                                  onChange={(e) => updateAvailabilitySlot(idx, "end", e.target.value)}
                                  className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeAvailabilitySlot(idx)}
                                  className="text-red-500 hover:text-red-700 text-sm"
                                >
                                  &times;
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-4 mt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setShowAvailability(false)}
                  className="flex-1 py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAvailability}
                  disabled={savingProfile}
                  className="flex-1 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white font-medium"
                >
                  {savingProfile ? "Saving..." : "Save Schedule"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header with Online Toggle */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            {/* Profile Pic */}
            <div
              onClick={() => {
                setEditTagline(plower?.tagline || "");
                setEditPicUrl(plower?.profile_pic_url || "");
                setShowProfileEdit(true);
              }}
              className="cursor-pointer relative"
            >
              {plower?.profile_pic_url ? (
                <img
                  src={plower.profile_pic_url}
                  alt="Profile"
                  className="w-14 h-14 rounded-full object-cover border-2 border-white shadow"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-2xl">
                  &#128119;
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 text-xs bg-white dark:bg-slate-700 rounded-full px-1 shadow">
                &#9998;
              </span>
            </div>
            <div>
              <Link href="/" className="text-sky-600 text-sm hover:underline">
                &larr; Back
              </Link>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                {isOnline ? "Available Jobs" : "You're Offline"}
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                {plower?.name || "Plower"} - ${plower?.rate}/job
                {plower?.has_truck && <span className="ml-2">&#128668; Truck</span>}
                {plower?.avg_rating && plower.avg_rating > 0 && (
                  <span className="ml-2">&#11088; {plower.avg_rating.toFixed(1)}</span>
                )}
              </p>
              {plower?.tagline && (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic">"{plower.tagline}"</p>
              )}
            </div>
          </div>

          {/* GO ONLINE / GO OFFLINE Toggle */}
          <button
            onClick={toggleOnline}
            className={`px-6 py-3 rounded-full font-bold text-lg shadow-lg transition-all transform hover:scale-105 ${
              isOnline
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-red-500 hover:bg-red-600 text-white"
            }`}
          >
            {isOnline ? (
              <>&#128994; GO OFFLINE</>
            ) : (
              <>&#128308; GO ONLINE</>
            )}
          </button>
        </div>

        {/* Earnings & Stats Widget */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Today's Earnings */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Earned Today</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              ${todayEarnings.total.toFixed(0)}
            </p>
            <p className="text-xs text-slate-400">
              {todayEarnings.jobs} jobs
              {todayEarnings.bonuses > 0 && (
                <span className="ml-1 text-green-500">+${todayEarnings.bonuses} bonuses</span>
              )}
            </p>
          </div>

          {/* Tier & Reliability */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Your Tier</p>
            {(() => {
              const jobsCompleted = plower?.jobs_completed || 0;
              const jobsClaimed = plower?.jobs_claimed || 0;
              const reliability = jobsClaimed > 0 ? jobsCompleted / jobsClaimed : 1;
              const tierInfo = calculateTier(jobsCompleted, reliability);
              return (
                <>
                  <p className={`text-2xl font-bold ${tierInfo.color}`}>
                    {tierInfo.icon} {tierInfo.tier}
                  </p>
                  <p className="text-xs text-slate-400">
                    {jobsCompleted} completed | {Math.round(reliability * 100)}% reliability
                  </p>
                </>
              );
            })()}
          </div>

          {/* Pending Payout */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Pending Payout</p>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              ${todayEarnings.pending.toFixed(0)}
            </p>
            {todayEarnings.pending > 0 && (
              <button
                onClick={requestPayout}
                disabled={requestingPayout}
                className="mt-2 w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-medium py-2 px-4 rounded-lg text-sm"
              >
                {requestingPayout ? "Requesting..." : payoutSuccess ? "Requested!" : "Request Payout"}
              </button>
            )}
          </div>

          {/* SMS Notification Preferences */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">SMS Alerts</p>
            <div className="text-sm">
              <label className="block text-slate-700 dark:text-slate-300 mb-1">
                Only notify for jobs over:
              </label>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">$</span>
                <select
                  value={smsThreshold}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setSmsThreshold(val);
                    saveSmsThreshold(val);
                  }}
                  disabled={savingSmsThreshold}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                >
                  <option value={0}>All jobs</option>
                  <option value={30}>$30+</option>
                  <option value={50}>$50+</option>
                  <option value={75}>$75+</option>
                  <option value={100}>$100+</option>
                </select>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Reduce SMS noise by only getting alerts for higher-paying jobs
              </p>
            </div>
          </div>
        </div>

        {/* Only show job controls when online */}
        {isOnline && (
          <>
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              {/* View Toggle: List vs Heatmap */}
              <div className="flex bg-slate-200 dark:bg-slate-700 rounded-lg p-1 mr-4">
                <button
                  onClick={() => setShowHeatmap(false)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    !showHeatmap
                      ? "bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => {
                    setShowHeatmap(true);
                    if (!heatmapData) fetchHeatmap();
                  }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    showHeatmap
                      ? "bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  Map
                </button>
              </div>

              {/* Sort buttons - only show in list view */}
              {!showHeatmap && (["pay", "distance", "newest"] as const).map((sort) => (
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

            {/* Service Type Filter - only show in list view */}
            {!showHeatmap && (
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
            )}
          </>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Heatmap View */}
        {isOnline && showHeatmap && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 mb-6">
            {loadingHeatmap ? (
              <div className="text-center py-12 text-slate-500">Loading map data...</div>
            ) : !heatmapData ? (
              <div className="text-center py-12 text-slate-500">No data available</div>
            ) : (
              <>
                {/* Storm Mode Banner in Heatmap */}
                {heatmapData.isStormMode && (
                  <div className="mb-4 p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg text-white text-center">
                    <span className="font-bold">Storm Mode: {heatmapData.globalSurgeMultiplier}x Surge Active</span>
                  </div>
                )}

                {/* Hot Zones */}
                {heatmapData.hotZones.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Hot Zones (3+ jobs)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {heatmapData.hotZones.map((zone) => (
                        <div
                          key={zone.neighborhood}
                          className="px-3 py-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg"
                        >
                          <span className="text-red-700 dark:text-red-300 font-medium">
                            {zone.neighborhood}
                          </span>
                          <span className="text-red-600 dark:text-red-400 text-sm ml-2">
                            {zone.jobCount} jobs | ~${zone.avgPrice} avg
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Simple Grid Map Visualization */}
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Open Jobs ({heatmapData.points.length} available)
                  </h3>
                  <div className="relative bg-slate-100 dark:bg-slate-700 rounded-lg p-4 min-h-[300px]">
                    {/* Chicago area bounds for positioning */}
                    {heatmapData.points.map((point, idx) => {
                      // Normalize lat/lng to percentages within Chicago area
                      // Chicago roughly spans 41.64 to 42.02 lat, -87.94 to -87.52 lng
                      const latMin = 41.64, latMax = 42.02;
                      const lngMin = -87.94, lngMax = -87.52;
                      const top = ((latMax - point.lat) / (latMax - latMin)) * 100;
                      const left = ((point.lng - lngMin) / (lngMax - lngMin)) * 100;
                      const surgeColor = point.surgeMultiplier > 1.5 ? "bg-red-500" : point.surgeMultiplier > 1 ? "bg-orange-500" : "bg-green-500";

                      return (
                        <div
                          key={point.jobId}
                          className={`absolute w-4 h-4 rounded-full ${surgeColor} border-2 border-white shadow cursor-pointer transform -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform`}
                          style={{ top: `${Math.min(95, Math.max(5, top))}%`, left: `${Math.min(95, Math.max(5, left))}%` }}
                          title={`$${point.price}${point.surgeMultiplier > 1 ? ` (${point.surgeMultiplier}x surge)` : ""}${point.neighborhood ? ` - ${point.neighborhood}` : ""}`}
                        >
                          <span className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            ${point.price}
                          </span>
                        </div>
                      );
                    })}
                    {heatmapData.points.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                        No jobs with location data
                      </div>
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-green-500"></span> Normal
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-orange-500"></span> Light Surge
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-red-500"></span> High Surge
                    </span>
                  </div>
                </div>

                <button
                  onClick={fetchHeatmap}
                  className="w-full py-2 text-sm text-sky-600 hover:text-sky-700 dark:text-sky-400"
                >
                  Refresh Map Data
                </button>
              </>
            )}
          </div>
        )}

        {/* Job List - only show when online and not in heatmap view */}
        {!isOnline ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">&#128564;</div>
            <p className="text-slate-600 dark:text-slate-400 text-lg">
              You're currently offline
            </p>
            <p className="text-slate-500 dark:text-slate-500 text-sm mt-2">
              Go online to see available jobs and start earning!
            </p>
          </div>
        ) : showHeatmap ? null : loading ? (
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
                className={`bg-white dark:bg-slate-800 rounded-xl shadow p-4 sm:p-6 ${
                  job.maxPrice && job.maxPrice >= HIGH_PAY_THRESHOLD
                    ? "ring-2 ring-green-500 ring-offset-2 dark:ring-offset-slate-900"
                    : ""
                }`}
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
                      {/* HIGH PAY badge */}
                      {job.maxPrice && job.maxPrice >= HIGH_PAY_THRESHOLD && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded font-bold">
                          &#128176; HIGH PAY
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
                        <span className={`font-medium text-lg ${
                          job.maxPrice >= HIGH_PAY_THRESHOLD
                            ? "text-green-600 dark:text-green-400"
                            : "text-green-600 dark:text-green-400"
                        }`}>
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

        {/* Footer Links */}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button
            onClick={() => {
              setEditAvailability(plower?.availability || []);
              setShowAvailability(true);
            }}
            className="text-sm text-sky-600 hover:underline"
          >
            &#128197; Set Availability
          </button>
          <Link
            href="/leaderboard"
            className="text-sm text-sky-600 hover:underline"
          >
            &#127942; Leaderboard
          </Link>
          <Link
            href="/jobs"
            className="text-sm text-sky-600 hover:underline"
          >
            &#128270; Browse Jobs
          </Link>
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

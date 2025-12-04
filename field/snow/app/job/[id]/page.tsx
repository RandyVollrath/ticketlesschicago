"use client";

import { useEffect, useState, useRef, use } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface ChatMessage {
  sender: "customer" | "shoveler";
  sender_phone: string;
  message: string;
  timestamp: string;
}

interface JobDetails {
  id: string;
  shortId: string;
  address: string;
  description: string | null;
  status: string;
  maxPrice: number | null;
  customerPhone: string;
  shovelerPhone: string | null;
  lat: number | null;
  long: number | null;
}

interface Bid {
  shoveler_phone: string;
  shoveler_name?: string;
  amount: number;
  timestamp: string;
}

interface PlowerLocation {
  lat: number;
  long: number;
  name: string | null;
  hasTruck: boolean;
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = use(params);
  const [job, setJob] = useState<JobDetails | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [role, setRole] = useState<"customer" | "shoveler" | null>(null);
  const [phone, setPhone] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingBid, setSelectingBid] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Review state
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [tipAmount, setTipAmount] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // Live map state
  const [plowerLocation, setPlowerLocation] = useState<PlowerLocation | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Check URL params for phone
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const phoneParam = urlParams.get("phone");
    if (phoneParam) {
      setPhone(phoneParam);
      authenticateUser(phoneParam);
    }
  }, []);

  const authenticateUser = async (userPhone: string) => {
    let normalizedPhone = userPhone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    try {
      const res = await fetch(
        `/api/chat/send/${jobId}?phone=${encodeURIComponent(normalizedPhone)}`
      );
      const data = await res.json();

      if (res.ok) {
        setJob(data.job);
        setChatHistory(data.chatHistory || []);
        setRole(data.role);
        setIsAuthenticated(true);
        setPhone(normalizedPhone);
        setError(null);

        // Fetch bids if customer viewing pending bid job
        if (data.role === "customer" && data.job.status === "pending") {
          fetchBids();
        }

        // Show review prompt for completed jobs (customer only)
        if (data.role === "customer" && data.job.status === "completed" && !data.hasReview) {
          setShowReview(true);
        }
      } else {
        setError(data.error || "Access denied");
      }
    } catch {
      setError("Failed to load job");
    }
    setLoading(false);
  };

  const fetchBids = async () => {
    try {
      const res = await fetch(`/api/jobs/list?id=${jobId}`);
      const data = await res.json();
      if (data.jobs?.[0]?.bids) {
        setBids(data.jobs[0].bids);
      }
    } catch {
      console.error("Failed to fetch bids");
    }
  };

  const handleLogin = () => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }
    authenticateUser(`+1${phoneDigits}`);
  };

  // Send message
  const handleSend = async () => {
    if (!message.trim() || !isAuthenticated) return;

    setSending(true);
    try {
      const res = await fetch(`/api/chat/send/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderPhone: phone,
          message: message.trim(),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setChatHistory(data.chatHistory);
        setMessage("");
      } else {
        setError(data.error || "Failed to send message");
      }
    } catch {
      setError("Network error");
    }
    setSending(false);
  };

  // Select bid (for customer)
  const handleSelectBid = async (bidIndex: number) => {
    setSelectingBid(true);
    try {
      const bid = bids[bidIndex];
      const res = await fetch(`/api/jobs/claim/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shovelerPhone: bid.shoveler_phone,
          fromBid: true,
          bidIndex,
        }),
      });

      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to select bid");
      }
    } catch {
      setError("Network error");
    }
    setSelectingBid(false);
  };

  // Submit review
  const handleSubmitReview = async () => {
    if (reviewRating === 0) {
      setError("Please select a rating");
      return;
    }

    setSubmittingReview(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          customerPhone: phone,
          shovelerPhone: job?.shovelerPhone,
          rating: reviewRating,
          tipAmount: tipAmount ? parseFloat(tipAmount) : 0,
        }),
      });

      if (res.ok) {
        setReviewSubmitted(true);
        setShowReview(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to submit review");
      }
    } catch {
      setError("Network error");
    }
    setSubmittingReview(false);
  };

  // Set up realtime
  useEffect(() => {
    if (!isAuthenticated) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const channel = supabase
        .channel(`job-${jobId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
          (payload) => {
            const updated = payload.new as { chat_history?: ChatMessage[]; bids?: Bid[]; status?: string };
            if (updated.chat_history) {
              setChatHistory(updated.chat_history);
            }
            if (updated.bids) {
              setBids(updated.bids);
            }
            if (updated.status && job) {
              setJob({ ...job, status: updated.status });
              // Show review when job completes
              if (updated.status === "completed" && role === "customer") {
                setShowReview(true);
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      const interval = setInterval(() => {
        authenticateUser(phone);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, jobId, phone, job, role]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Simulate plower location for live map (fake avatars for now)
  useEffect(() => {
    if (role !== "customer" || !job?.lat || !job?.long) return;
    if (job.status !== "claimed" && job.status !== "in_progress") return;

    // Fake plower moving toward job location
    const fakeNames = ["Mike", "Sarah", "Carlos", "Lisa", "Dave"];
    const fakeName = fakeNames[Math.floor(Math.random() * fakeNames.length)];

    // Start position (random offset from job)
    let plowerLat = job.lat + (Math.random() - 0.5) * 0.02;
    let plowerLong = job.long + (Math.random() - 0.5) * 0.02;

    setPlowerLocation({
      lat: plowerLat,
      long: plowerLong,
      name: fakeName,
      hasTruck: Math.random() > 0.5,
    });

    // Move plower toward job every 3 seconds
    const interval = setInterval(() => {
      if (!job.lat || !job.long) return;

      plowerLat += (job.lat - plowerLat) * 0.1;
      plowerLong += (job.long - plowerLong) * 0.1;

      setPlowerLocation((prev) =>
        prev ? { ...prev, lat: plowerLat, long: plowerLong } : null
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [role, job?.status, job?.lat, job?.long]);

  // Login screen
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
            Job #{jobId.substring(0, 8)}
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mb-6">
            Enter your phone to view this job
          </p>

          {loading ? (
            <p className="text-center text-slate-500">Loading...</p>
          ) : (
            <div className="space-y-4">
              <input
                type="tel"
                value={formatPhone(phone.replace("+1", ""))}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(312) 555-1234"
                className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                onClick={handleLogin}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-6 rounded-lg"
              >
                View Job
              </button>

              <Link href="/" className="block text-center text-sm text-slate-500 hover:underline">
                Back to home
              </Link>
            </div>
          )}
        </div>
      </main>
    );
  }

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    claimed: "bg-blue-100 text-blue-800",
    in_progress: "bg-purple-100 text-purple-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <Link href={role === "shoveler" ? "/plower/dashboard" : "/"} className="text-sky-600 text-sm hover:underline">
              &larr; Back
            </Link>
            <h1 className="font-bold text-slate-800 dark:text-white">
              Job #{job?.shortId}
            </h1>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[job?.status || "pending"]}`}>
            {job?.status?.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Job Details */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4">
        <div className="container mx-auto">
          <p className="font-medium text-slate-800 dark:text-white">{job?.address}</p>
          {job?.description && (
            <p className="text-sm text-slate-600 dark:text-slate-400">{job.description}</p>
          )}
          {job?.maxPrice && (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium mt-1">
              Budget: ${job.maxPrice}
            </p>
          )}
        </div>
      </div>

      {/* Live Map for customer (claimed/in_progress jobs) */}
      {role === "customer" && (job?.status === "claimed" || job?.status === "in_progress") && plowerLocation && (
        <div className="bg-slate-200 dark:bg-slate-700 p-4 border-b border-slate-300 dark:border-slate-600">
          <div className="container mx-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="animate-pulse text-green-500 text-lg">&#128994;</span>
              <span className="font-medium text-slate-800 dark:text-white">
                {plowerLocation.name} is on the way
                {plowerLocation.hasTruck && <span className="ml-1">&#128668;</span>}
              </span>
            </div>
            <div
              ref={mapRef}
              className="relative bg-slate-300 dark:bg-slate-600 rounded-xl h-40 overflow-hidden"
              style={{
                backgroundImage: "url('https://api.mapbox.com/styles/v1/mapbox/dark-v10/static/-87.63,41.88,12,0/400x160?access_token=placeholder')",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {/* Job marker */}
              <div
                className="absolute w-6 h-6 bg-sky-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white text-xs"
                style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
              >
                &#127968;
              </div>
              {/* Plower marker (animated position) */}
              <div
                className="absolute w-8 h-8 bg-green-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white text-sm animate-bounce"
                style={{
                  left: `${50 + (plowerLocation.long - (job?.long || 0)) * 500}%`,
                  top: `${50 - (plowerLocation.lat - (job?.lat || 0)) * 500}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {plowerLocation.hasTruck ? "&#128668;" : "&#128119;"}
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              Live tracking - your plower will arrive soon!
            </p>
          </div>
        </div>
      )}

      {/* Review Modal for completed jobs */}
      {showReview && role === "customer" && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-b border-green-200 dark:border-green-800 p-6">
          <div className="container mx-auto max-w-md">
            <h2 className="font-bold text-lg text-slate-800 dark:text-white mb-2">
              Job Complete! &#127881;
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              How was your experience?
            </p>

            {/* Star Rating */}
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setReviewRating(star)}
                  className={`text-4xl transition-transform hover:scale-110 ${
                    star <= reviewRating ? "text-yellow-400" : "text-slate-300 dark:text-slate-600"
                  }`}
                >
                  &#11088;
                </button>
              ))}
            </div>

            {/* Tip Amount */}
            <div className="mb-4">
              <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                Add a tip? (100% goes to plower)
              </label>
              <div className="flex gap-2">
                {["5", "10", "20"].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setTipAmount(amount)}
                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                      tipAmount === amount
                        ? "bg-green-500 text-white"
                        : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    ${amount}
                  </button>
                ))}
                <input
                  type="number"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  placeholder="Other"
                  className="w-20 px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-center"
                />
              </div>
            </div>

            <button
              onClick={handleSubmitReview}
              disabled={submittingReview || reviewRating === 0}
              className="w-full bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg"
            >
              {submittingReview ? "Submitting..." : tipAmount ? `Submit Review & Send $${tipAmount} Tip` : "Submit Review"}
            </button>

            <button
              onClick={() => setShowReview(false)}
              className="w-full text-slate-500 text-sm mt-2 hover:underline"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* Review Submitted Confirmation */}
      {reviewSubmitted && (
        <div className="bg-green-100 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 p-4 text-center">
          <p className="text-green-800 dark:text-green-200 font-medium">
            &#10004; Thank you for your review!
          </p>
        </div>
      )}

      {/* Bids Section (for customer on pending bid jobs) */}
      {role === "customer" && job?.status === "pending" && bids.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 p-4">
          <div className="container mx-auto">
            <h2 className="font-medium text-slate-800 dark:text-white mb-3">
              Select a Bid ({bids.length} received)
            </h2>
            <div className="grid gap-2">
              {bids.map((bid, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-lg"
                >
                  <div>
                    <span className="font-medium text-slate-800 dark:text-white">
                      ${bid.amount}
                    </span>
                    {bid.shoveler_name && (
                      <span className="text-slate-500 ml-2">{bid.shoveler_name}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleSelectBid(idx)}
                    disabled={selectingBid}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white px-4 py-1.5 rounded-lg text-sm"
                  >
                    {selectingBid ? "..." : "Select"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chat Section */}
      {["claimed", "in_progress", "completed"].includes(job?.status || "") && (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="container mx-auto max-w-2xl space-y-4">
              {chatHistory.length === 0 ? (
                <p className="text-center text-slate-500 py-8">
                  No messages yet. Start the conversation!
                </p>
              ) : (
                chatHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.sender === role ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                        msg.sender === role
                          ? "bg-sky-600 text-white rounded-br-sm"
                          : "bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-bl-sm"
                      }`}
                    >
                      <p className="text-sm">{msg.message}</p>
                      <p className={`text-xs mt-1 ${msg.sender === role ? "text-sky-200" : "text-slate-400"}`}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Message Input */}
          {job?.status !== "completed" && (
            <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 p-4">
              <div className="container mx-auto max-w-2xl flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !message.trim()}
                  className="bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white px-6 py-2 rounded-full font-medium"
                >
                  {sending ? "..." : "Send"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pending job message */}
      {job?.status === "pending" && bids.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-4xl mb-4">&#10052;</div>
            <p className="text-slate-600 dark:text-slate-400">
              Waiting for plowers to claim or bid on this job...
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-20 left-4 right-4 bg-red-100 border border-red-300 rounded-lg p-3 text-red-800 text-sm text-center">
          {error}
        </div>
      )}
    </main>
  );
}

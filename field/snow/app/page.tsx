"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      setStatus("error");
      setMessage("Please enter a valid 10-digit phone number.");
      return;
    }

    try {
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `+1${phoneDigits}`,
          address,
          description: description || undefined,
          maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage(`Job #${data.job.shortId} created! Sent to ${data.job.shovelerCount} shoveler(s). Check your phone for updates.`);
        setPhone("");
        setAddress("");
        setDescription("");
        setMaxPrice("");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-slate-800 dark:text-white mb-4">
            SnowSOS
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 dark:text-slate-300 mb-2">
            Chicago Snow Rescue
          </p>
          <p className="text-slate-500 dark:text-slate-400 mb-8">
            Get your driveway cleared in minutes, not hours
          </p>

          {/* Main CTA Box */}
          <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 md:p-12 mb-12">
            {status === "success" ? (
              <div className="text-center">
                <div className="text-6xl mb-4">&#9989;</div>
                <h2 className="text-2xl font-bold text-green-600 dark:text-green-400 mb-2">
                  Job Posted!
                </h2>
                <p className="text-slate-600 dark:text-slate-300 mb-6">{message}</p>
                <button
                  onClick={() => {
                    setStatus("idle");
                    setShowForm(false);
                  }}
                  className="text-sky-600 dark:text-sky-400 hover:underline"
                >
                  Request another job
                </button>
              </div>
            ) : showForm ? (
              <form onSubmit={handleSubmit} className="text-left space-y-4">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4 text-center">
                  Request Snow Removal
                </h2>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Your Phone *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    placeholder="(312) 555-1234"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Address *
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, Chicago"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    What needs clearing?
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Driveway and sidewalk"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Your Budget (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      type="number"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      placeholder="50"
                      min="10"
                      max="500"
                      className="w-full pl-8 pr-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Setting a budget helps match you with shovelers in your price range
                  </p>
                </div>

                {status === "error" && (
                  <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
                    <p className="text-red-800 dark:text-red-200 text-sm">{message}</p>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 py-3 px-6 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white font-semibold py-3 px-6 rounded-lg"
                  >
                    {status === "loading" ? "Posting..." : "Post Job"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="text-6xl mb-6">
                  <span role="img" aria-label="snowflake">&#10052;</span>
                </div>
                <p className="text-lg text-slate-600 dark:text-slate-300 mb-6">
                  Need your driveway or sidewalk cleared?
                </p>

                {/* SMS Option */}
                <div className="bg-sky-50 dark:bg-slate-600 rounded-xl p-6 mb-4">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                    Text your address + budget to:
                  </p>
                  <a
                    href="sms:+18335623866?body=123 Main St, driveway $50"
                    className="text-3xl md:text-4xl font-bold text-sky-600 dark:text-sky-400 font-mono hover:underline"
                  >
                    (833) 562-3866
                  </a>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Example: &quot;123 Main St, driveway $50&quot;
                  </p>
                </div>

                <div className="text-slate-400 dark:text-slate-500 my-4">or</div>

                {/* Web Form Option */}
                <button
                  onClick={() => setShowForm(true)}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  Request Online
                </button>
              </>
            )}
          </div>

          {/* How It Works */}
          <div className="grid md:grid-cols-3 gap-6 text-left">
            {[
              { num: 1, title: "Request Help", desc: "Text or submit your address and what needs clearing. Add a budget to attract shovelers." },
              { num: 2, title: "Nearby Shovelers Notified", desc: "We instantly alert available shovelers within 10 miles. First to claim wins!" },
              { num: 3, title: "Track Progress", desc: "Get texts when your shoveler claims, starts, and completes the job." },
            ].map((step) => (
              <div key={step.num} className="bg-white dark:bg-slate-700 rounded-xl p-6 shadow-lg">
                <div className="w-10 h-10 bg-sky-100 dark:bg-sky-900 rounded-full flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold mb-4">
                  {step.num}
                </div>
                <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-2">
                  {step.title}
                </h3>
                <p className="text-slate-600 dark:text-slate-300 text-sm">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Shoveler CTA */}
        <div className="text-center mt-16">
          <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-8 max-w-xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              Want to earn money shoveling?
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-4">
              Set your rate, get matched with nearby customers. First to claim wins!
            </p>
            <Link
              href="/shovel"
              className="inline-block bg-slate-800 dark:bg-white dark:text-slate-800 hover:bg-slate-700 dark:hover:bg-slate-100 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
            >
              Sign Up to Shovel
            </Link>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-16 text-slate-500 dark:text-slate-400 text-sm">
          <p>SnowSOS - Chicago&apos;s SMS snow removal marketplace</p>
          <div className="mt-2 space-x-4">
            <Link href="/admin" className="hover:underline">Admin</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

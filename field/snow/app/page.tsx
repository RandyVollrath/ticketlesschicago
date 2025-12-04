"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";

declare global {
  interface Window {
    google: typeof google;
    initAutocomplete: () => void;
  }
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [bidMode, setBidMode] = useState(false);
  const [serviceType, setServiceType] = useState<"any" | "truck" | "shovel">("any");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  // Initialize Google Places Autocomplete
  useEffect(() => {
    window.initAutocomplete = () => {
      if (addressInputRef.current && window.google) {
        const autocomplete = new window.google.maps.places.Autocomplete(
          addressInputRef.current,
          {
            types: ["address"],
            componentRestrictions: { country: "us" },
          }
        );

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (place.formatted_address) {
            setAddress(place.formatted_address);
          }
        });
      }
    };

    // If Google Maps is already loaded
    if (window.google?.maps?.places) {
      window.initAutocomplete();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      setStatus("error");
      setMessage("Please enter a valid 10-digit phone number.");
      return;
    }

    if (!address.trim()) {
      setStatus("error");
      setMessage("Please enter your address.");
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
          bidMode,
          serviceType,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setJobId(data.job.id);
        setMessage(`Job posted! We'll text you at ${formatPhone(phone)} when someone claims it.`);
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const resetForm = () => {
    setPhone("");
    setAddress("");
    setDescription("");
    setMaxPrice("");
    setBidMode(false);
    setServiceType("any");
    setStatus("idle");
    setMessage("");
    setJobId(null);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-800">
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_API_KEY || ""}&libraries=places&callback=initAutocomplete`}
        strategy="lazyOnload"
      />

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

          {/* Main Form Box */}
          <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 md:p-12 mb-12">
            {status === "success" ? (
              <div className="text-center">
                <div className="text-6xl mb-4">&#9989;</div>
                <h2 className="text-2xl font-bold text-green-600 dark:text-green-400 mb-2">
                  Job Posted!
                </h2>
                <p className="text-slate-600 dark:text-slate-300 mb-6">{message}</p>
                {jobId && (
                  <p className="text-sm text-slate-500 mb-4">
                    Job ID: <span className="font-mono">{jobId.substring(0, 8)}</span>
                  </p>
                )}
                <button
                  onClick={resetForm}
                  className="text-sky-600 dark:text-sky-400 hover:underline"
                >
                  Request another job
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="text-left space-y-5">
                <div className="text-center mb-6">
                  <div className="text-5xl mb-3">
                    <span role="img" aria-label="snowflake">&#10052;</span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                    Request Snow Removal
                  </h2>
                </div>

                {/* Phone */}
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
                  <p className="text-xs text-slate-500 mt-1">We'll text you updates</p>
                </div>

                {/* Address with Google Autocomplete */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Address *
                  </label>
                  <input
                    type="text"
                    ref={addressInputRef}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Start typing your address..."
                    required
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Service Type - Radio buttons */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Service Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "any", label: "Any", icon: "&#9889;", desc: "Recommended" },
                      { value: "truck", label: "Truck Plow", icon: "&#128668;", desc: "Large areas" },
                      { value: "shovel", label: "Hand Shovel", icon: "&#128119;", desc: "Walkways" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={`cursor-pointer p-3 rounded-lg border-2 text-center transition-all ${
                          serviceType === option.value
                            ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30"
                            : "border-slate-200 dark:border-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="serviceType"
                          value={option.value}
                          checked={serviceType === option.value}
                          onChange={(e) => setServiceType(e.target.value as "any" | "truck" | "shovel")}
                          className="sr-only"
                        />
                        <div className="text-2xl mb-1" dangerouslySetInnerHTML={{ __html: option.icon }} />
                        <div className={`text-sm font-medium ${serviceType === option.value ? "text-sky-700 dark:text-sky-300" : "text-slate-700 dark:text-slate-300"}`}>
                          {option.label}
                        </div>
                        <div className="text-xs text-slate-500">{option.desc}</div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Description */}
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

                {/* Budget */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Your Budget
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
                    Setting a budget helps match you faster
                  </p>
                </div>

                {/* Bid Mode Toggle */}
                <div className="flex items-start gap-3 p-4 bg-sky-50 dark:bg-slate-600 rounded-lg">
                  <input
                    type="checkbox"
                    id="bidMode"
                    checked={bidMode}
                    onChange={(e) => setBidMode(e.target.checked)}
                    className="mt-1 w-5 h-5 text-sky-600 border-slate-300 rounded focus:ring-sky-500"
                  />
                  <div>
                    <label htmlFor="bidMode" className="font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      Enable Bidding
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Get competitive bids (2 min window). You pick the best offer!
                    </p>
                  </div>
                </div>

                {status === "error" && (
                  <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
                    <p className="text-red-800 dark:text-red-200 text-sm">{message}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white font-semibold py-4 px-6 rounded-lg text-lg transition-colors"
                >
                  {status === "loading" ? "Posting..." : "Post Job - Get Help Now"}
                </button>
              </form>
            )}
          </div>

          {/* How It Works */}
          <div className="grid md:grid-cols-3 gap-6 text-left">
            {[
              { num: 1, title: "Post Your Job", desc: "Enter your address and budget. No account needed!" },
              { num: 2, title: "Plowers Notified", desc: "Nearby plowers see your job instantly. First to claim wins!" },
              { num: 3, title: "Get It Done", desc: "Plower calls you, clears your snow, you pay via Venmo/Cash." },
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

        {/* Plower CTA */}
        <div className="text-center mt-16">
          <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-8 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              Earn money plowing snow
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              Join our network of snow removal pros. Claim jobs, call customers, get paid!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/shovel"
                className="inline-block bg-slate-800 dark:bg-white dark:text-slate-800 hover:bg-slate-700 dark:hover:bg-slate-100 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
              >
                Sign Up as Plower
              </Link>
              <Link
                href="/plower/dashboard"
                className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
              >
                Plower Dashboard
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-16 text-slate-500 dark:text-slate-400 text-sm">
          <p>SnowSOS - Chicago&apos;s web-first snow removal marketplace</p>
          <div className="mt-2 space-x-4">
            <Link href="/plower/dashboard" className="hover:underline">Plower Dashboard</Link>
            <Link href="/admin" className="hover:underline">Admin</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

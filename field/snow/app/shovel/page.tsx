"use client";

import { useState } from "react";
import Link from "next/link";

export default function ShovelerSignup() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const formatPhone = (value: string) => {
    // Strip non-digits
    const digits = value.replace(/\D/g, "");

    // Format as (XXX) XXX-XXXX
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    // Extract just digits for API
    const phoneDigits = phone.replace(/\D/g, "");

    if (phoneDigits.length !== 10) {
      setStatus("error");
      setMessage("Please enter a valid 10-digit phone number.");
      return;
    }

    try {
      const res = await fetch("/api/shovelers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `+1${phoneDigits}`,
          name: name.trim() || null,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("You're signed up! You'll receive texts when customers need snow removal.");
        setPhone("");
        setName("");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto">
          {/* Back link */}
          <Link
            href="/"
            className="text-sky-600 dark:text-sky-400 hover:underline mb-8 inline-block"
          >
            &larr; Back to home
          </Link>

          {/* Header */}
          <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
            Become a Shoveler
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mb-8">
            Get paid to clear snow in your neighborhood. Receive job alerts via text.
          </p>

          {/* Success message */}
          {status === "success" && (
            <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-xl p-6 mb-6">
              <p className="text-green-800 dark:text-green-200 font-medium">
                {message}
              </p>
            </div>
          )}

          {/* Signup form */}
          {status !== "success" && (
            <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8">
              <div className="mb-6">
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
                >
                  Phone Number *
                </label>
                <input
                  type="tel"
                  id="phone"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="(312) 555-1234"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              <div className="mb-6">
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
                >
                  Your Name (optional)
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John"
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              {status === "error" && (
                <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
                  <p className="text-red-800 dark:text-red-200 text-sm">{message}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                {status === "loading" ? "Signing up..." : "Sign Up to Shovel"}
              </button>

              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400 text-center">
                By signing up, you agree to receive SMS job alerts. Reply STOP to unsubscribe.
              </p>
            </form>
          )}

          {/* How it works */}
          <div className="mt-12">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-4">
              How it works
            </h2>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-sky-100 dark:bg-sky-900 rounded-full flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold">
                  1
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Receive a text when someone nearby needs snow removal
                </p>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-sky-100 dark:bg-sky-900 rounded-full flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold">
                  2
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Reply CLAIM + job ID to accept the job
                </p>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-sky-100 dark:bg-sky-900 rounded-full flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold">
                  3
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Complete the job and reply DONE to confirm
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

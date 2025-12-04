"use client";

import { useState } from "react";
import Link from "next/link";

const SKILL_OPTIONS = [
  { id: "shovel", label: "Shovel", icon: "Shovel" },
  { id: "plow", label: "Snow Plow", icon: "Truck" },
  { id: "blower", label: "Snow Blower", icon: "Wind" },
  { id: "salt", label: "Salt/De-ice", icon: "Sparkles" },
];

export default function ShovelerSignup() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("50");
  const [skills, setSkills] = useState<string[]>(["shovel"]);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const toggleSkill = (skillId: string) => {
    setSkills((prev) =>
      prev.includes(skillId)
        ? prev.filter((s) => s !== skillId)
        : [...prev, skillId]
    );
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

    if (skills.length === 0) {
      setStatus("error");
      setMessage("Please select at least one skill.");
      return;
    }

    const rateNum = parseInt(rate, 10);
    if (isNaN(rateNum) || rateNum < 10 || rateNum > 500) {
      setStatus("error");
      setMessage("Please enter a rate between $10 and $500.");
      return;
    }

    try {
      const res = await fetch("/api/shovelers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `+1${phoneDigits}`,
          name: name.trim() || null,
          rate: rateNum,
          skills,
          address: address.trim() || null,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage(`You're signed up! Rate: $${rateNum}/job. You'll receive a welcome text shortly.`);
        setPhone("");
        setName("");
        setRate("50");
        setSkills(["shovel"]);
        setAddress("");
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
        <div className="max-w-lg mx-auto">
          <Link
            href="/"
            className="text-sky-600 dark:text-sky-400 hover:underline mb-8 inline-block"
          >
            &larr; Back to home
          </Link>

          <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
            Become a Shoveler
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mb-8">
            Get paid to clear snow in Chicago. Set your rate and get matched with nearby customers.
          </p>

          {status === "success" ? (
            <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-green-800 dark:text-green-200 mb-2">
                Welcome aboard!
              </h2>
              <p className="text-green-700 dark:text-green-300">{message}</p>
              <button
                onClick={() => setStatus("idle")}
                className="mt-4 text-green-600 dark:text-green-400 hover:underline"
              >
                Sign up another shoveler
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 space-y-6">
              {/* Phone */}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
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

              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Your Name
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

              {/* Rate */}
              <div>
                <label htmlFor="rate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Your Rate ($/job) *
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input
                    type="number"
                    id="rate"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    min="10"
                    max="500"
                    required
                    className="w-full pl-8 pr-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  You'll only see jobs where the customer's budget meets your rate
                </p>
              </div>

              {/* Skills */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Your Equipment *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {SKILL_OPTIONS.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        skills.includes(skill.id)
                          ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30"
                          : "border-slate-200 dark:border-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <span className={`font-medium ${skills.includes(skill.id) ? "text-sky-700 dark:text-sky-300" : "text-slate-700 dark:text-slate-300"}`}>
                        {skill.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Address */}
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Your Location (for matching nearby jobs)
                </label>
                <input
                  type="text"
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g., Logan Square, Chicago or 2000 N Western Ave"
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  We'll use this to send you jobs within 10 miles
                </p>
              </div>

              {status === "error" && (
                <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
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

              <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
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
              {[
                "Get text alerts when customers nearby need snow removal",
                "Reply CLAIM + job ID to accept (first come, first served!)",
                "Reply START when you arrive, DONE when finished",
                "Customer is notified at each step",
              ].map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-sky-100 dark:bg-sky-900 rounded-full flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold">
                    {i + 1}
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

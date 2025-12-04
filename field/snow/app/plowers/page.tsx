"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface AvailabilitySlot {
  day: string;
  start: string;
  end: string;
}

interface Plower {
  id: string;
  name: string | null;
  profilePicUrl: string | null;
  tagline: string | null;
  neighborhood: string | null;
  rate: number;
  hasTruck: boolean;
  avgRating: number;
  totalReviews: number;
  isOnline: boolean;
  skills: string[];
  availability: AvailabilitySlot[];
  isVerified?: boolean;
  reliabilityScore?: number;
  tier?: string;
}

export default function PlowersPage() {
  const [plowers, setPlowers] = useState<Plower[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [selectedNeighborhood, setSelectedNeighborhood] = useState("");
  const [hasTruck, setHasTruck] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rating");

  useEffect(() => {
    fetchPlowers();
  }, [selectedNeighborhood, hasTruck, sortBy]);

  const fetchPlowers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedNeighborhood) params.set("neighborhood", selectedNeighborhood);
      if (hasTruck) params.set("hasTruck", "true");
      if (search) params.set("search", search);
      params.set("sortBy", sortBy);

      const res = await fetch(`/api/plowers/browse?${params.toString()}`);
      const data = await res.json();

      if (data.plowers) {
        setPlowers(data.plowers);
        setTotal(data.total);
        setNeighborhoods(data.neighborhoods || []);
      }
    } catch (err) {
      console.error("Error fetching plowers:", err);
    }
    setLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPlowers();
  };

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="text-yellow-400">★</span>);
      } else if (i === fullStars && hasHalf) {
        stars.push(<span key={i} className="text-yellow-400">★</span>);
      } else {
        stars.push(<span key={i} className="text-slate-300 dark:text-slate-600">★</span>);
      }
    }
    return stars;
  };

  const isAvailableNow = (availability: AvailabilitySlot[]) => {
    if (!availability || availability.length === 0) return true; // No schedule = always available

    const now = new Date();
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const currentDay = days[now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    return availability.some((slot) => {
      if (slot.day !== currentDay) return false;
      return currentTime >= slot.start && currentTime <= slot.end;
    });
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
                Find a Plower
              </h1>
              <p className="text-sm text-slate-500">{total} plowers available</p>
            </div>
            <Link
              href="/"
              className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg font-medium"
            >
              Post a Job
            </Link>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          {/* Search Bar */}
          <form onSubmit={handleSearch} className="mb-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or tagline..."
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              />
              <button
                type="submit"
                className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg font-medium"
              >
                Search
              </button>
            </div>
          </form>

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

            {/* Truck Filter */}
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={hasTruck}
                onChange={(e) => setHasTruck(e.target.checked)}
                className="w-4 h-4 text-sky-600"
              />
              <span className="text-slate-800 dark:text-white">🚛 Has Truck</span>
            </label>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
            >
              <option value="rating">Highest Rated</option>
              <option value="reviews">Most Reviews</option>
              <option value="rate_low">Lowest Rate</option>
              <option value="rate_high">Highest Rate</option>
            </select>
          </div>
        </div>
      </div>

      {/* Plowers Grid */}
      <div className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-sky-500 border-t-transparent"></div>
            <p className="mt-2 text-slate-500">Loading plowers...</p>
          </div>
        ) : plowers.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl">
            <div className="text-5xl mb-4">🔍</div>
            <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-2">
              No plowers found
            </h2>
            <p className="text-slate-500 mb-4">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {plowers.map((plower) => {
              const available = isAvailableNow(plower.availability);

              return (
                <div
                  key={plower.id}
                  className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden"
                >
                  {/* Profile Header */}
                  <div className="relative h-28 bg-gradient-to-r from-sky-500 to-sky-600">
                    {/* Online Status */}
                    <div className="absolute top-2 right-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          plower.isOnline
                            ? "bg-green-500 text-white"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {plower.isOnline ? "Online" : "Offline"}
                      </span>
                    </div>

                    {/* Profile Pic */}
                    <div className="absolute -bottom-10 left-4">
                      <div className="w-20 h-20 rounded-full border-4 border-white dark:border-slate-800 overflow-hidden bg-slate-200">
                        {plower.profilePicUrl ? (
                          <Image
                            src={plower.profilePicUrl}
                            alt={plower.name || "Plower"}
                            width={80}
                            height={80}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-3xl bg-slate-300">
                            🧑
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="pt-12 px-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-slate-800 dark:text-white">
                          {plower.name || "Anonymous Plower"}
                        </h3>
                        {plower.neighborhood && (
                          <span className="text-xs text-sky-600 dark:text-sky-400">
                            📍 {plower.neighborhood}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-600">${plower.rate}</div>
                        <div className="text-xs text-slate-500">per job</div>
                      </div>
                    </div>

                    {/* Tagline */}
                    {plower.tagline && (
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                        &ldquo;{plower.tagline}&rdquo;
                      </p>
                    )}

                    {/* Rating */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex">{renderStars(plower.avgRating)}</div>
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {plower.avgRating.toFixed(1)} ({plower.totalReviews})
                      </span>
                    </div>

                    {/* Badges */}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {plower.isVerified && (
                        <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5 rounded text-xs font-medium">
                          ✓ Verified
                        </span>
                      )}
                      {plower.tier === "diamond" && (
                        <span className="bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200 px-2 py-0.5 rounded text-xs font-medium">
                          💎 Diamond
                        </span>
                      )}
                      {plower.tier === "gold" && (
                        <span className="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded text-xs font-medium">
                          🥇 Gold
                        </span>
                      )}
                      {plower.hasTruck && (
                        <span className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded text-xs font-medium">
                          🚛 Truck
                        </span>
                      )}
                      {plower.skills?.includes("salt") && (
                        <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded text-xs font-medium">
                          🧂 Salt
                        </span>
                      )}
                      {!available && (
                        <span className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 px-2 py-0.5 rounded text-xs font-medium">
                          ⏰ Unavailable Now
                        </span>
                      )}
                    </div>

                    {/* CTA */}
                    <Link
                      href={`/?plower=${plower.id}`}
                      className="mt-4 block w-full text-center bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-lg font-medium text-sm"
                    >
                      Request This Plower
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

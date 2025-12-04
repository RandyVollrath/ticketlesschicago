"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LeaderboardEntry {
  rank: number;
  displayName: string;
  earnings: number;
  jobs: number;
  rating: number;
  hasTruck: boolean;
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stormStart, setStormStart] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const data = await res.json();
        setLeaderboard(data.leaderboard || []);
        setStormStart(data.stormStart);
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
      }
      setLoading(false);
    };

    fetchLeaderboard();
    // Refresh every minute
    const interval = setInterval(fetchLeaderboard, 60000);
    return () => clearInterval(interval);
  }, []);

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1:
        return "&#129351;"; // Gold medal
      case 2:
        return "&#129352;"; // Silver medal
      case 3:
        return "&#129353;"; // Bronze medal
      default:
        return `#${rank}`;
    }
  };

  const getRankClass = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-yellow-400 to-amber-500 text-white";
      case 2:
        return "bg-gradient-to-r from-slate-300 to-slate-400 text-slate-800";
      case 3:
        return "bg-gradient-to-r from-amber-600 to-amber-700 text-white";
      default:
        return "bg-white dark:bg-slate-800";
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-purple-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="text-sky-400 text-sm hover:underline">
            &larr; Back to SnowSOS
          </Link>
          <h1 className="text-4xl font-bold text-white mt-4 mb-2">
            <span dangerouslySetInnerHTML={{ __html: "&#127942;" }} /> Storm Leaderboard
          </h1>
          <p className="text-slate-300">
            Top earners in the last 48 hours
          </p>
          {stormStart && (
            <p className="text-xs text-slate-400 mt-2">
              Since {new Date(stormStart).toLocaleDateString()} {new Date(stormStart).toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Leaderboard */}
        {loading ? (
          <div className="text-center py-12 text-slate-400">
            Loading leaderboard...
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">
              <span dangerouslySetInnerHTML={{ __html: "&#10052;" }} />
            </div>
            <p className="text-slate-400 text-lg">
              No one on the leaderboard yet
            </p>
            <p className="text-slate-500 text-sm mt-2">
              Complete jobs and opt into the leaderboard to appear here!
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {leaderboard.map((entry) => (
              <div
                key={entry.rank}
                className={`rounded-xl p-4 shadow-lg transition-transform hover:scale-102 ${getRankClass(entry.rank)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-3xl font-bold w-12 text-center">
                      <span dangerouslySetInnerHTML={{ __html: getRankEmoji(entry.rank) }} />
                    </div>
                    <div>
                      <p className={`font-bold text-lg ${entry.rank <= 3 ? "" : "text-slate-800 dark:text-white"}`}>
                        {entry.displayName}
                        {entry.hasTruck && (
                          <span className="ml-2" dangerouslySetInnerHTML={{ __html: "&#128668;" }} />
                        )}
                      </p>
                      <p className={`text-sm ${entry.rank <= 3 ? "opacity-80" : "text-slate-500 dark:text-slate-400"}`}>
                        {entry.jobs} jobs completed
                        {entry.rating > 0 && (
                          <span className="ml-2">
                            <span dangerouslySetInnerHTML={{ __html: "&#11088;" }} /> {entry.rating.toFixed(1)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${entry.rank <= 3 ? "" : "text-green-600 dark:text-green-400"}`}>
                      ${entry.earnings}
                    </p>
                    <p className={`text-xs ${entry.rank <= 3 ? "opacity-80" : "text-slate-500"}`}>
                      earned
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA for plowers */}
        <div className="text-center mt-12">
          <p className="text-slate-400 mb-4">
            Want to join the leaderboard?
          </p>
          <Link
            href="/plower/dashboard"
            className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-6 rounded-lg"
          >
            Start Plowing Today
          </Link>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-xs text-slate-500 mt-8">
          Leaderboard shows anonymized data for plowers who opted in.
          <br />
          Earnings reset every 48 hours.
        </p>
      </div>
    </main>
  );
}

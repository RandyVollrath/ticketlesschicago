import { useEffect, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';

// Dynamically import the map component to avoid SSR issues with Leaflet
const TowMap = dynamic(() => import('../components/TowHeatmap'), {
  ssr: false,
  loading: () => <div className="h-[500px] bg-gray-100 flex items-center justify-center">Loading map...</div>
});

interface ZipCount {
  zip: string;
  count: number;
}

interface TowLocation {
  lat: number;
  lng: number;
  zip: string;
  zip5: string;
}

export default function TowHeatmapPage() {
  const [zipCounts, setZipCounts] = useState<ZipCount[]>([]);
  const [fullZipCounts, setFullZipCounts] = useState<ZipCount[]>([]);
  const [towLocations, setTowLocations] = useState<TowLocation[]>([]);
  const [showFullZip, setShowFullZip] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/data/tow-zip-counts.json').then(r => r.json()),
      fetch('/data/tow-zip-full-counts.json').then(r => r.json()),
      fetch('/data/tow-locations.json').then(r => r.json())
    ]).then(([counts, fullCounts, locations]) => {
      setZipCounts(counts);
      setFullZipCounts(fullCounts);
      setTowLocations(locations);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load data:', err);
      setLoading(false);
    });
  }, []);

  const displayCounts = showFullZip ? fullZipCounts : zipCounts;
  const totalTows = displayCounts.reduce((sum, z) => sum + z.count, 0);
  const topZip = displayCounts[0];

  return (
    <>
      <Head>
        <title>Chicago Tow Heatmap by ZIP Code | Ticketless Chicago</title>
        <meta name="description" content="See which Chicago ZIP codes have the most vehicle tows. Interactive map and ranking." />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <header className="bg-blue-900 text-white py-6">
          <div className="max-w-7xl mx-auto px-4">
            <h1 className="text-3xl font-bold">Chicago Tow Heatmap</h1>
            <p className="text-blue-200 mt-2">Vehicle tows by ZIP code</p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading tow data...</p>
            </div>
          ) : (
            <>
              {/* Stats Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-3xl font-bold text-blue-600">{totalTows.toLocaleString()}</div>
                  <div className="text-gray-600">Total Tows</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-3xl font-bold text-red-600">{topZip?.zip || '-'}</div>
                  <div className="text-gray-600">Highest Tow ZIP ({topZip?.count || 0} tows)</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-3xl font-bold text-green-600">{displayCounts.length}</div>
                  <div className="text-gray-600">ZIP Codes with Tows</div>
                </div>
              </div>

              {/* Map */}
              <div className="bg-white rounded-lg shadow mb-8">
                <div className="p-4 border-b">
                  <h2 className="text-xl font-semibold">Tow Location Map</h2>
                  <p className="text-gray-600 text-sm">Each dot represents a tow location. Darker areas have more tows.</p>
                </div>
                <div className="h-[500px]">
                  <TowMap locations={towLocations} zipCounts={zipCounts} />
                </div>
              </div>

              {/* Toggle and Ranking */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold">ZIP Code Ranking</h2>
                    <p className="text-gray-600 text-sm">Sorted by number of tows</p>
                  </div>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showFullZip}
                      onChange={(e) => setShowFullZip(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">Show ZIP+4</span>
                  </label>
                </div>

                {/* Histogram */}
                <div className="p-4 border-b">
                  <h3 className="font-medium mb-4">Top 20 ZIP Codes</h3>
                  <div className="space-y-2">
                    {displayCounts.slice(0, 20).map((item, idx) => {
                      const maxCount = displayCounts[0]?.count || 1;
                      const widthPercent = (item.count / maxCount) * 100;
                      return (
                        <div key={item.zip} className="flex items-center gap-4">
                          <div className="w-24 text-sm font-mono text-right">{item.zip}</div>
                          <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-red-500 rounded-full flex items-center justify-end pr-2"
                              style={{ width: `${widthPercent}%` }}
                            >
                              <span className="text-xs text-white font-medium">{item.count}</span>
                            </div>
                          </div>
                          <div className="w-8 text-sm text-gray-500">#{idx + 1}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Full Table */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Rank</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">ZIP Code</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Tow Count</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">% of Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {displayCounts.map((item, idx) => (
                        <tr key={item.zip} className={idx < 3 ? 'bg-red-50' : idx < 10 ? 'bg-yellow-50' : ''}>
                          <td className="px-4 py-3 text-sm">
                            {idx === 0 && <span className="text-2xl">🥇</span>}
                            {idx === 1 && <span className="text-2xl">🥈</span>}
                            {idx === 2 && <span className="text-2xl">🥉</span>}
                            {idx > 2 && <span className="text-gray-600">#{idx + 1}</span>}
                          </td>
                          <td className="px-4 py-3 font-mono font-medium">{item.zip}</td>
                          <td className="px-4 py-3 text-right font-semibold">{item.count.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {((item.count / totalTows) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Data Source */}
              <div className="mt-8 text-center text-sm text-gray-500">
                <p>Data source: Chicago FOIA Request F512258</p>
                <p>Analysis by Ticketless Chicago</p>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}

/**
 * Remitter Portal
 * Dashboard for remitters/dealers to manage city sticker renewals
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface Order {
  id: string;
  orderNumber: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  vehicle: {
    licensePlate: string;
    state: string;
    make?: string;
    model?: string;
    year?: number;
  };
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  stickerType: string;
  amount: {
    stickerPrice: number;
    serviceFee: number;
    total: number;
  };
  status: string;
  paymentStatus: string;
  paidAt?: string;
  createdAt: string;
  documents?: any[];
}

interface Stats {
  today: { orders: number; revenue: number };
  thisWeek: { orders: number; revenue: number };
  thisMonth: { orders: number; revenue: number };
  allTime: { orders: number; revenue: number };
}

export default function RemitterPortal() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [view, setView] = useState<'dashboard' | 'orders' | 'pending' | 'upload'>('dashboard');

  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Document upload state
  const [uploadCustomerName, setUploadCustomerName] = useState('');
  const [uploadPlate, setUploadPlate] = useState('');
  const [uploadDocuments, setUploadDocuments] = useState({
    license_front: null as File | null,
    license_back: null as File | null,
    proof_of_residence: null as File | null,
  });

  useEffect(() => {
    const savedApiKey = localStorage.getItem('remitter_api_key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
      setIsAuthenticated(true);
      loadDashboard(savedApiKey);
    }
  }, []);

  const handleLogin = () => {
    if (!apiKey) {
      setError('Please enter your API key');
      return;
    }

    localStorage.setItem('remitter_api_key', apiKey);
    setIsAuthenticated(true);
    loadDashboard(apiKey);
  };

  const handleLogout = () => {
    localStorage.removeItem('remitter_api_key');
    setApiKey('');
    setIsAuthenticated(false);
    setStats(null);
    setOrders([]);
  };

  const loadDashboard = async (key: string) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/renewal-intake/partner-dashboard?view=overview', {
        headers: {
          'X-API-Key': key,
        },
      });

      if (!response.ok) {
        throw new Error('Invalid API key');
      }

      const data = await response.json();
      setStats(data.stats);
      setOrders(data.recentOrders || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async (status?: string) => {
    setLoading(true);
    try {
      const url = status
        ? `/api/renewal-intake/partner-dashboard?view=orders&status=${status}`
        : '/api/renewal-intake/partner-dashboard?view=orders';

      const response = await fetch(url, {
        headers: { 'X-API-Key': apiKey },
      });

      const data = await response.json();
      setOrders(data.orders || []);
    } catch (err) {
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const loadPendingReview = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/renewal-intake/partner-dashboard?view=pending-review', {
        headers: { 'X-API-Key': apiKey },
      });

      const data = await response.json();
      setPendingOrders(data.orders || []);
    } catch (err) {
      setError('Failed to load pending orders');
    } finally {
      setLoading(false);
    }
  };

  const exportTodayCSV = async () => {
    try {
      const response = await fetch('/api/renewal-intake/export-reconciliation?period=today', {
        headers: { 'X-API-Key': apiKey },
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      setError('Failed to export CSV');
    }
  };

  const exportPDF = async () => {
    try {
      const response = await fetch('/api/renewal-intake/export-pdf?period=today', {
        headers: { 'X-API-Key': apiKey },
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `renewals-batch-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
    } catch (err) {
      setError('Failed to export PDF');
    }
  };

  // Login Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Remitter Portal</h1>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Enter your API key"
            />
          </div>

          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white py-2 rounded-md font-medium hover:bg-blue-700"
          >
            Log In
          </button>

          <p className="mt-4 text-sm text-gray-600 text-center">
            Contact support for your API key
          </p>
        </div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Remitter Portal</h1>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Navigation Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <div className="flex space-x-8">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'orders', label: 'All Orders' },
              { id: 'pending', label: 'Pending Review' },
              { id: 'upload', label: 'Upload Documents' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setView(tab.id as any);
                  if (tab.id === 'orders') loadOrders();
                  if (tab.id === 'pending') loadPendingReview();
                }}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  view === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Dashboard View */}
        {view === 'dashboard' && stats && (
          <div>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              {[
                { label: 'Today', data: stats.today },
                { label: 'This Week', data: stats.thisWeek },
                { label: 'This Month', data: stats.thisMonth },
                { label: 'All Time', data: stats.allTime },
              ].map((stat) => (
                <div key={stat.label} className="bg-white p-6 rounded-lg shadow">
                  <p className="text-sm text-gray-600 mb-2">{stat.label}</p>
                  <p className="text-3xl font-bold text-gray-900">{stat.data.orders}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    ${stat.data.revenue.toFixed(2)} revenue
                  </p>
                </div>
              ))}
            </div>

            {/* Quick Actions */}
            <div className="bg-white p-6 rounded-lg shadow mb-8">
              <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={exportTodayCSV}
                  className="px-4 py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700"
                >
                  📊 Export Today's Reconciliation CSV
                </button>
                <button
                  onClick={exportPDF}
                  className="px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
                >
                  📄 Export Renewal Batch PDF
                </button>
                <button
                  onClick={() => setView('upload')}
                  className="px-4 py-3 bg-purple-600 text-white rounded-md font-medium hover:bg-purple-700"
                >
                  📤 Upload New Documents
                </button>
              </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold">Recent Orders</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Order #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Vehicle
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {order.orderNumber}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.customer.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.vehicle.licensePlate} ({order.vehicle.state})
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ${order.amount.total}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            order.paymentStatus === 'paid'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Orders View */}
        {view === 'orders' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">All Orders</h2>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => loadOrders()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                All
              </button>
              <button
                onClick={() => loadOrders('submitted')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                Submitted
              </button>
              <button
                onClick={() => loadOrders('payment_received')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                Paid
              </button>
              <button
                onClick={() => loadOrders('completed')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                Completed
              </button>
            </div>

            {loading ? (
              <p className="text-center py-8 text-gray-500">Loading...</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-lg">{order.orderNumber}</p>
                        <p className="text-sm text-gray-600">{order.customer.name} - {order.customer.phone}</p>
                      </div>
                      <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                        order.paymentStatus === 'paid'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {order.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Vehicle</p>
                        <p className="font-medium">{order.vehicle.licensePlate} ({order.vehicle.state})</p>
                        {order.vehicle.make && (
                          <p className="text-gray-600">{order.vehicle.make} {order.vehicle.model}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-gray-600">Address</p>
                        <p className="font-medium">{order.address.street}</p>
                        <p className="text-gray-600">{order.address.city}, {order.address.zip}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Sticker Type</p>
                        <p className="font-medium capitalize">{order.stickerType}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Amount</p>
                        <p className="font-medium">${order.amount.total}</p>
                        <p className="text-gray-600 text-xs">
                          Sticker: ${order.amount.stickerPrice} + Fee: ${order.amount.serviceFee}
                        </p>
                      </div>
                    </div>

                    {order.paidAt && (
                      <p className="mt-3 text-sm text-gray-600">
                        Paid: {new Date(order.paidAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Document Upload View - Coming in next file */}
      </div>
    </div>
  );
}

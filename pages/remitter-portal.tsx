/**
 * Remitter Portal
 * Dashboard for remitters/dealers to manage city sticker renewals
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface Order {
  id: string;
  orderNumber: string;
  renewalType: 'city_sticker' | 'license_plate';
  renewalTypeLabel: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  vehicle: {
    licensePlate: string;
    state: string;
  };
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  stickerType: string;
  stickerTypeLabel: string;
  amount: {
    stickerPrice: number;
    permitFee: number;
    permitRequested: boolean;
    serviceFee: number;
    total: number;
    customerPaid: number;
    platformFee: number;
  };
  status: string;
  paymentStatus: string;
  paidAt?: string;
  renewalDueDate?: string;
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
  const [view, setView] = useState<'dashboard' | 'orders' | 'pending'>('dashboard');

  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [partnerName, setPartnerName] = useState('');

  // Search and pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const ordersPerPage = 20;

  // Order processing state
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDocuments, setOrderDocuments] = useState<{
    driverLicense?: string;
    driverLicenseBack?: string;
    residencyProof?: string;
  } | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [processingOrder, setProcessingOrder] = useState(false);

  // Transfer request state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [requestingTransfer, setRequestingTransfer] = useState(false);

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
      setError('Please enter your access code');
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
        throw new Error('Invalid access code');
      }

      const data = await response.json();
      setStats(data.stats);
      setOrders(data.recentOrders || []);
      setPartnerName(data.partnerName || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async (status?: string) => {
    setLoading(true);
    setCurrentPage(1); // Reset to first page when filtering
    try {
      const url = status
        ? `/api/renewal-intake/partner-dashboard?view=orders&status=${status}`
        : '/api/renewal-intake/partner-dashboard?view=orders';

      const response = await fetch(url, {
        headers: { 'X-API-Key': apiKey },
      });

      const data = await response.json();
      setOrders(data.orders || []);
      setTotalPages(Math.ceil((data.orders || []).length / ordersPerPage));
    } catch (err) {
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  // Filter orders based on search query
  const filteredOrders = orders.filter(order => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.orderNumber?.toLowerCase().includes(query) ||
      order.customer?.name?.toLowerCase().includes(query) ||
      order.customer?.email?.toLowerCase().includes(query) ||
      order.customer?.phone?.includes(query) ||
      order.vehicle?.licensePlate?.toLowerCase().includes(query)
    );
  });

  // Paginate filtered orders
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * ordersPerPage,
    currentPage * ordersPerPage
  );

  // Filter pending orders based on search query
  const filteredPendingOrders = pendingOrders.filter(order => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.orderNumber?.toLowerCase().includes(query) ||
      order.customer?.name?.toLowerCase().includes(query) ||
      order.customer?.email?.toLowerCase().includes(query) ||
      order.customer?.phone?.includes(query) ||
      order.vehicle?.licensePlate?.toLowerCase().includes(query)
    );
  });

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

  const updateOrderStatus = async (orderId: string, status: string, confirmationNumber?: string) => {
    try {
      const response = await fetch('/api/remitter/update-order-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          orderId,
          status,
          confirmationNumber,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update order');
      }

      // Refresh the pending orders list
      loadPendingReview();
      return data;
    } catch (err: any) {
      setError(err.message || 'Failed to update order status');
      throw err;
    }
  };

  const openOrderForProcessing = async (order: Order) => {
    setSelectedOrder(order);
    setOrderDocuments(null);

    // Only fetch documents if permit is requested (permit zone orders)
    if (order.amount.permitRequested) {
      setDocumentsLoading(true);
      try {
        // Fetch driver's license
        const licenseRes = await fetch(`/api/city-sticker/get-driver-license?email=${encodeURIComponent(order.customer.email)}`, {
          headers: { 'X-API-Key': apiKey },
        });

        // Fetch residency proof
        const residencyRes = await fetch(`/api/city-sticker/get-residency-proof?email=${encodeURIComponent(order.customer.email)}`, {
          headers: { 'X-API-Key': apiKey },
        });

        const docs: { driverLicense?: string; driverLicenseBack?: string; residencyProof?: string } = {};

        if (licenseRes.ok) {
          const licenseData = await licenseRes.json();
          // The API returns front.signedUrl for the front of license
          docs.driverLicense = licenseData.front?.signedUrl || licenseData.signedUrl;
          docs.driverLicenseBack = licenseData.back?.signedUrl;
        }

        if (residencyRes.ok) {
          const residencyData = await residencyRes.json();
          docs.residencyProof = residencyData.signedUrl;
        }

        setOrderDocuments(docs);
      } catch (err) {
        console.error('Failed to fetch documents:', err);
      } finally {
        setDocumentsLoading(false);
      }
    }

    // Mark as processing if still pending
    if (order.status === 'pending') {
      try {
        await updateOrderStatus(order.id, 'processing');
      } catch (err) {
        // Continue anyway - viewing is the important part
      }
    }
  };

  const handleMarkCompleted = async (confirmationNumber: string) => {
    if (!selectedOrder || !confirmationNumber) return;

    setProcessingOrder(true);
    try {
      // Backend handles: updating status, updating expiry date, and sending SMS
      await updateOrderStatus(selectedOrder.id, 'completed', confirmationNumber);

      setSelectedOrder(null);
      setOrderDocuments(null);
      loadPendingReview();
    } catch (err) {
      // Error already handled in updateOrderStatus
    } finally {
      setProcessingOrder(false);
    }
  };

  const closeOrderModal = () => {
    setSelectedOrder(null);
    setOrderDocuments(null);
    setShowTransferModal(false);
    setTransferReason('');
  };

  const handleRequestTransfer = async () => {
    if (!selectedOrder || !transferReason.trim()) return;

    setRequestingTransfer(true);
    try {
      const response = await fetch('/api/remitter/request-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          reason: transferReason.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to request transfer');
      }

      // Success - close everything and refresh
      setShowTransferModal(false);
      setTransferReason('');
      setSelectedOrder(null);
      setOrderDocuments(null);
      loadPendingReview();
      setError(''); // Clear any errors
      alert('Transfer request submitted successfully. Admin will reassign this order.');
    } catch (err: any) {
      setError(err.message || 'Failed to request transfer');
    } finally {
      setRequestingTransfer(false);
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
              Access Code
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Enter your access code"
            />
          </div>

          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white py-2 rounded-md font-medium hover:bg-blue-700"
          >
            Log In
          </button>

          <p className="mt-4 text-sm text-gray-600 text-center">
            Contact support for your access code
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
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Remitter Portal</h1>
            {partnerName && (
              <p className="text-sm text-gray-600">Welcome, {partnerName}</p>
            )}
          </div>
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
              { id: 'pending', label: 'Pending Review' },
              { id: 'orders', label: 'All Orders' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setView(tab.id as any);
                  setSearchQuery(''); // Clear search when switching views
                  setCurrentPage(1); // Reset pagination
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
                  disabled
                  title="Coming soon"
                  className="px-4 py-3 bg-gray-400 text-white rounded-md font-medium cursor-not-allowed relative group"
                >
                  📤 Upload Documents
                  <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Coming Soon
                  </span>
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
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Vehicle
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Due Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        You Receive
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
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            order.renewalType === 'city_sticker'
                              ? 'bg-blue-100 text-blue-800'
                              : order.stickerType === 'vanity'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-purple-100 text-purple-800'
                          }`}>
                            {order.renewalType === 'license_plate'
                              ? (order.stickerType === 'vanity' ? 'Vanity Plate' : 'License Plate')
                              : (order.stickerTypeLabel || 'City Sticker')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.customer.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.vehicle.licensePlate} ({order.vehicle.state})
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.renewalDueDate ? new Date(order.renewalDueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                          ${order.amount.total?.toFixed(2)}
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

            {/* Search Bar */}
            <div className="mb-4">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search by order #, customer name, email, phone, or license plate..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <svg
                  className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
              {searchQuery && (
                <p className="text-sm text-gray-500 mt-1">
                  Found {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} matching "{searchQuery}"
                </p>
              )}
            </div>

            {/* Status Filter Buttons */}
            <div className="mb-4 flex flex-wrap gap-2">
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
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-400 text-5xl mb-4">📋</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
                <p className="text-gray-600">
                  {searchQuery ? `No orders match "${searchQuery}"` : 'No orders to display.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedOrders.map((order) => (
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

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Renewal Type</p>
                        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                          order.renewalType === 'city_sticker'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {order.renewalTypeLabel || 'City Sticker'}
                        </span>
                        <p className="text-gray-500 text-xs mt-1">{order.stickerTypeLabel || order.stickerType}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Vehicle</p>
                        <p className="font-medium">{order.vehicle.licensePlate} ({order.vehicle.state})</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Address</p>
                        <p className="font-medium">{order.address.street}</p>
                        <p className="text-gray-600">{order.address.city}, {order.address.zip}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Due Date</p>
                        <p className={`font-medium ${order.renewalDueDate && new Date(order.renewalDueDate) < new Date() ? 'text-red-600' : ''}`}>
                          {order.renewalDueDate ? new Date(order.renewalDueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">You Receive</p>
                        <p className="font-medium text-green-700">${order.amount.total?.toFixed(2)}</p>
                        <p className="text-gray-500 text-xs">
                          Sticker: ${order.amount.stickerPrice?.toFixed(2)}
                          {order.amount.permitRequested && ` + Permit: $${order.amount.permitFee?.toFixed(2)}`}
                          {' '}+ Fee: ${order.amount.serviceFee?.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {order.amount.permitRequested && (
                      <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                        <span className="font-medium text-blue-800">Includes Residential Permit</span>
                        <span className="text-blue-600 ml-2">- Submit permit with city sticker</span>
                      </div>
                    )}

                    {order.paidAt && (
                      <p className="mt-3 text-sm text-gray-600">
                        Paid: {new Date(order.paidAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}

                {/* Pagination Controls */}
                {filteredOrders.length > ordersPerPage && (
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-600">
                      Showing {((currentPage - 1) * ordersPerPage) + 1} - {Math.min(currentPage * ordersPerPage, filteredOrders.length)} of {filteredOrders.length} orders
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="px-3 py-1 text-sm text-gray-600">
                        Page {currentPage} of {Math.ceil(filteredOrders.length / ordersPerPage)}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredOrders.length / ordersPerPage), p + 1))}
                        disabled={currentPage >= Math.ceil(filteredOrders.length / ordersPerPage)}
                        className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pending Review View */}
        {view === 'pending' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Pending Review</h2>
            <p className="text-sm text-gray-600 mb-4">
              Paid orders waiting for you to submit to the city portal.
            </p>

            {/* Search Bar */}
            {pendingOrders.length > 0 && (
              <div className="mb-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by order #, customer name, email, phone, or license plate..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <svg
                    className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    >
                      &times;
                    </button>
                  )}
                </div>
                {searchQuery && (
                  <p className="text-sm text-gray-500 mt-1">
                    Found {filteredPendingOrders.length} order{filteredPendingOrders.length !== 1 ? 's' : ''} matching "{searchQuery}"
                  </p>
                )}
              </div>
            )}

            {loading ? (
              <p className="text-center py-8 text-gray-500">Loading...</p>
            ) : filteredPendingOrders.length === 0 ? (
              <div className="text-center py-12">
                {searchQuery ? (
                  <>
                    <div className="text-gray-400 text-5xl mb-4">🔍</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No matching orders</h3>
                    <p className="text-gray-600">No pending orders match "{searchQuery}"</p>
                    <button
                      onClick={() => setSearchQuery('')}
                      className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Clear search
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-gray-400 text-5xl mb-4">✅</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">All caught up!</h3>
                    <p className="text-gray-600">No orders pending review at this time.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPendingOrders.map((order) => (
                  <div key={order.id} className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-lg">{order.orderNumber}</p>
                        <p className="text-sm text-gray-600">{order.customer.name} - {order.customer.phone}</p>
                        <p className="text-sm text-gray-600">{order.customer.email}</p>
                      </div>
                      <span className="px-3 py-1 text-sm font-medium rounded-full bg-yellow-200 text-yellow-800">
                        Needs Processing
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Renewal Type</p>
                        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                          order.renewalType === 'city_sticker'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {order.renewalTypeLabel || 'City Sticker'}
                        </span>
                        <p className="text-gray-500 text-xs mt-1">{order.stickerTypeLabel || order.stickerType}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Vehicle</p>
                        <p className="font-medium">{order.vehicle.licensePlate} ({order.vehicle.state})</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Address</p>
                        <p className="font-medium">{order.address.street}</p>
                        <p className="text-gray-600">{order.address.city}, {order.address.zip}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Due Date</p>
                        <p className={`font-medium ${order.renewalDueDate && new Date(order.renewalDueDate) < new Date() ? 'text-red-600' : ''}`}>
                          {order.renewalDueDate ? new Date(order.renewalDueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">You Receive</p>
                        <p className="font-medium text-green-700">${order.amount.total?.toFixed(2)}</p>
                        <p className="text-gray-500 text-xs">
                          Sticker: ${order.amount.stickerPrice?.toFixed(2)}
                          {order.amount.permitRequested && ` + Permit: $${order.amount.permitFee?.toFixed(2)}`}
                          {' '}+ Fee: ${order.amount.serviceFee?.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {order.amount.permitRequested && (
                      <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                        <span className="font-medium text-blue-800">Includes Residential Permit</span>
                        <span className="text-blue-600 ml-2">- Submit permit with city sticker</span>
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-yellow-200 flex flex-wrap gap-3">
                      <button
                        onClick={() => openOrderForProcessing(order)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                      >
                        {order.status === 'pending' ? 'Process Order' : 'View Order'}
                      </button>
                    </div>
                    {order.status === 'processing' && (
                      <p className="mt-2 text-sm text-blue-600 font-medium">
                        Status: In Progress
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Order Processing Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-blue-600 text-white p-4 rounded-t-lg flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Process Order #{selectedOrder.orderNumber}</h2>
                <p className="text-blue-100">{selectedOrder.renewalTypeLabel}</p>
              </div>
              <button
                onClick={closeOrderModal}
                className="text-white hover:text-blue-200 text-2xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              {/* Customer & Vehicle Info */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-3">Customer Information</h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">Name:</span> <strong>{selectedOrder.customer.name}</strong></p>
                    <p><span className="text-gray-500">Email:</span> {selectedOrder.customer.email}</p>
                    <p><span className="text-gray-500">Phone:</span> {selectedOrder.customer.phone}</p>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-3">Vehicle Information</h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">Plate:</span> <strong className="text-lg">{selectedOrder.vehicle.licensePlate}</strong> ({selectedOrder.vehicle.state})</p>
                    <p><span className="text-gray-500">Type:</span> {selectedOrder.stickerTypeLabel}</p>
                    {selectedOrder.renewalDueDate && (
                      <p><span className="text-gray-500">Renewal Due:</span> <strong className="text-red-600">{new Date(selectedOrder.renewalDueDate + 'T12:00:00').toLocaleDateString()}</strong></p>
                    )}
                  </div>
                </div>
              </div>

              {/* Mailing Address */}
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6">
                <h3 className="font-semibold text-yellow-800 mb-2">Mailing Address (for sticker delivery)</h3>
                <p className="text-yellow-900 font-medium">{selectedOrder.address.street}</p>
                <p className="text-yellow-900">{selectedOrder.address.city}, {selectedOrder.address.state} {selectedOrder.address.zip}</p>
              </div>

              {/* What to Submit */}
              <div className="bg-green-50 border border-green-200 p-4 rounded-lg mb-6">
                <h3 className="font-semibold text-green-800 mb-3">Submit to State of Illinois</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-green-900">License Plate Sticker ({selectedOrder.stickerTypeLabel})</span>
                    <span className="font-bold text-green-900">${selectedOrder.amount.stickerPrice?.toFixed(2)}</span>
                  </div>
                  {selectedOrder.amount.permitRequested && (
                    <div className="flex justify-between items-center">
                      <span className="text-green-900">Residential Parking Permit</span>
                      <span className="font-bold text-green-900">${selectedOrder.amount.permitFee?.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-green-300 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-green-900">Your Processing Fee</span>
                      <span className="font-bold text-green-900">${selectedOrder.amount.serviceFee?.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="border-t border-green-300 pt-2 mt-2">
                    <div className="flex justify-between items-center text-lg">
                      <span className="font-bold text-green-900">Total You Receive</span>
                      <span className="font-bold text-green-900">${selectedOrder.amount.total?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer Documents - only shown for permit zone orders */}
              {selectedOrder?.amount.permitRequested && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-700 mb-3">Customer Documents</h3>
                    {documentsLoading ? (
                      <div className="text-center py-8 text-gray-500">Loading documents...</div>
                    ) : (
                      <div className="grid md:grid-cols-3 gap-4">
                        {/* Driver's License Front */}
                        <div className="border rounded-lg p-3">
                          <h4 className="font-medium text-gray-600 mb-2">Driver's License (Front)</h4>
                          {orderDocuments?.driverLicense ? (
                            <a
                              href={orderDocuments.driverLicense}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={orderDocuments.driverLicense}
                                alt="Driver's License Front"
                                className="w-full h-48 object-contain bg-gray-100 rounded cursor-pointer hover:opacity-80"
                              />
                              <p className="text-center text-blue-600 text-sm mt-1">Click to open full size</p>
                            </a>
                          ) : (
                            <div className="w-full h-48 bg-gray-100 rounded flex items-center justify-center text-gray-400">
                              Not uploaded
                            </div>
                          )}
                        </div>

                        {/* Driver's License Back */}
                        <div className="border rounded-lg p-3">
                          <h4 className="font-medium text-gray-600 mb-2">Driver's License (Back)</h4>
                          {orderDocuments?.driverLicenseBack ? (
                            <a
                              href={orderDocuments.driverLicenseBack}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={orderDocuments.driverLicenseBack}
                                alt="Driver's License Back"
                                className="w-full h-48 object-contain bg-gray-100 rounded cursor-pointer hover:opacity-80"
                              />
                              <p className="text-center text-blue-600 text-sm mt-1">Click to open full size</p>
                            </a>
                          ) : (
                            <div className="w-full h-48 bg-gray-100 rounded flex items-center justify-center text-gray-400">
                              Not uploaded
                            </div>
                          )}
                        </div>

                        {/* Proof of Residency */}
                        <div className="border rounded-lg p-3">
                          <h4 className="font-medium text-gray-600 mb-2">Proof of Residency</h4>
                          {orderDocuments?.residencyProof ? (
                            <a
                              href={orderDocuments.residencyProof}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={orderDocuments.residencyProof}
                                alt="Proof of Residency"
                                className="w-full h-48 object-contain bg-gray-100 rounded cursor-pointer hover:opacity-80"
                              />
                              <p className="text-center text-blue-600 text-sm mt-1">Click to open full size</p>
                            </a>
                          ) : (
                            <div className="w-full h-48 bg-gray-100 rounded flex items-center justify-center text-gray-400">
                              Not uploaded
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* Completion Form */}
              <div className="border-t pt-6">
                <h3 className="font-semibold text-gray-700 mb-3">Mark as Complete</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const confirmationNumber = formData.get('confirmationNumber') as string;
                    if (confirmationNumber) {
                      handleMarkCompleted(confirmationNumber);
                    }
                  }}
                  className="flex gap-3"
                >
                  <input
                    type="text"
                    name="confirmationNumber"
                    placeholder="Enter city confirmation number..."
                    required
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <button
                    type="submit"
                    disabled={processingOrder}
                    className="px-6 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {processingOrder ? 'Submitting...' : 'Complete Order'}
                  </button>
                </form>
                <p className="text-sm text-gray-500 mt-2">
                  This will notify the customer via SMS that their sticker has been submitted.
                </p>
              </div>

              {/* Transfer Request Section */}
              {(selectedOrder.status === 'pending' || selectedOrder.status === 'processing') && (
                <div className="mt-6 pt-4 border-t">
                  {!showTransferModal ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-600">Can't complete this order?</p>
                      </div>
                      <button
                        onClick={() => setShowTransferModal(true)}
                        className="px-4 py-2 text-orange-600 border border-orange-300 rounded-md hover:bg-orange-50 text-sm"
                      >
                        Request Transfer
                      </button>
                    </div>
                  ) : (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h4 className="font-semibold text-orange-800 mb-2">Request Order Transfer</h4>
                      <p className="text-sm text-orange-700 mb-3">
                        This will flag the order for admin to reassign to another remitter.
                        You will need to send the funds directly to them (Zelle, bank transfer, etc.).
                      </p>
                      <textarea
                        value={transferReason}
                        onChange={(e) => setTransferReason(e.target.value)}
                        placeholder="Why can't you complete this order? (e.g., wrong sticker type, customer moved, etc.)"
                        rows={3}
                        className="w-full px-3 py-2 border border-orange-300 rounded-md text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 mb-3"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setShowTransferModal(false);
                            setTransferReason('');
                          }}
                          className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleRequestTransfer}
                          disabled={requestingTransfer || transferReason.trim().length < 10}
                          className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                        >
                          {requestingTransfer ? 'Submitting...' : 'Submit Transfer Request'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Print Button */}
              <div className="mt-6 pt-4 border-t flex justify-end">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  Print This Page
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

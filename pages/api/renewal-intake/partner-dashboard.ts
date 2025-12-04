/**
 * Partner Dashboard API
 * Provides real-time data for remitters/dealers to view their orders
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate partner via API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const { data: partner, error: partnerError } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('api_key', apiKey)
      .eq('status', 'active')
      .single();

    if (partnerError || !partner) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Get dashboard data based on query params
    const { view = 'overview', status, startDate, endDate, limit = 50 } = req.query;

    switch (view) {
      case 'overview':
        return await getOverview(res, partner.id);
      case 'orders':
        return await getOrders(res, partner.id, { status, startDate, endDate, limit });
      case 'stats':
        return await getStats(res, partner.id);
      case 'pending-review':
        return await getPendingReview(res, partner.id);
      default:
        return res.status(400).json({ error: 'Invalid view parameter' });
    }

  } catch (error: any) {
    console.error('Dashboard API error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
}

async function getOverview(res: NextApiResponse, partnerId: string) {
  // Get statistics
  const { data: stats } = await supabase
    .from('renewal_partner_stats')
    .select('*')
    .eq('partner_id', partnerId)
    .single();

  // Get recent orders
  const { data: recentOrders } = await supabase
    .from('renewal_orders')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Get orders by status
  const { data: statusCounts } = await supabase
    .from('renewal_orders')
    .select('status')
    .eq('partner_id', partnerId);

  const statusBreakdown = statusCounts?.reduce((acc: any, order: any) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, {});

  // Get pending document reviews
  const { data: pendingReviews } = await supabase
    .from('renewal_document_reviews')
    .select('*, renewal_orders(*)')
    .eq('renewal_orders.partner_id', partnerId)
    .eq('status', 'pending');

  return res.status(200).json({
    stats: {
      today: {
        orders: stats?.orders_today || 0,
        revenue: stats?.revenue_today || 0,
      },
      thisWeek: {
        orders: stats?.orders_this_week || 0,
        revenue: stats?.revenue_this_week || 0,
      },
      thisMonth: {
        orders: stats?.orders_this_month || 0,
        revenue: stats?.revenue_this_month || 0,
      },
      allTime: {
        orders: stats?.total_orders || 0,
        revenue: stats?.total_revenue || 0,
      },
    },
    statusBreakdown,
    recentOrders: recentOrders?.map(formatOrder),
    pendingReviews: pendingReviews?.length || 0,
  });
}

async function getOrders(
  res: NextApiResponse,
  partnerId: string,
  filters: any
) {
  let query = supabase
    .from('renewal_orders')
    .select('*')
    .eq('partner_id', partnerId);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.startDate) {
    query = query.gte('created_at', filters.startDate);
  }

  if (filters.endDate) {
    query = query.lte('created_at', filters.endDate);
  }

  query = query
    .order('created_at', { ascending: false })
    .limit(parseInt(filters.limit as string) || 50);

  const { data: orders, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }

  return res.status(200).json({
    orders: orders?.map(formatOrder) || [],
    total: orders?.length || 0,
  });
}

async function getStats(res: NextApiResponse, partnerId: string) {
  const { data: stats } = await supabase
    .from('renewal_partner_stats')
    .select('*')
    .eq('partner_id', partnerId)
    .single();

  // Get trend data (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentOrders } = await supabase
    .from('renewal_orders')
    .select('created_at, total_amount, status')
    .eq('partner_id', partnerId)
    .gte('created_at', thirtyDaysAgo.toISOString());

  // Group by date
  const dailyStats = recentOrders?.reduce((acc: any, order: any) => {
    const date = order.created_at.split('T')[0];
    if (!acc[date]) {
      acc[date] = { orders: 0, revenue: 0 };
    }
    acc[date].orders += 1;
    acc[date].revenue += order.total_amount;
    return acc;
  }, {});

  return res.status(200).json({
    summary: stats,
    trend: dailyStats,
  });
}

async function getPendingReview(res: NextApiResponse, partnerId: string) {
  // Show orders with status 'pending' - these are paid and waiting for remitter to process
  const { data: pendingOrders } = await supabase
    .from('renewal_orders')
    .select('*, renewal_document_reviews(*)')
    .eq('partner_id', partnerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  return res.status(200).json({
    orders: pendingOrders?.map(order => ({
      ...formatOrder(order),
      documents: order.documents,
      pendingReviews: order.renewal_document_reviews?.filter(
        (r: any) => r.status === 'pending'
      ).length || 0,
    })) || [],
  });
}

// City sticker vehicle types
const CITY_STICKER_TYPES = ['P', 'MB', 'LP', 'ST', 'LT', 'passenger', 'motorcycle', 'large_passenger', 'small_truck', 'large_truck'];
// License plate types
const LICENSE_PLATE_TYPES = ['standard', 'vanity'];

// Platform service fee
const PLATFORM_FEE = 2.50;
const STRIPE_PERCENTAGE = 0.029;
const STRIPE_FIXED = 0.30;

function formatOrder(order: any) {
  // Determine renewal type from sticker_type
  const stickerType = order.sticker_type?.toLowerCase?.() || order.sticker_type || '';
  const isLicensePlate = LICENSE_PLATE_TYPES.includes(stickerType);
  const isCitySticker = !isLicensePlate && (CITY_STICKER_TYPES.includes(order.sticker_type?.toUpperCase?.()) || CITY_STICKER_TYPES.includes(stickerType));
  const renewalType = isLicensePlate ? 'license_plate' : 'city_sticker';

  // Calculate what customer paid (sticker + permit + platform fee + stripe fees)
  const stickerPrice = order.sticker_price || 0;
  const permitFee = order.permit_fee || 0;
  const basePrice = stickerPrice + permitFee;
  const customerPaid = Math.round(((basePrice + PLATFORM_FEE + STRIPE_FIXED) / (1 - STRIPE_PERCENTAGE)) * 100) / 100;

  // Sticker type labels
  const stickerTypeLabels: Record<string, string> = {
    'P': 'Passenger',
    'MB': 'Motorcycle/Business',
    'LP': 'Large Passenger',
    'ST': 'Small Truck',
    'LT': 'Large Truck',
    'passenger': 'Passenger',
    'standard': 'Standard Plate',
    'vanity': 'Vanity Plate',
  };

  return {
    id: order.id,
    orderNumber: order.order_number,
    renewalType,
    renewalTypeLabel: renewalType === 'city_sticker' ? 'City Sticker' : 'License Plate',
    customer: {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    vehicle: {
      licensePlate: order.license_plate,
      state: order.license_state,
      make: order.make,
      model: order.model,
      year: order.year,
    },
    address: {
      street: order.street_address,
      city: order.city,
      state: order.state,
      zip: order.zip_code,
    },
    stickerType: order.sticker_type,
    stickerTypeLabel: stickerTypeLabels[order.sticker_type] || order.sticker_type,
    amount: {
      stickerPrice: order.sticker_price,
      permitFee: order.permit_fee || 0,
      permitRequested: order.permit_requested || false,
      serviceFee: order.service_fee,
      total: order.total_amount,
      customerPaid,
      platformFee: PLATFORM_FEE,
    },
    status: order.status,
    paymentStatus: order.payment_status,
    paidAt: order.paid_at,
    fulfillmentMethod: order.fulfillment_method,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

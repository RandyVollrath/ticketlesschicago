/**
 * Daily Reconciliation CSV Export
 * Generates CSV report of all orders for accounting/reconciliation
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
    // Authenticate partner
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

    // Get period (today, week, month, custom)
    const { period = 'today', startDate, endDate } = req.query;

    let dateFilter: { start: Date; end: Date };

    if (period === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateFilter = { start: today, end: tomorrow };
    } else if (period === 'week') {
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = { start: weekAgo, end: today };
    } else if (period === 'month') {
      const today = new Date();
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = { start: monthAgo, end: today };
    } else if (startDate && endDate) {
      dateFilter = {
        start: new Date(startDate as string),
        end: new Date(endDate as string),
      };
    } else {
      return res.status(400).json({ error: 'Invalid period or date range' });
    }

    // Fetch orders
    const { data: orders, error: ordersError } = await supabase
      .from('renewal_orders')
      .select('*')
      .eq('partner_id', partner.id)
      .gte('created_at', dateFilter.start.toISOString())
      .lte('created_at', dateFilter.end.toISOString())
      .order('created_at', { ascending: true });

    if (ordersError) {
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    // Generate CSV
    const csv = generateReconciliationCSV(orders || [], partner);

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reconciliation-${period}-${new Date().toISOString().split('T')[0]}.csv"`
    );

    return res.status(200).send(csv);

  } catch (error: any) {
    console.error('CSV export error:', error);
    return res.status(500).json({ error: 'Failed to generate CSV' });
  }
}

function generateReconciliationCSV(orders: any[], partner: any): string {
  // CSV Headers
  const headers = [
    'Date',
    'Order Number',
    'Customer Name',
    'Customer Email',
    'Customer Phone',
    'License Plate',
    'State',
    'Make',
    'Model',
    'Year',
    'Address',
    'City',
    'State',
    'ZIP',
    'Sticker Type',
    'Sticker Price',
    'Service Fee',
    'Total Amount',
    'Payment Status',
    'Paid At',
    'Status',
    'Stripe Payment ID',
    'Portal Confirmation',
  ];

  // Build CSV rows
  const rows = orders.map((order) => [
    new Date(order.created_at).toLocaleDateString(),
    order.order_number,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.license_plate,
    order.license_state,
    order.make || '',
    order.model || '',
    order.year || '',
    order.street_address,
    order.city,
    order.state,
    order.zip_code,
    order.sticker_type,
    order.sticker_price.toFixed(2),
    order.service_fee.toFixed(2),
    order.total_amount.toFixed(2),
    order.payment_status,
    order.paid_at ? new Date(order.paid_at).toLocaleString() : '',
    order.status,
    order.stripe_payment_intent_id || '',
    order.portal_confirmation_number || '',
  ]);

  // Summary rows
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const paidOrders = orders.filter((o) => o.payment_status === 'paid').length;
  const paidRevenue = orders
    .filter((o) => o.payment_status === 'paid')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const summaryRows = [
    [],
    ['SUMMARY'],
    ['Total Orders', totalOrders],
    ['Paid Orders', paidOrders],
    ['Pending Orders', totalOrders - paidOrders],
    ['Total Revenue (All)', `$${totalRevenue.toFixed(2)}`],
    ['Total Revenue (Paid)', `$${paidRevenue.toFixed(2)}`],
    ['Partner Receives', `$${(paidRevenue - paidRevenue * (partner.commission_percentage / 100)).toFixed(2)}`],
    ['Platform Fee', `$${(paidRevenue * (partner.commission_percentage / 100)).toFixed(2)}`],
  ];

  // Convert to CSV format
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ...summaryRows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

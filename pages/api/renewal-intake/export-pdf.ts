/**
 * PDF Batch Report Export
 * Generates printable PDF of all renewal orders for submission/printing
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';

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

    // Get period
    const { period = 'today' } = req.query;

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
    } else {
      const today = new Date();
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = { start: monthAgo, end: today };
    }

    // Fetch paid orders
    const { data: orders, error: ordersError } = await supabase
      .from('renewal_orders')
      .select('*')
      .eq('partner_id', partner.id)
      .eq('payment_status', 'paid')
      .gte('created_at', dateFilter.start.toISOString())
      .lte('created_at', dateFilter.end.toISOString())
      .order('created_at', { ascending: true });

    if (ordersError) {
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    // Generate PDF
    const pdfBuffer = await generateBatchPDF(orders || [], partner);

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="renewals-batch-${new Date().toISOString().split('T')[0]}.pdf"`
    );

    return res.status(200).send(pdfBuffer);

  } catch (error: any) {
    console.error('PDF export error:', error);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
}

function generateBatchPDF(orders: any[], partner: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // Header
      doc.fontSize(20).text('City Sticker Renewal Batch Report', { align: 'center' });
      doc.fontSize(12).text(partner.name, { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      // Summary
      doc.fontSize(14).text('Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total Orders: ${orders.length}`);
      doc.text(`Total Revenue: $${orders.reduce((sum, o) => sum + o.total_amount, 0).toFixed(2)}`);
      doc.moveDown();

      // Orders Table
      doc.fontSize(14).text('Renewal Orders', { underline: true });
      doc.moveDown(0.5);

      orders.forEach((order, index) => {
        // Check if we need a new page
        if (doc.y > 700) {
          doc.addPage();
        }

        doc.fontSize(10);
        doc.font('Helvetica-Bold');
        doc.text(`${index + 1}. Order #${order.order_number}`, { continued: false });
        doc.font('Helvetica');

        doc.fontSize(9);
        doc.text(`Customer: ${order.customer_name}`);
        doc.text(`Phone: ${order.customer_phone} | Email: ${order.customer_email}`);
        doc.text(`Vehicle: ${order.license_plate} (${order.license_state}) - ${order.make || ''} ${order.model || ''} ${order.year || ''}`);
        doc.text(`Address: ${order.street_address}, ${order.city}, ${order.state} ${order.zip_code}`);
        doc.text(`Sticker: ${order.sticker_type} - $${order.sticker_price}`);
        doc.text(`Total: $${order.total_amount} (Paid: ${new Date(order.paid_at).toLocaleDateString()})`);

        // Validation Checklist
        doc.fontSize(8);
        doc.fillColor('#666666');
        doc.text('☐ License verified   ☐ Proof of residence verified   ☐ Payment confirmed', {
          indent: 20,
        });
        doc.fillColor('#000000');

        doc.moveDown(0.5);

        // Divider line
        doc.strokeColor('#cccccc')
          .lineWidth(0.5)
          .moveTo(50, doc.y)
          .lineTo(550, doc.y)
          .stroke();

        doc.moveDown(0.5);
      });

      // Footer on last page
      doc.fontSize(8).fillColor('#666666');
      doc.text(
        `Generated by Autopilot America | ${orders.length} renewals | Page ${doc.bufferedPageRange().count}`,
        50,
        750,
        { align: 'center' }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

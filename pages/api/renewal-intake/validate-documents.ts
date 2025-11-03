/**
 * Auto-Validation Checklist API
 * Provides validation checks for uploaded documents
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ValidationResult {
  orderId: string;
  overallStatus: 'pass' | 'warning' | 'fail';
  checks: ValidationCheck[];
  autoApproved: boolean;
  requiresManualReview: boolean;
}

interface ValidationCheck {
  category: string;
  item: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  critical: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate partner
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const { data: partner } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('api_key', apiKey)
      .eq('status', 'active')
      .single();

    if (!partner) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    // Get order with documents
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('*')
      .eq('id', orderId)
      .eq('partner_id', partner.id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Run validation checks
    const validation = await validateOrder(order);

    // Update order status if auto-approved
    if (validation.autoApproved) {
      await supabase
        .from('renewal_orders')
        .update({
          status: 'documents_verified',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      // Mark all documents as verified
      for (const doc of order.documents || []) {
        await supabase
          .from('renewal_document_reviews')
          .update({
            status: 'approved',
            auto_verified: true,
            reviewed_at: new Date().toISOString(),
          })
          .eq('order_id', orderId)
          .eq('document_type', doc.type);
      }
    }

    return res.status(200).json(validation);

  } catch (error: any) {
    console.error('Validation error:', error);
    return res.status(500).json({ error: 'Failed to validate documents' });
  }
}

async function validateOrder(order: any): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];

  // 1. Document Presence Checks
  const requiredDocs = ['drivers_license_front', 'drivers_license_back', 'proof_of_residence'];
  const uploadedDocs = (order.documents || []).map((d: any) => d.type);

  requiredDocs.forEach((docType) => {
    const hasDoc = uploadedDocs.includes(docType);
    checks.push({
      category: 'Document Presence',
      item: formatDocType(docType),
      status: hasDoc ? 'pass' : 'fail',
      message: hasDoc
        ? `${formatDocType(docType)} uploaded`
        : `Missing ${formatDocType(docType)}`,
      critical: true,
    });
  });

  // 2. Customer Information Completeness
  const requiredFields = [
    { field: 'customer_name', label: 'Customer Name' },
    { field: 'customer_email', label: 'Email' },
    { field: 'customer_phone', label: 'Phone' },
    { field: 'street_address', label: 'Address' },
    { field: 'city', label: 'City' },
    { field: 'zip_code', label: 'ZIP Code' },
  ];

  requiredFields.forEach(({ field, label }) => {
    const hasValue = order[field] && order[field].trim().length > 0;
    checks.push({
      category: 'Customer Information',
      item: label,
      status: hasValue ? 'pass' : 'fail',
      message: hasValue ? `${label} provided` : `Missing ${label}`,
      critical: true,
    });
  });

  // 3. Vehicle Information
  const hasPlate = order.license_plate && order.license_plate.trim().length > 0;
  checks.push({
    category: 'Vehicle Information',
    item: 'License Plate',
    status: hasPlate ? 'pass' : 'fail',
    message: hasPlate ? `Plate: ${order.license_plate}` : 'Missing license plate',
    critical: true,
  });

  // 4. Address Validation
  const isChicagoAddress = order.city?.toLowerCase() === 'chicago';
  checks.push({
    category: 'Address Validation',
    item: 'Chicago Address',
    status: isChicagoAddress ? 'pass' : 'warning',
    message: isChicagoAddress
      ? 'Address is in Chicago'
      : 'Address may not be in Chicago - verify eligibility',
    critical: false,
  });

  const hasValidZip = order.zip_code && /^\d{5}$/.test(order.zip_code);
  checks.push({
    category: 'Address Validation',
    item: 'ZIP Code Format',
    status: hasValidZip ? 'pass' : 'warning',
    message: hasValidZip ? 'ZIP code valid' : 'ZIP code format may be invalid',
    critical: false,
  });

  // 5. Payment Status
  const isPaid = order.payment_status === 'paid';
  checks.push({
    category: 'Payment',
    item: 'Payment Status',
    status: isPaid ? 'pass' : 'fail',
    message: isPaid
      ? `Payment received: $${order.total_amount}`
      : 'Payment not received',
    critical: true,
  });

  // 6. Email Format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const hasValidEmail = emailRegex.test(order.customer_email || '');
  checks.push({
    category: 'Contact Information',
    item: 'Email Format',
    status: hasValidEmail ? 'pass' : 'warning',
    message: hasValidEmail ? 'Email format valid' : 'Email format may be invalid',
    critical: false,
  });

  // 7. Phone Format
  const phoneRegex = /^\+?1?\d{10,}$/;
  const cleanPhone = (order.customer_phone || '').replace(/\D/g, '');
  const hasValidPhone = phoneRegex.test(cleanPhone);
  checks.push({
    category: 'Contact Information',
    item: 'Phone Format',
    status: hasValidPhone ? 'pass' : 'warning',
    message: hasValidPhone ? 'Phone format valid' : 'Phone format may be invalid',
    critical: false,
  });

  // Determine overall status
  const criticalFailures = checks.filter((c) => c.critical && c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warning');
  const allPassed = criticalFailures.length === 0;

  let overallStatus: 'pass' | 'warning' | 'fail';
  if (criticalFailures.length > 0) {
    overallStatus = 'fail';
  } else if (warnings.length > 0) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'pass';
  }

  // Auto-approve if all critical checks pass and no warnings
  const autoApproved = allPassed && warnings.length === 0;
  const requiresManualReview = criticalFailures.length > 0 || warnings.length > 2;

  return {
    orderId: order.id,
    overallStatus,
    checks,
    autoApproved,
    requiresManualReview,
  };
}

function formatDocType(docType: string): string {
  const formatted = docType
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return formatted;
}

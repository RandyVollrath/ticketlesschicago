/**
 * Customer City Sticker Renewal Intake API
 * Handles digital submission of renewal applications with document uploads
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';
import { maskEmail } from '../../../lib/mask-pii';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
  },
};

interface RenewalOrderData {
  partnerId: string;

  // Customer info
  customerName: string;
  customerEmail: string;
  customerPhone: string;

  // Vehicle info
  licensePlate: string;
  licenseState: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;

  // Address
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;

  // Sticker type
  stickerType: 'passenger' | 'large' | 'small' | 'motorcycle';

  // Fulfillment
  fulfillmentMethod: 'mail' | 'pickup';
  pickupLocation?: string;

  // Notes
  customerNotes?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data (including document uploads)
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 5, // License front/back + proof of residence
      multiples: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    // Extract form data
    const orderData: RenewalOrderData = {
      partnerId: getField(fields.partnerId),
      customerName: getField(fields.customerName),
      customerEmail: getField(fields.customerEmail),
      customerPhone: getField(fields.customerPhone),
      licensePlate: getField(fields.licensePlate),
      licenseState: getField(fields.licenseState) || 'IL',
      vin: getField(fields.vin),
      make: getField(fields.make),
      model: getField(fields.model),
      year: fields.year ? parseInt(getField(fields.year)) : undefined,
      streetAddress: getField(fields.streetAddress),
      city: getField(fields.city),
      state: getField(fields.state) || 'IL',
      zipCode: getField(fields.zipCode),
      stickerType: getField(fields.stickerType) as any,
      fulfillmentMethod: (getField(fields.fulfillmentMethod) || 'mail') as any,
      pickupLocation: getField(fields.pickupLocation),
      customerNotes: getField(fields.customerNotes),
    };

    // Validate required fields
    const requiredFields = [
      'partnerId', 'customerName', 'customerEmail', 'customerPhone',
      'licensePlate', 'streetAddress', 'city', 'zipCode', 'stickerType'
    ];

    for (const field of requiredFields) {
      if (!orderData[field as keyof RenewalOrderData]) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    // Get partner info (for pricing)
    const { data: partner, error: partnerError } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('id', orderData.partnerId)
      .eq('status', 'active')
      .single();

    if (partnerError || !partner) {
      return res.status(404).json({ error: 'Partner not found or inactive' });
    }

    // Calculate pricing
    const pricing = calculateStickerPrice(orderData.stickerType);
    const serviceFee = partner.service_fee_amount || 0;
    const totalAmount = pricing.stickerPrice + serviceFee;

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Upload documents to Supabase Storage
    const uploadedDocuments = await uploadDocuments(files, orderNumber);

    // Create renewal order
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .insert({
        order_number: orderNumber,
        partner_id: orderData.partnerId,
        customer_name: orderData.customerName,
        customer_email: orderData.customerEmail,
        customer_phone: orderData.customerPhone,
        license_plate: orderData.licensePlate.toUpperCase(),
        license_state: orderData.licenseState,
        vin: orderData.vin,
        make: orderData.make,
        model: orderData.model,
        year: orderData.year,
        street_address: orderData.streetAddress,
        city: orderData.city,
        state: orderData.state,
        zip_code: orderData.zipCode,
        sticker_type: orderData.stickerType,
        sticker_price: pricing.stickerPrice,
        service_fee: serviceFee,
        total_amount: totalAmount,
        fulfillment_method: orderData.fulfillmentMethod,
        pickup_location: orderData.pickupLocation,
        customer_notes: orderData.customerNotes,
        documents: uploadedDocuments,
        status: 'submitted',
        payment_status: 'pending',
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    // Log activity
    await logActivity(order.id, 'order_created', 'New renewal order submitted', null, 'customer');

    // Queue document verification
    for (const doc of uploadedDocuments) {
      await supabase.from('renewal_document_reviews').insert({
        order_id: order.id,
        document_type: doc.type,
        document_url: doc.url,
        status: 'pending',
      });
    }

    // Send confirmation email
    await sendOrderConfirmation(order, partner);

    // Webhook to partner
    if (partner.webhook_url) {
      await notifyPartner(partner.webhook_url, order);
    }

    return res.status(200).json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        status: order.status,
      },
      nextStep: 'payment',
      paymentUrl: `/renewal-intake/payment?order=${order.id}`,
    });

  } catch (error: any) {
    console.error('Renewal intake error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process renewal order',
    });
  }
}

function getField(field: string | string[] | undefined): string {
  if (Array.isArray(field)) return field[0];
  return field || '';
}

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RS-${year}-${random}`;
}

function calculateStickerPrice(stickerType: string): {
  stickerPrice: number;
  description: string;
} {
  // 2025 Chicago city sticker prices
  const prices: Record<string, { price: number; description: string }> = {
    passenger: { price: 100, description: 'Passenger Vehicle' },
    large: { price: 150, description: 'Large Vehicle (over 4,500 lbs)' },
    small: { price: 75, description: 'Small Vehicle (under 1,600 lbs)' },
    motorcycle: { price: 75, description: 'Motorcycle' },
  };

  const pricing = prices[stickerType] || prices.passenger;
  return { stickerPrice: pricing.price, description: pricing.description };
}

async function uploadDocuments(
  files: formidable.Files,
  orderNumber: string
): Promise<any[]> {
  const uploaded: any[] = [];
  const documentTypes = [
    'drivers_license_front',
    'drivers_license_back',
    'proof_of_residence',
    'vehicle_registration',
  ];

  for (const docType of documentTypes) {
    const fileArray = files[docType];
    const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;

    if (!file) continue;

    try {
      const buffer = fs.readFileSync(file.filepath);
      const extension = file.originalFilename?.split('.').pop() || 'jpg';
      const fileName = `${orderNumber}/${docType}.${extension}`;

      const { data, error } = await supabase.storage
        .from('renewal-documents')
        .upload(fileName, buffer, {
          contentType: file.mimetype || 'image/jpeg',
          upsert: true,
        });

      if (error) {
        console.error(`Upload failed for ${docType}:`, error);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('renewal-documents')
        .getPublicUrl(fileName);

      uploaded.push({
        type: docType,
        url: publicUrl,
        filename: file.originalFilename,
        uploaded_at: new Date().toISOString(),
        verified: false,
      });

      // Clean up temp file
      fs.unlinkSync(file.filepath);
    } catch (error) {
      console.error(`Error uploading ${docType}:`, error);
    }
  }

  return uploaded;
}

async function logActivity(
  orderId: string,
  activityType: string,
  description: string,
  metadata: any = null,
  performedByType: string = 'system'
) {
  await supabase.from('renewal_order_activity_log').insert({
    order_id: orderId,
    activity_type: activityType,
    description,
    performed_by_type: performedByType,
    metadata,
  });
}

async function sendOrderConfirmation(order: any, partner: any) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set, skipping order confirmation email');
    return;
  }

  const formattedAmount = (order.total_amount / 100).toFixed(2);
  const stickerTypeName = order.sticker_type === 'large'
    ? 'Large Vehicle (over 4,500 lbs)'
    : 'Standard Vehicle';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: order.customer_email,
        subject: `Order Received - City Sticker Renewal #${order.order_number}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Order Received!</h1>
              <p style="margin: 8px 0 0 0; opacity: 0.9;">Order #${order.order_number}</p>
            </div>

            <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
              <p style="color: #374151; font-size: 16px;">Hi ${order.customer_name.split(' ')[0]},</p>

              <p style="color: #374151; font-size: 16px;">
                We've received your city sticker renewal application. Here are your order details:
              </p>

              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <h3 style="margin: 0 0 12px 0; color: #1f2937; font-size: 14px; text-transform: uppercase;">Order Summary</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">License Plate</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${order.license_plate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Sticker Type</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${stickerTypeName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Address</td>
                    <td style="padding: 8px 0; color: #1f2937; text-align: right; font-weight: 600;">${order.street_address}</td>
                  </tr>
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0 0 0; color: #6b7280; font-weight: 600;">Total</td>
                    <td style="padding: 12px 0 0 0; color: #1f2937; text-align: right; font-weight: 700; font-size: 18px;">$${formattedAmount}</td>
                  </tr>
                </table>
              </div>

              <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 24px 0;">
                <p style="margin: 0; color: #1e40af; font-size: 14px;">
                  <strong>What happens next?</strong><br>
                  We'll review your application and documents. Once approved, we'll submit your renewal to the City of Chicago.
                  Your new city sticker will be mailed to your address within 7-10 business days.
                </p>
              </div>

              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Questions about your order? Reply to this email or contact us at
                <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
              </p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                ${partner?.name || 'Autopilot America'} • Powered by Autopilot America
              </p>
            </div>
          </div>
        `
      })
    });

    if (response.ok) {
      console.log(`✅ Sent order confirmation email to ${maskEmail(order.customer_email)}`);
    } else {
      const error = await response.text();
      console.error('Failed to send order confirmation email:', error);
    }
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
  }
}

async function notifyPartner(webhookUrl: string, order: any) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'renewal_order_created',
        order: {
          id: order.id,
          orderNumber: order.order_number,
          customer: {
            name: order.customer_name,
            email: order.customer_email,
            phone: order.customer_phone,
          },
          vehicle: {
            licensePlate: order.license_plate,
            state: order.license_state,
          },
          totalAmount: order.total_amount,
        },
      }),
    });
  } catch (error) {
    console.error('Partner webhook failed:', error);
  }
}

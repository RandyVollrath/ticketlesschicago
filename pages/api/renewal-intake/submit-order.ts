/**
 * Customer City Sticker Renewal Intake API
 * Handles digital submission of renewal applications with document uploads
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';

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
  // TODO: Implement email/SMS via Resend/Twilio
  console.log('Sending confirmation to:', order.customer_email);

  // Send email confirmation
  // Send SMS confirmation
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

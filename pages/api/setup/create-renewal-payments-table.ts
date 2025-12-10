import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Creating renewal_payments table...');

    // First check if table already exists
    const { data: existingData, error: checkError } = await supabase
      .from('renewal_payments')
      .select('id')
      .limit(1);

    if (!checkError) {
      console.log('✅ renewal_payments table already exists!');
      return res.status(200).json({ 
        success: true, 
        message: 'renewal_payments table already exists',
        recordCount: existingData?.length || 0
      });
    }

    // If table doesn't exist, provide SQL to run manually
    const createTableSQL = `
CREATE TABLE IF NOT EXISTS renewal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(user_id),
  renewal_type TEXT NOT NULL CHECK (renewal_type IN ('city_sticker', 'license_plate', 'emissions')),
  license_plate TEXT NOT NULL,
  renewal_amount DECIMAL(10,2) NOT NULL,
  service_fee DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  city_payment_status TEXT DEFAULT 'pending' CHECK (city_payment_status IN ('pending', 'paid', 'failed')),
  city_confirmation_number TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  due_date DATE NOT NULL,
  metadata JSONB
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_renewal_payments_user_id ON renewal_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_renewal_payments_payment_status ON renewal_payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_renewal_payments_city_payment_status ON renewal_payments(city_payment_status);
CREATE INDEX IF NOT EXISTS idx_renewal_payments_due_date ON renewal_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_renewal_payments_stripe_payment_intent ON renewal_payments(stripe_payment_intent_id);
    `;

    // Try to check if exec_sql function exists
    const { data: funcData, error: funcError } = await supabase.rpc('exec_sql', { 
      sql_query: 'SELECT 1 as test;' 
    });
    
    console.log('exec_sql test result:', { funcData, funcError });

    if (funcError) {
      console.log('exec_sql function not available:', funcError.message);
      return res.status(200).json({
        success: false,
        message: 'Table creation requires manual SQL execution',
        sql: createTableSQL,
        error: sanitizeErrorMessage(funcError),
        instructions: 'Please run this SQL in the Supabase SQL Editor or database console'
      });
    }

    // If exec_sql exists, try to create the table
    const { error: sqlError } = await supabase.rpc('exec_sql', { 
      sql_query: createTableSQL 
    });
    
    if (sqlError) {
      console.error('SQL execution error:', sqlError);
      return res.status(500).json({
        error: 'Failed to create table',
        sql: createTableSQL,
        instructions: 'You may need to run this SQL manually in Supabase'
      });
    }

    // Test the table after creation
    const { data, error: testError } = await supabase
      .from('renewal_payments')
      .select('id')
      .limit(1);

    if (testError) {
      return res.status(500).json({ error: 'Table created but test failed' });
    }

    console.log('✅ renewal_payments table created successfully!');
    
    res.status(200).json({ 
      success: true, 
      message: 'renewal_payments table created successfully',
      recordCount: data?.length || 0
    });

  } catch (error: any) {
    console.error('Setup error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
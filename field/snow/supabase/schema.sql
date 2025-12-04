-- SnowSOS Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: shovelers
CREATE TABLE IF NOT EXISTS shovelers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: jobs
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_phone TEXT NOT NULL,
    address TEXT NOT NULL,
    description TEXT,
    offered_price NUMERIC,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'cancelled')),
    shoveler_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_shovelers_phone ON shovelers(phone);
CREATE INDEX IF NOT EXISTS idx_shovelers_active ON shovelers(active);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_customer_phone ON jobs(customer_phone);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- Add comments for documentation
COMMENT ON TABLE customers IS 'Stores customer information';
COMMENT ON TABLE shovelers IS 'Stores shoveler/contractor information';
COMMENT ON TABLE jobs IS 'Stores snow removal job requests';

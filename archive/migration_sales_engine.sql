-- Consolidated Migration: Shwari Sales Engine & Revenue Tracking
-- Apply this in the Supabase SQL Editor

-- 1. Enrich Payments Table for detailed sales logging
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS product_model VARCHAR(100),
ADD COLUMN IF NOT EXISTS product_storage VARCHAR(50),
ADD COLUMN IF NOT EXISTS product_condition VARCHAR(50),
ADD COLUMN IF NOT EXISTS upsell_items TEXT;

-- 2. Update existing rows if necessary (optional)
-- UPDATE payments SET payment_status = 'confirmed' WHERE payment_status = 'verified';

-- 3. Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 4. Verify the schema
-- SELECT * FROM payments LIMIT 1;

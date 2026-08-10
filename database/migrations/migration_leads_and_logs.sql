-- Migration: Enrich leads and conversation_logs with structured data
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS transaction_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS product_model VARCHAR(100),
ADD COLUMN IF NOT EXISTS product_storage VARCHAR(50),
ADD COLUMN IF NOT EXISTS product_condition VARCHAR(50),
ADD COLUMN IF NOT EXISTS product_price VARCHAR(50),
ADD COLUMN IF NOT EXISTS upsell_items TEXT;

ALTER TABLE conversation_logs 
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS delivery_location TEXT,
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
ADD COLUMN IF NOT EXISTS transaction_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS product_model VARCHAR(100),
ADD COLUMN IF NOT EXISTS product_storage VARCHAR(50),
ADD COLUMN IF NOT EXISTS product_condition VARCHAR(50),
ADD COLUMN IF NOT EXISTS product_price VARCHAR(50),
ADD COLUMN IF NOT EXISTS upsell_items TEXT;

-- Verify columns (optional)
-- SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('leads', 'conversation_logs');

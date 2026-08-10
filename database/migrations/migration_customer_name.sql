-- Add customer_name to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Add customer_name to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Add customer_name to conversation_logs table
ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS customer_name TEXT;

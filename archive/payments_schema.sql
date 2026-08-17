-- ==============================================================================
-- SHWARI iPHONES WHATSAPP AGENT - ENHANCED PAYMENTS SCHEMA
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS public.payments;

CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_phone TEXT NOT NULL,
    transaction_code TEXT UNIQUE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_method TEXT DEFAULT 'M-Pesa',
    delivery_location TEXT,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_phone ON public.payments(customer_phone);
CREATE INDEX IF NOT EXISTS idx_payments_code ON public.payments(transaction_code);

-- Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Allow all access for now (Development/Dashboard)
CREATE POLICY "Enable all access" ON public.payments FOR ALL USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CRITICAL INDEXES for production scale (3,000+ msgs/day)
-- Run this once against your Supabase database.
-- ============================================================

-- conversation_logs: most queried by phone, ordered by time
CREATE INDEX IF NOT EXISTS idx_conv_logs_phone      ON conversation_logs(customer_phone);
CREATE INDEX IF NOT EXISTS idx_conv_logs_created    ON conversation_logs(created_at DESC);

-- leads: queried by phone (PK), by stage for pipeline views
CREATE INDEX IF NOT EXISTS idx_leads_stage          ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_last_contact   ON leads(last_contact DESC);
CREATE INDEX IF NOT EXISTS idx_leads_urgency        ON leads(urgency);

-- payments: queried per customer, per status
CREATE INDEX IF NOT EXISTS idx_payments_phone       ON payments(customer_phone);
CREATE INDEX IF NOT EXISTS idx_payments_status      ON payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_created     ON payments(created_at DESC);

-- pricelist: queried by availability for agent context
CREATE INDEX IF NOT EXISTS idx_general_availability  ON general_pricelist(availability);
CREATE INDEX IF NOT EXISTS idx_lipa_availability     ON lipa_mdogo_mdogo(availability);

-- Ensure image_url column exists (safe to run multiple times)
ALTER TABLE general_pricelist  ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE lipa_mdogo_mdogo   ADD COLUMN IF NOT EXISTS image_url TEXT;

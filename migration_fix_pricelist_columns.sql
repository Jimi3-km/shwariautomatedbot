-- ============================================================
-- FIX: Add missing columns to existing pricelist tables
-- Run this in Supabase SQL Editor once.
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================

-- general_pricelist — add all installment + image columns
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "Deposit"                TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "3 Months Plan"          TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "12 Weeks"               TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "Deposit_1"              TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "6 Months Plan"          TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "24 Weeks"               TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "full_price"             TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "lipa_mdogo_deposit"     TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "lipa_mdogo_weekly"      TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS "lipa_mdogo_duration_weeks" TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS notes                    TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS image_url                TEXT;
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE general_pricelist ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ DEFAULT NOW();

-- lipa_mdogo_mdogo — same safety net
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "Deposit"                TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "3 Months Plan"          TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "12 Weeks"               TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "Deposit_1"              TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "6 Months Plan"          TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "24 Weeks"               TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "full_price"             TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "lipa_mdogo_deposit"     TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "lipa_mdogo_weekly"      TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS "lipa_mdogo_duration_weeks" TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS notes                    TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS image_url                TEXT;
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ DEFAULT NOW();

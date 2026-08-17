-- ============================================================
-- REMOVE: 3 Months Plan and 6 Months Plan columns
-- Run this in Supabase SQL Editor once.
-- ============================================================

-- Drop columns from general_pricelist
ALTER TABLE general_pricelist DROP COLUMN IF EXISTS "3 Months Plan";
ALTER TABLE general_pricelist DROP COLUMN IF EXISTS "6 Months Plan";

-- Drop columns from lipa_mdogo_mdogo
ALTER TABLE lipa_mdogo_mdogo DROP COLUMN IF EXISTS "3 Months Plan";
ALTER TABLE lipa_mdogo_mdogo DROP COLUMN IF EXISTS "6 Months Plan";

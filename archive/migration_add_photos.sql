-- Migration: Add Photo Support to Products
-- Execute this using your Supabase/Neon SQL Editor

ALTER TABLE public.general_pricelist ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.lipa_mdogo_mdogo ADD COLUMN IF NOT EXISTS image_url TEXT;

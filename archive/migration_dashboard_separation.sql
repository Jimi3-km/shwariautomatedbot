-- Migration: Add inbox_number to payments table for store separation

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS inbox_number VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_payments_inbox_number ON public.payments(inbox_number);

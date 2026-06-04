-- Migration: Add inbox_number column to leads and conversation_logs
-- This tracks which WhatsApp phone number each lead/conversation came through.
-- Existing rows get NULL, which the dashboard treats as "Inbox 1".

ALTER TABLE leads ADD COLUMN IF NOT EXISTS inbox_number VARCHAR(30);
ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS inbox_number VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_leads_inbox_number ON leads(inbox_number);
CREATE INDEX IF NOT EXISTS idx_conv_logs_inbox_number ON conversation_logs(inbox_number);

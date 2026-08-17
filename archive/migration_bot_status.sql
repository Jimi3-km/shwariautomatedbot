-- Add bot_status column to track if AI or human is currently handling the lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bot_status VARCHAR(20) DEFAULT 'ai';

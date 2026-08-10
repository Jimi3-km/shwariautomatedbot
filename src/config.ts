import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export let config = {
  PORT: process.env.PORT || '3000',
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  // Dashboard & N8N Webhook integrations
  N8N_API_URL: process.env.N8N_API_URL || '',
  N8N_WEBHOOK_STUDENTS: (process.env.N8N_WEBHOOK_STUDENTS || '').trim(),
  N8N_WEBHOOK_ACCESSORIES: (process.env.N8N_WEBHOOK_ACCESSORIES || '').trim(),
  N8N_WEBHOOK_SEND_RECEIPT: (process.env.N8N_WEBHOOK_SEND_RECEIPT || '').trim(),
  // WhatsApp Cloud API credentials (for direct human reply)
  WHATSAPP_TOKEN_STUDENTS: (process.env.WHATSAPP_TOKEN_STUDENTS || '').trim(),
  WHATSAPP_TOKEN_ACCESSORIES: (process.env.WHATSAPP_TOKEN_ACCESSORIES || '').trim(),
  WHATSAPP_ID_STUDENTS: (process.env.WHATSAPP_ID_STUDENTS || '').trim(),
  WHATSAPP_ID_ACCESSORIES: (process.env.WHATSAPP_ID_ACCESSORIES || '').trim(),
  // Paystack & Billing
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  SUBSCRIPTION_PRICE: 18000,
  // Admin / Godmode user seeding (never hardcode — set in .env)
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_FULL_NAME: process.env.ADMIN_FULL_NAME || 'Admin',
};

export function updateConfig(newConfig: Record<string, string>) {
  config = { ...config, ...newConfig };

  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const envLines = envContent.split('\n');
  const envMap: Record<string, string> = {};

  envLines.forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const parts = line.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key) envMap[key] = val;
    }
  });

  for (const [key, value] of Object.entries(newConfig)) {
    envMap[key] = value;
  }

  const newEnvContent = Object.entries(envMap)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.writeFileSync(envPath, newEnvContent);
}

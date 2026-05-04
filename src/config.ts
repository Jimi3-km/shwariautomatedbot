import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export let config = {
  PORT: process.env.PORT || '3000',
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL || '',
  // Dashboard & N8N Webhook integrations
  N8N_API_URL: process.env.N8N_API_URL || '',
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

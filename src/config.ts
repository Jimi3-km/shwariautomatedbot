import fs from 'fs';
import path from 'path';
import { updateDbString, initDb } from './db.js';

export const config = {
  NEON_DATABASE_URL: process.env.NEON_DATABASE_URL || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || '',
  META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID || '',
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || 'shwari_verify_2024',
  N8N_API_URL: process.env.N8N_API_URL || '',
  N8N_WORKFLOW_ID: process.env.N8N_WORKFLOW_ID || '',
};

export function updateConfig(newConfig: Partial<typeof config>) {
  Object.assign(config, newConfig);
  
  // Update process.env
  for (const [k, v] of Object.entries(newConfig)) {
    if (v !== undefined) {
      process.env[k] = v;
    }
  }

  // Write to .env
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  const updatedLines: string[] = [];
  const existingKeys = new Set();

  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1];
      if (key in newConfig) {
        updatedLines.push(`${key}=${(newConfig as any)[key]}`);
        existingKeys.add(key);
      } else {
        updatedLines.push(line);
      }
    } else {
      updatedLines.push(line);
    }
  });

  for (const [k, v] of Object.entries(newConfig)) {
    if (!existingKeys.has(k) && v !== undefined) {
      updatedLines.push(`${k}=${v}`);
    }
  }

  fs.writeFileSync(envPath, updatedLines.join('\n'));

  // Re-init components using env
  if (newConfig.NEON_DATABASE_URL) {
    updateDbString(newConfig.NEON_DATABASE_URL);
    initDb();
  }
}

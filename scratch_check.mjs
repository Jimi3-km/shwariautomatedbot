import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function check() {
  const { data: turns } = await supabase
    .from('audit_events')
    .select('*')
    .eq('event_type', 'agent_turn')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('--- RECENT AGENT TURNS ---');
  for (const t of turns || []) {
    console.log(`\nTurn at ${t.created_at}`);
    console.log(`Input:`, t.details?.input);
    console.log(`Reply:`, t.details?.reply);
    console.log(`Tools invoked:`, t.details?.tools_invoked);
  }
}

check().catch(console.error);

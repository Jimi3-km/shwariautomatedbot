import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function check() {
  const { data: turns } = await supabase
    .from('audit_events')
    .select('*')
    .eq('event_type', 'agent_turn')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('--- RECENT AGENT TURNS ---');
  for (const t of turns || []) {
    console.log(`\nTurn at ${t.created_at}`);
    console.log(`Input:`, t.details?.input);
    console.log(`Reply:`, t.details?.reply);
    console.log(`Tools invoked:`, t.details?.tools_invoked);
  }
}

check().catch(console.error);

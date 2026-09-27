import { config } from 'dotenv';
config();
import { serviceClient } from './src/server/supabase.js';

async function check() {
  const { data: turns } = await serviceClient
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

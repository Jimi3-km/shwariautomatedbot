import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function check() {
  const { data: events } = await supabase
    .from('audit_events')
    .select('event_type, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(events);
}
check().catch(console.error);

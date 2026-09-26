/**
 * CLI Tool to export labeled agent turns into a JSONL dataset for automated
 * regression testing and LLM evaluation benchmarks.
 *
 * Usage:
 *   npx tsx scripts/export-eval-dataset.ts [--out filename.jsonl] [--tenant tenant-id] [--labeled-only]
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { serviceClient } from '../src/server/supabase.js';

interface TurnLabel {
  turn_event_id: number | string;
  label: string;
  tags: string[];
  notes: string;
}

function detectLanguage(text: string): 'sw' | 'sheng' | 'en' {
  const lower = text.toLowerCase();
  const sheng = ['niaje', 'sasa', 'mambo', 'rada', 'manze', 'aje', 'maze', 'fiti'];
  const swahili = ['habari', 'jambo', 'karibu', 'asante', 'tafadhali', 'bei', 'huduma', 'kazi', 'pesa'];

  if (sheng.some((w) => lower.includes(w))) return 'sheng';
  if (swahili.some((w) => lower.includes(w))) return 'sw';
  return 'en';
}

async function main() {
  const args = process.argv.slice(2);
  let outFile = 'eval-dataset.jsonl';
  let targetTenant: string | null = null;
  let labeledOnly = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outFile = args[i + 1];
      i++;
    } else if (args[i] === '--tenant' && args[i + 1]) {
      targetTenant = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      labeledOnly = false;
    }
  }

  console.log(`[export] Fetching agent turns (tenant: ${targetTenant || 'all'}, labeled_only: ${labeledOnly})...`);

  let query = serviceClient
    .from('audit_events')
    .select('id, tenant_id, agent_role, created_at, details')
    .eq('action', 'agent.turn')
    .eq('resource_type', 'llm_turn')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (targetTenant) {
    query = query.eq('tenant_id', targetTenant);
  }

  const { data: turns, error } = await query;
  if (error) {
    console.error('[export] Failed to query audit_events:', error.message);
    process.exitCode = 1;
    return;
  }

  const turnList = turns ?? [];
  const turnIds = turnList.map((t) => t.id);

  let labelsMap = new Map<number | string, TurnLabel>();
  if (turnIds.length > 0) {
    const { data: labels, error: labelErr } = await serviceClient
      .from('agent_turn_labels')
      .select('*')
      .in('turn_event_id', turnIds);

    if (labelErr) {
      console.warn('[export] Warning fetching labels:', labelErr.message);
    } else if (labels) {
      labelsMap = new Map((labels as TurnLabel[]).map((l) => [l.turn_event_id, l]));
    }
  }

  const entries: Array<Record<string, unknown>> = [];

  for (const t of turnList) {
    const label = labelsMap.get(t.id);
    if (labeledOnly && !label) continue;

    const input = t.details?.input_preview || '';
    const actualTools = t.details?.tools_invoked || [];
    const expectedTools = label?.tags?.filter((tag: string) => !['hallucination', 'slow', 'formatting'].includes(tag)) || [];

    entries.push({
      input,
      expected_tools: expectedTools,
      actual_tools: actualTools,
      role: t.agent_role,
      channel: t.details?.channel_type || 'unknown',
      language_hint: detectLanguage(input),
      label: label?.label || 'unlabeled',
      notes: label?.notes || '',
      model_profile: t.details?.model_profile || 'primary',
      id: t.id,
      tenant_id: t.tenant_id,
      created_at: t.created_at,
    });
  }

  const targetPath = path.resolve(process.cwd(), outFile);
  const jsonlContent = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  fs.writeFileSync(targetPath, jsonlContent, 'utf-8');

  console.log(`[export] Successfully exported ${entries.length} turns to ${targetPath}`);
}

main().catch((err) => {
  console.error('[export] Unexpected error:', err);
  process.exitCode = 1;
});

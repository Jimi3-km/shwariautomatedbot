import { serviceClient } from '../supabase.js';
import { complete } from './llm.js';
import { ensureWorkforce } from './agent.js';
import { DEPARTMENTS, AGENT_BLUEPRINTS, type AgentRole } from './roles.js';

/**
 * Which department should answer a customer.
 *
 * One cheap model call that returns a single word. It is a classification, not
 * a conversation: no tools, a tiny budget, and a default of sales when the
 * answer is not one of the four — a misrouted message still gets a competent
 * reply, whereas a failed route gets none.
 *
 * Departments that are switched off are never offered, so an owner turning
 * bookings off means booking questions land with sales rather than with an
 * agent that will not answer.
 */

const FALLBACK: AgentRole = 'sales';

export interface Routed {
  role: AgentRole;
  /** True when a model chose; false when we fell back without asking. */
  classified: boolean;
}

export async function chooseDepartment(tenantId: string, text: string): Promise<Routed | null> {
  /**
   * A customer can arrive before anyone has opened the dashboard. Without this
   * the query below finds nothing, every customer message falls through to the
   * n8n pipeline, and the departments never answer anyone until an owner
   * happens to visit the AI team page.
   */
  await ensureWorkforce(tenantId);

  const { data: rows } = await serviceClient
    .from('agents')
    .select('role, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  const live = (rows ?? [])
    .map((r) => r.role as AgentRole)
    .filter((r) => DEPARTMENTS.includes(r));

  // Nothing to route to. The caller falls back to the existing pipeline.
  if (!live.length) return null;
  if (live.length === 1) return { role: live[0], classified: false };

  const menu = live
    .map((role) => `${role}: ${AGENT_BLUEPRINTS[role].summary}`)
    .join('\n');

  try {
    const result = await complete({
      messages: [
        {
          role: 'system',
          content:
            `Route this customer message to one department. Reply with exactly one word from: ${live.join(', ')}. No punctuation, no explanation.\n\n${menu}`,
        },
        { role: 'user', content: text.slice(0, 1000) },
      ],
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 15_000,
    });

    const answer = (result.text ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const chosen = live.find((r) => r === answer);
    if (chosen) return { role: chosen, classified: true };

    console.warn(`[router] no department matched "${answer}"; using ${FALLBACK}`);
  } catch (e) {
    console.warn('[router] classification failed:', e instanceof Error ? e.message : e);
  }

  return { role: live.includes(FALLBACK) ? FALLBACK : live[0], classified: false };
}

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

/** A message too short to carry a topic of its own: "yes", "ok", "10am", "the second one". */
function isShortFollowUp(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 24 && t.split(/\s+/).length <= 4;
}

/** The department that last answered in this conversation, if it recorded one. */
async function lastDepartment(tenantId: string, conversationId: string): Promise<AgentRole | null> {
  const { data } = await serviceClient
    .from('agent_tool_calls')
    .select('agent_role, created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);
  const role = Array.isArray(data) ? (data[0]?.agent_role as AgentRole | undefined) : undefined;
  return role && DEPARTMENTS.includes(role) ? role : null;
}

export async function chooseDepartment(
  tenantId: string,
  text: string,
  conversationId?: string | null
): Promise<Routed | null> {
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

  // "Yes" belongs to whoever asked the question. Re-classifying a bare
  // confirmation would hand a half-finished booking to sales mid-sentence.
  if (conversationId && isShortFollowUp(text)) {
    const previous = await lastDepartment(tenantId, conversationId).catch(() => null);
    if (previous && live.includes(previous)) return { role: previous, classified: false };
  }

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
      // One word. Reasoning is forced off: with it on, the thinking alone would
      // use the whole budget and the answer would come back empty.
      maxTokens: 16,
      thinking: false,
      profile: 'fast',
      timeoutMs: 10_000,
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

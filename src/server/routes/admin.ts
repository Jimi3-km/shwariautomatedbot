import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin, isSuperAdmin, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';

export const adminRouter = Router();

// Restrict all /api/admin/* endpoints to authenticated users with admin or owner role
adminRouter.use('/admin', requireAuth, requireAdmin);

export interface TurnLabel {
  id: string;
  turn_event_id: number | string;
  tenant_id: string;
  labeled_by: string | null;
  label: 'ok' | 'needs_improvement' | 'bug';
  tags: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AgentTurnRecord {
  id: number | string;
  tenant_id: string;
  agent_role: string;
  created_at: string;
  details: {
    model_profile?: string;
    model_name?: string | null;
    conversation_id?: string | null;
    channel_type?: string | null;
    input_preview?: string;
    tools_invoked?: string[];
    duration_ms?: number;
    status?: string;
    error?: string | null;
    reply_preview?: string | null;
  };
  label: TurnLabel | null;
}

function detectLanguageHint(text: string): 'sw' | 'sheng' | 'en' {
  const lower = text.toLowerCase();
  const shengKeywords = ['niaje', 'sasa', 'mambo', 'rada', 'manze', 'aje', 'maze', 'fiti'];
  const swahiliKeywords = ['habari', 'jambo', 'karibu', 'asante', 'tafadhali', 'bei', 'huduma', 'kazi', 'pesa'];

  if (shengKeywords.some((k) => lower.includes(k))) return 'sheng';
  if (swahiliKeywords.some((k) => lower.includes(k))) return 'sw';
  return 'en';
}

/**
 * GET /api/admin/agent-turns
 *
 * Query agent turns with filters for role, channel, model profile, status, tool,
 * date range, and label state.
 */
adminRouter.get(
  '/admin/agent-turns',
  handler(async (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const superAdmin = isSuperAdmin(req);

    // Tenant scoping: super-admin may specify a tenant_id or query globally;
    // normal tenant admins are strictly scoped to their own tenant.
    let targetTenantId: string | null = ctx.tenantId;
    if (superAdmin) {
      targetTenantId = typeof req.query.tenant_id === 'string' && req.query.tenant_id ? req.query.tenant_id : null;
    }

    const {
      role,
      channel_type,
      model_profile,
      status,
      tool,
      label,
      start_date,
      end_date,
      limit: rawLimit,
      offset: rawOffset,
    } = req.query;

    const limit = Math.min(Math.max(parseInt(String(rawLimit || '50'), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(rawOffset || '0'), 10) || 0, 0);

    let query = serviceClient
      .from('audit_events')
      .select('id, tenant_id, actor_id, actor_type, agent_role, action, resource_type, details, created_at', {
        count: 'exact',
      })
      .eq('action', 'agent.turn')
      .eq('resource_type', 'llm_turn')
      .order('created_at', { ascending: false });

    if (targetTenantId) {
      query = query.eq('tenant_id', targetTenantId);
    }
    if (typeof role === 'string' && role) {
      query = query.eq('agent_role', role);
    }
    if (typeof channel_type === 'string' && channel_type) {
      query = query.contains('details', { channel_type });
    }
    if (typeof model_profile === 'string' && model_profile) {
      query = query.contains('details', { model_profile });
    }
    if (typeof status === 'string' && status) {
      query = query.contains('details', { status });
    }
    if (typeof start_date === 'string' && start_date) {
      query = query.gte('created_at', start_date);
    }
    if (typeof end_date === 'string' && end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: turns, count, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      console.error('[admin] failed to fetch agent turns:', error.message);
      return res.status(500).json({ error: 'Failed to fetch agent turns' });
    }

    const turnList = (turns ?? []) as Array<{
      id: number;
      tenant_id: string;
      agent_role: string;
      created_at: string;
      details: AgentTurnRecord['details'];
    }>;

    // Fetch matching labels for these turns
    const turnIds = turnList.map((t) => t.id);
    let labelsMap = new Map<number | string, TurnLabel>();

    if (turnIds.length > 0) {
      const { data: labels, error: labelErr } = await serviceClient
        .from('agent_turn_labels')
        .select('*')
        .in('turn_event_id', turnIds);

      if (!labelErr && labels) {
        labelsMap = new Map((labels as TurnLabel[]).map((l) => [l.turn_event_id, l]));
      }
    }

    // Assemble turn records with attached labels
    let records: AgentTurnRecord[] = turnList.map((t) => ({
      id: t.id,
      tenant_id: t.tenant_id,
      agent_role: t.agent_role,
      created_at: t.created_at,
      details: t.details || {},
      label: labelsMap.get(t.id) ?? null,
    }));

    // Post-filter by tool if requested
    if (typeof tool === 'string' && tool.trim()) {
      const toolQuery = tool.trim().toLowerCase();
      records = records.filter((r) =>
        (r.details.tools_invoked ?? []).some((t) => t.toLowerCase().includes(toolQuery))
      );
    }

    // Post-filter by label if requested
    if (typeof label === 'string' && label) {
      if (label === 'unlabeled') {
        records = records.filter((r) => !r.label);
      } else {
        records = records.filter((r) => r.label?.label === label);
      }
    }

    return res.json({
      turns: records,
      total: count ?? records.length,
      limit,
      offset,
    });
  })
);

/**
 * POST /api/admin/agent-turns/:id/label
 *
 * Apply or update quality label, tags, and evaluation notes for an agent turn.
 */
adminRouter.post(
  '/admin/agent-turns/:id/label',
  handler(async (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const superAdmin = isSuperAdmin(req);
    const turnId = parseInt(req.params.id, 10);

    if (isNaN(turnId)) {
      return res.status(400).json({ error: 'Invalid turn ID' });
    }

    const { label, tags, notes } = req.body || {};

    if (!['ok', 'needs_improvement', 'bug'].includes(label)) {
      return res.status(400).json({ error: 'label must be one of: ok, needs_improvement, bug' });
    }

    // Validate that the turn event exists and caller has authority over its tenant
    const { data: event, error: eventErr } = await serviceClient
      .from('audit_events')
      .select('id, tenant_id')
      .eq('id', turnId)
      .eq('action', 'agent.turn')
      .maybeSingle();

    if (eventErr || !event) {
      return res.status(404).json({ error: 'Agent turn not found' });
    }

    if (!superAdmin && event.tenant_id !== ctx.tenantId) {
      return res.status(403).json({ error: 'Forbidden: Cannot label turn from another tenant' });
    }

    const payload = {
      turn_event_id: turnId,
      tenant_id: event.tenant_id,
      labeled_by: ctx.userId,
      label,
      tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
      notes: typeof notes === 'string' ? notes.trim() : '',
      updated_at: new Date().toISOString(),
    };

    const { data: savedLabel, error: saveErr } = await serviceClient
      .from('agent_turn_labels')
      .upsert(payload, { onConflict: 'turn_event_id' })
      .select('*')
      .single();

    if (saveErr) {
      console.error('[admin] failed to save turn label:', saveErr.message);
      return res.status(500).json({ error: 'Failed to save label' });
    }

    return res.json({ ok: true, label: savedLabel });
  })
);

/**
 * GET /api/admin/agent-turns/export
 *
 * Export labeled turns as a JSONL benchmark dataset for offline evaluation,
 * LLM regression testing, and fine-tuning.
 */
adminRouter.get(
  '/admin/agent-turns/export',
  handler(async (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const superAdmin = isSuperAdmin(req);

    let targetTenantId: string | null = ctx.tenantId;
    if (superAdmin) {
      targetTenantId = typeof req.query.tenant_id === 'string' && req.query.tenant_id ? req.query.tenant_id : null;
    }

    const { label, role, labeled_only } = req.query;

    let query = serviceClient
      .from('audit_events')
      .select('id, tenant_id, agent_role, created_at, details')
      .eq('action', 'agent.turn')
      .eq('resource_type', 'llm_turn')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (targetTenantId) {
      query = query.eq('tenant_id', targetTenantId);
    }
    if (typeof role === 'string' && role) {
      query = query.eq('agent_role', role);
    }

    const { data: turns, error: turnErr } = await query;
    if (turnErr) {
      return res.status(500).json({ error: 'Failed to fetch turns for export' });
    }

    const turnList = turns ?? [];
    const turnIds = turnList.map((t) => t.id);

    let labelsMap = new Map<number | string, TurnLabel>();
    if (turnIds.length > 0) {
      const { data: labels } = await serviceClient
        .from('agent_turn_labels')
        .select('*')
        .in('turn_event_id', turnIds);

      if (labels) {
        labelsMap = new Map((labels as TurnLabel[]).map((l) => [l.turn_event_id, l]));
      }
    }

    const datasetEntries = [];

    for (const t of turnList) {
      const labelObj = labelsMap.get(t.id) ?? null;
      if (labeled_only === 'true' && !labelObj) {
        continue;
      }
      if (typeof label === 'string' && label && labelObj?.label !== label) {
        continue;
      }

      const input = t.details?.input_preview || '';
      const reply = t.details?.reply_preview || '';
      const actualTools = t.details?.tools_invoked || [];
      const expectedTools = labelObj?.tags?.filter((tag: string) => !['hallucination', 'slow', 'formatting'].includes(tag)) || [];

      datasetEntries.push({
        id: t.id,
        tenant_id: t.tenant_id,
        role: t.agent_role,
        channel: t.details?.channel_type || 'unknown',
        language_hint: detectLanguageHint(input),
        input,
        reply,
        actual_tools: actualTools,
        expected_tools: expectedTools,
        label: labelObj?.label || 'unlabeled',
        tags: labelObj?.tags || [],
        notes: labelObj?.notes || '',
        model_profile: t.details?.model_profile || 'primary',
        duration_ms: t.details?.duration_ms || null,
        created_at: t.created_at,
      });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shwari-eval-dataset-${new Date().toISOString().slice(0, 10)}.jsonl"`
    );

    for (const entry of datasetEntries) {
      res.write(JSON.stringify(entry) + '\n');
    }
    return res.end();
  })
);

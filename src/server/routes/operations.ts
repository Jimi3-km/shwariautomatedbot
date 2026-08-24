import { Router } from 'express';
import { requireAuth, requireWrite, handler } from '../auth.js';

export const operationsRouter = Router();

/**
 * Appointments, tickets and follow-ups for the dashboard.
 *
 * These read and write the same rows the agents do, through the caller's own
 * RLS-scoped client rather than the service role — so a person sees exactly
 * their own tenant's work, and a viewer cannot change any of it.
 *
 * The point of these endpoints is oversight: everything an agent booked,
 * opened or queued is visible here and correctable by hand.
 */

const APPOINTMENT_STATES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
const TICKET_STATES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

operationsRouter.get(
  '/appointments',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('appointments')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('starts_at')
      .limit(Math.min(Number(req.query.limit) || 200, 500));

    if (req.query.status) q = q.eq('status', String(req.query.status));
    // Default to the diary from today forward; history is available on request.
    q = req.query.from
      ? q.gte('starts_at', String(req.query.from))
      : q.gte('starts_at', new Date(Date.now() - 86_400_000).toISOString());
    if (req.query.to) q = q.lte('starts_at', String(req.query.to));

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ appointments: data ?? [] });
  })
);

operationsRouter.post(
  '/appointments',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const serviceName = String(req.body?.service_name || '').trim();
    const startsAt = String(req.body?.starts_at || '');

    if (!serviceName) return res.status(400).json({ error: 'A service is required.' });
    if (Number.isNaN(new Date(startsAt).getTime())) {
      return res.status(400).json({ error: 'A valid date and time is required.' });
    }

    const duration = Number(req.body?.duration_minutes ?? 30);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 480) {
      return res.status(400).json({ error: 'Length must be between 1 and 480 minutes.' });
    }

    const { data, error } = await ctx.db
      .from('appointments')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: req.body?.lead_id ?? null,
        customer_id: req.body?.customer_id ?? null,
        customer_name: req.body?.customer_name ?? null,
        channel_type: req.body?.channel_type ?? null,
        service_name: serviceName,
        starts_at: new Date(startsAt).toISOString(),
        duration_minutes: Math.round(duration),
        notes: req.body?.notes ?? null,
        // Null, not a role name: a person booked this, and the column is what
        // tells the two apart.
        booked_by_agent: null,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

operationsRouter.patch(
  '/appointments/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (req.body?.status !== undefined) {
      if (!(APPOINTMENT_STATES as readonly string[]).includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${APPOINTMENT_STATES.join(', ')}` });
      }
      updates.status = req.body.status;
    }
    if (req.body?.starts_at !== undefined) {
      const when = new Date(String(req.body.starts_at));
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'That is not a valid time.' });
      updates.starts_at = when.toISOString();
    }
    if (req.body?.notes !== undefined) updates.notes = req.body.notes;

    const { data, error } = await ctx.db
      .from('appointments').update(updates)
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('*').maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Appointment not found' });
    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

operationsRouter.get(
  '/tickets',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('support_tickets')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500));

    if (req.query.status) q = q.eq('status', String(req.query.status));

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ tickets: data ?? [] });
  })
);

operationsRouter.post(
  '/tickets',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'A subject is required.' });

    const priority = String(req.body?.priority || 'normal');
    if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${TICKET_PRIORITIES.join(', ')}` });
    }

    const { data, error } = await ctx.db
      .from('support_tickets')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: req.body?.lead_id ?? null,
        conversation_id: req.body?.conversation_id ?? null,
        customer_name: req.body?.customer_name ?? null,
        subject: subject.slice(0, 200),
        body: String(req.body?.body || '').slice(0, 4000),
        priority,
        opened_by_agent: null,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

operationsRouter.patch(
  '/tickets/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (req.body?.status !== undefined) {
      if (!(TICKET_STATES as readonly string[]).includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${TICKET_STATES.join(', ')}` });
      }
      updates.status = req.body.status;
      if (req.body.status === 'resolved' || req.body.status === 'closed') {
        updates.resolved_at = new Date().toISOString();
      }
    }
    if (req.body?.priority !== undefined) {
      if (!(TICKET_PRIORITIES as readonly string[]).includes(req.body.priority)) {
        return res.status(400).json({ error: `priority must be one of: ${TICKET_PRIORITIES.join(', ')}` });
      }
      updates.priority = req.body.priority;
    }
    if (req.body?.resolution !== undefined) updates.resolution = req.body.resolution;
    // Assignment is taken from the session when claiming, never from the body,
    // so a caller cannot assign work to somebody else's account.
    if (req.body?.claim === true) updates.assigned_to = ctx.userId;

    const { data, error } = await ctx.db
      .from('support_tickets').update(updates)
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('*').maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Ticket not found' });
    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

operationsRouter.get(
  '/follow-ups',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('follow_ups')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('due_at')
      .limit(Math.min(Number(req.query.limit) || 200, 500));

    q = req.query.status ? q.eq('status', String(req.query.status)) : q.eq('status', 'pending');

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ follow_ups: data ?? [] });
  })
);

/**
 * Cancel a queued follow-up.
 *
 * The row is kept and marked cancelled rather than deleted, so "the AI was
 * going to send this and I stopped it" stays visible.
 */
operationsRouter.delete(
  '/follow-ups/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('follow_ups')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).eq('status', 'pending')
      .select('id').maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'That follow-up is not waiting to be sent.' });
    res.json({ cancelled: true });
  })
);

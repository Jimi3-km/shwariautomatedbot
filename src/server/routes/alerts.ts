import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, requireOwner, handler } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
import {
  ALERT_KINDS, alertTemplateStatus, deliverAlert, getAlertSettings, listRecipients, normalisePhone,
} from '../services/alerts.js';
import { rateLimit } from '../channels/webchat/rateLimit.js';

/**
 * Alerts to the owner's phone: which WhatsApp numbers get them, which kinds of
 * news, and whether linked Telegram chats get them too.
 *
 * The owner decides who is alerted. Managers can see the set-up.
 */
export const alertsRouter = Router();

const MAX_RECIPIENTS = 10;

alertsRouter.get(
  '/alerts',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const [settings, recipients, channels, links] = await Promise.all([
      getAlertSettings(ctx.tenantId),
      listRecipients(ctx.tenantId),
      serviceClient.from('channels').select('channel_type, display_name')
        .eq('tenant_id', ctx.tenantId).eq('status', 'active').in('channel_type', ['whatsapp', 'telegram']),
      serviceClient.from('shwari_admins').select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).eq('channel_type', 'telegram'),
    ]);
    const wa = (channels.data ?? []).find((c) => c.channel_type === 'whatsapp');
    const tg = (channels.data ?? []).find((c) => c.channel_type === 'telegram');

    res.json({
      kinds: settings.kinds,
      all_kinds: ALERT_KINDS,
      telegram_enabled: settings.telegram,
      recipients,
      whatsapp: {
        connected: Boolean(wa),
        number: wa?.display_name ?? null,
        // Only worth asking WhatsApp when there is someone to alert.
        template: wa && recipients.length ? await alertTemplateStatus(ctx.tenantId, { create: true }) : null,
      },
      telegram: { connected: Boolean(tg), linked_chats: links.count ?? 0 },
    });
  })
);

alertsRouter.put(
  '/alerts',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const patch: Record<string, unknown> = {};
    if (Array.isArray(req.body?.kinds)) {
      patch.alert_kinds = [...new Set(req.body.kinds as unknown[])]
        .filter((k): k is string => typeof k === 'string' && (ALERT_KINDS as readonly string[]).includes(k));
    }
    if (typeof req.body?.telegram_enabled === 'boolean') patch.alert_telegram = req.body.telegram_enabled;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });

    const { error } = await serviceClient.from('tenants').update(patch).eq('id', ctx.tenantId);
    if (error) return res.status(500).json({ error: 'Those settings could not be saved.' });
    res.json(await getAlertSettings(ctx.tenantId));
  })
);

alertsRouter.post(
  '/alerts/recipients',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const address = normalisePhone(String(req.body?.phone ?? ''));
    if (!address) {
      return res.status(400).json({
        error: 'Enter the number with its country code, for example +254712345678.',
      });
    }
    const label = String(req.body?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;

    const existing = await listRecipients(ctx.tenantId);
    if (existing.some((r) => r.address === address)) {
      return res.status(409).json({ error: 'That number is already on the list.' });
    }
    if (existing.length >= MAX_RECIPIENTS) {
      return res.status(409).json({ error: `You can alert up to ${MAX_RECIPIENTS} numbers.` });
    }
    // The business's own WhatsApp number cannot message itself.
    const { data: own } = await serviceClient.from('channels').select('display_name')
      .eq('tenant_id', ctx.tenantId).eq('channel_type', 'whatsapp').eq('status', 'active');
    if ((own ?? []).some((c) => String(c.display_name ?? '').replace(/\D/g, '').endsWith(address))) {
      return res.status(400).json({
        error: "That is your business's own WhatsApp number. Alerts must go to a different number.",
      });
    }

    const { data, error } = await serviceClient
      .from('notification_recipients')
      .insert({ tenant_id: ctx.tenantId, channel: 'whatsapp', address, label, created_by: ctx.userId })
      .select('id, channel, address, label, active, last_sent_at, last_error')
      .single();
    if (error || !data) return res.status(500).json({ error: 'That number could not be added.' });

    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'alerts.recipient_added', resourceType: 'alerts', resourceId: data.id,
      details: { summary: `Added +${address} to receive WhatsApp alerts` },
    });
    // Ask WhatsApp for the alert template now, so it is approved by the time
    // the first real alert is due.
    void alertTemplateStatus(ctx.tenantId, { create: true, fresh: true });
    res.status(201).json(data);
  })
);

alertsRouter.patch(
  '/alerts/recipients/:id',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Nothing to change.' });
    const { data, error } = await serviceClient
      .from('notification_recipients').update({ active: req.body.active })
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('id, channel, address, label, active, last_sent_at, last_error').maybeSingle();
    if (error) return res.status(500).json({ error: 'That could not be saved.' });
    if (!data) return res.status(404).json({ error: 'Number not found' });
    res.json(data);
  })
);

alertsRouter.delete(
  '/alerts/recipients/:id',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await serviceClient
      .from('notification_recipients').delete()
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).select('id, address').maybeSingle();
    if (error) return res.status(500).json({ error: 'That number could not be removed.' });
    if (!data) return res.status(404).json({ error: 'Number not found' });
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'alerts.recipient_removed', resourceType: 'alerts', resourceId: data.id,
      details: { summary: `Removed +${data.address} from WhatsApp alerts` },
    });
    res.json({ ok: true });
  })
);

/** Send a test alert now and say, per number, whether it went. */
alertsRouter.post(
  '/alerts/test',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const limit = rateLimit(`alerts:test:${ctx.tenantId}`, 5, 10 * 60_000);
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Too many tests in a short time. Try again in a few minutes.' });
    }
    const results = await deliverAlert(
      ctx.tenantId, 'test',
      { title: 'Test alert', body: 'This is how alerts from your business will arrive.', link: '/settings' },
      { force: true }
    );
    res.json({ results });
  })
);

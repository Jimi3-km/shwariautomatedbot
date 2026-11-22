import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, requireOwner, handler } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
import {
  ALERT_KINDS, AlertSetupError, alertTemplateStatus, confirmTelegramLink, deliverAlert, getAlertSettings,
  getNotificationBot, listRecipients, normalisePhone, removeNotificationBot, requestAllTemplates,
  setNotificationBot, startTelegramLink,
} from '../services/alerts.js';
import { runInBackground } from '../services/background.js';
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
    const [settings, recipients, bot, channels, links] = await Promise.all([
      getAlertSettings(ctx.tenantId),
      listRecipients(ctx.tenantId),
      getNotificationBot(ctx.tenantId),
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
        template: wa && recipients.some((r) => r.channel === 'whatsapp')
          ? await alertTemplateStatus(ctx.tenantId, { create: true }) : null,
      },
      telegram: {
        connected: Boolean(tg),
        linked_chats: links.count ?? 0,
        // The bot the owner set up for alerts. Its token is never returned.
        bot: bot ? { username: bot.username, name: bot.name } : null,
      },
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

    const existing = (await listRecipients(ctx.tenantId)).filter((r) => r.channel === 'whatsapp');
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
    // Ask WhatsApp for the alert messages now, so they are approved by the
    // time the first real alert is due.
    void runInBackground('alerts', () => requestAllTemplates(ctx.tenantId));
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
      details: { summary: 'Removed someone from the alerts' },
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Telegram: the owner's notification bot
// ---------------------------------------------------------------------------

function sendSetupError(res: import('express').Response, e: unknown, fallback: string) {
  if (e instanceof AlertSetupError) return res.status(400).json({ error: e.message });
  console.error('[alerts] telegram bot setup failed:', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: fallback });
}

/** Set (or replace) the bot that sends this business's alerts. */
alertsRouter.put(
  '/alerts/telegram-bot',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    try {
      const bot = await setNotificationBot(ctx.tenantId, String(req.body?.token ?? ''), ctx.userId);
      void logAuditEvent({
        tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
        action: 'alerts.telegram_bot_set', resourceType: 'alerts',
        details: { summary: `Set @${bot.username ?? 'a bot'} as the Telegram notification bot` },
      });
      res.json({ bot });
    } catch (e) {
      sendSetupError(res, e, 'The bot could not be saved. Please try again.');
    }
  })
);

alertsRouter.delete(
  '/alerts/telegram-bot',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    await removeNotificationBot(ctx.tenantId);
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'alerts.telegram_bot_removed', resourceType: 'alerts',
      details: { summary: 'Removed the Telegram notification bot' },
    });
    res.json({ ok: true });
  })
);

/** A link to open in Telegram; pressing Start there joins the alerts. */
alertsRouter.post(
  '/alerts/telegram-bot/link',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    try {
      res.json(await startTelegramLink(req.ctx!.tenantId));
    } catch (e) {
      sendSetupError(res, e, 'A link could not be created. Please try again.');
    }
  })
);

/** Add whoever has pressed Start since the link was made. */
alertsRouter.post(
  '/alerts/telegram-bot/confirm',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    try {
      res.json(await confirmTelegramLink(req.ctx!.tenantId));
    } catch (e) {
      sendSetupError(res, e, "We couldn't check Telegram just now. Please try again.");
    }
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
    // A test of a real kind, so it reads exactly as the real thing will.
    const kind = (ALERT_KINDS as readonly string[]).includes(String(req.body?.kind)) ? String(req.body.kind) : 'test';
    const SAMPLES: Record<string, { title: string; body: string }> = {
      payment_claim: { title: 'Payment to verify (test)', body: 'Jane says she paid KES 2,500 for ORD-12 (ref TEST123).' },
      new_order: { title: 'New order ORD-12 (test)', body: 'Jane ordered 2 x Body wave wig - KES 9,000. Unpaid.' },
      needs_human: { title: 'A customer needs a person (test)', body: 'Jane asked to speak to someone about a refund.' },
      payment_verified: { title: 'Payment verified (test)', body: 'KES 2,500 from Jane for ORD-12.' },
      posts_to_approve: { title: 'Posts ready to approve (test)', body: '5 posts are planned for next week.' },
      post_failed: { title: 'A post did not go out (test)', body: 'Monday 9:00 - Instagram refused the photo.' },
      post_published: { title: 'Post published (test)', body: 'Monday 9:00 post went out on Instagram.' },
      test: { title: 'Test alert', body: 'This is how alerts from your business will arrive.' },
    };
    const results = await deliverAlert(ctx.tenantId, kind, SAMPLES[kind], { force: true });
    res.json({ results });
  })
);

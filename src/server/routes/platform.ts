import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requirePlatformAdmin, handler } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
import { forgetTenantLiveness } from '../services/platform.js';
import { esc, isBrevoConfigured, sendBrevoEmail, runEmailDiagnostics, getBrevoSender } from '../services/brevo.js';
import { rateLimit } from '../channels/webchat/rateLimit.js';
import { publicApiUrl } from '../config/publicUrl.js';

/**
 * The platform console: every business on the platform, for the people who
 * run it. Every route here requires a platform admin, and anything that
 * changes a business is written to that business's own activity log.
 *
 * To work inside a business (read its inbox, fix a channel) the platform
 * admin opens it from the console; the ordinary dashboard routes then serve
 * them in support mode. Nothing here duplicates those routes.
 */
export const platformRouter = Router();

const MAX_TENANTS = 500;

platformRouter.get(
  '/platform/overview',
  requirePlatformAdmin,
  handler(async (_req, res) => {
    const { data: tenants, error } = await serviceClient
      .from('tenants')
      .select('id, business_name, slug, status, agents_paused, status_reason, business_category, created_at, approved_at, onboarding_completed_at')
      .order('created_at', { ascending: false })
      .limit(MAX_TENANTS);
    if (error) return res.status(500).json({ error: 'The list of businesses could not be read.' });

    const ids = (tenants ?? []).map((t) => t.id);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [members, channels, recent, claims, alerts] = await Promise.all([
      ids.length
        ? serviceClient.from('tenant_users').select('tenant_id, user_id, role').in('tenant_id', ids)
        : Promise.resolve({ data: [] as Array<{ tenant_id: string; user_id: string; role: string }> }),
      ids.length
        ? serviceClient.from('channels').select('tenant_id, channel_type, display_name, status').in('tenant_id', ids)
        : Promise.resolve({ data: [] as Array<{ tenant_id: string; channel_type: string; display_name: string | null; status: string }> }),
      ids.length
        ? serviceClient.from('conversations').select('tenant_id, last_message_at')
            .in('tenant_id', ids).gte('last_message_at', weekAgo).limit(5000)
        : Promise.resolve({ data: [] as Array<{ tenant_id: string; last_message_at: string | null }> }),
      ids.length
        ? serviceClient.from('payments').select('tenant_id')
            .in('tenant_id', ids).eq('verification_status', 'unverified').limit(5000)
        : Promise.resolve({ data: [] as Array<{ tenant_id: string }> }),
      serviceClient.from('platform_alerts')
        .select('id, kind, tenant_id, summary, detail, seen_count, created_at, last_seen_at')
        .is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(100),
    ]);

    // Owner addresses, looked up once each.
    const ownerIds = [...new Set((members.data ?? []).filter((m) => m.role === 'owner').map((m) => m.user_id))];
    const emails = new Map<string, string | null>();
    await Promise.all(ownerIds.map(async (id) => {
      try {
        const { data } = await serviceClient.auth.admin.getUserById(id);
        emails.set(id, data?.user?.email ?? null);
      } catch { emails.set(id, null); }
    }));

    const businesses = (tenants ?? []).map((t) => {
      const people = (members.data ?? []).filter((m) => m.tenant_id === t.id);
      const active = (recent.data ?? []).filter((c) => c.tenant_id === t.id);
      const last = active.map((c) => c.last_message_at).filter(Boolean).sort().pop() ?? null;
      return {
        ...t,
        owners: people.filter((m) => m.role === 'owner').map((m) => emails.get(m.user_id)).filter(Boolean),
        people: people.length,
        channels: (channels.data ?? [])
          .filter((c) => c.tenant_id === t.id)
          .map((c) => ({ type: c.channel_type, name: c.display_name, status: c.status })),
        conversations_7d: active.length,
        last_message_at: last,
        payments_waiting: (claims.data ?? []).filter((p) => p.tenant_id === t.id).length,
        open_alerts: (alerts.data ?? []).filter((a) => a.tenant_id === t.id).length,
      };
    });

    res.json({
      businesses,
      alerts: alerts.data ?? [],
      totals: {
        businesses: businesses.length,
        pending: businesses.filter((b) => b.status === 'pending').length,
        live: businesses.filter((b) => b.status === 'active' || b.status === 'trial').length,
        suspended: businesses.filter((b) => b.status === 'suspended').length,
      },
    });
  })
);

/** Approve, suspend or reactivate a business. */
platformRouter.post(
  '/platform/tenants/:id/status',
  requirePlatformAdmin,
  handler(async (req, res) => {
    const admin = req.authUser!;
    const status = String(req.body?.status ?? '');
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || null;

    const { data: before } = await serviceClient
      .from('tenants').select('id, business_name, status').eq('id', req.params.id).maybeSingle();
    if (!before) return res.status(404).json({ error: 'That business does not exist' });

    const approving = status === 'active' && before.status === 'pending';
    const { error } = await serviceClient.from('tenants').update({
      status,
      status_reason: status === 'suspended' ? reason : null,
      ...(status === 'active' ? { approved_at: new Date().toISOString(), approved_by: admin.id } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', before.id);
    if (error) return res.status(500).json({ error: 'That change could not be saved.' });
    forgetTenantLiveness(before.id);

    const summary = approving
      ? 'The platform approved this business'
      : status === 'suspended'
        ? `The platform suspended this business${reason ? `: ${reason}` : ''}`
        : 'The platform reactivated this business';
    void logAuditEvent({
      tenantId: before.id, actorId: admin.id, actorType: 'platform_admin', actorLabel: admin.email,
      action: approving ? 'business.approved' : status === 'suspended' ? 'business.suspended' : 'business.reactivated',
      resourceType: 'tenants', resourceId: before.id, details: { summary, reason },
    });

    // The business has been waiting to hear this.
    await serviceClient.from('platform_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('dedupe_key', `new_business:${before.id}`).is('resolved_at', null);
    if (approving) void tellOwnersApproved(before.id, before.business_name);

    res.json({ id: before.id, status });
  })
);

/** Stop or resume a business's agents without suspending it. */
platformRouter.post(
  '/platform/tenants/:id/agents',
  requirePlatformAdmin,
  handler(async (req, res) => {
    const admin = req.authUser!;
    const paused = Boolean(req.body?.paused);
    const { data, error } = await serviceClient
      .from('tenants').update({ agents_paused: paused, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: 'That change could not be saved.' });
    if (!data) return res.status(404).json({ error: 'That business does not exist' });
    forgetTenantLiveness(data.id);
    void logAuditEvent({
      tenantId: data.id, actorId: admin.id, actorType: 'platform_admin', actorLabel: admin.email,
      action: paused ? 'agents.paused' : 'agents.resumed', resourceType: 'tenants', resourceId: data.id,
      details: { summary: paused ? "The platform paused this business's agents" : "The platform resumed this business's agents" },
    });
    res.json({ id: data.id, agents_paused: paused });
  })
);

/** Why is email not arriving? Asks the email service and reads our own record. */
platformRouter.get(
  '/platform/email-check',
  requirePlatformAdmin,
  handler(async (_req, res) => {
    res.json(await runEmailDiagnostics());
  })
);

/** Send one real email to the platform admin's own address and say what happened. */
platformRouter.post(
  '/platform/email-test',
  requirePlatformAdmin,
  handler(async (req, res) => {
    const admin = req.authUser!;
    if (!admin.email) return res.status(400).json({ error: 'Your account has no email address to send to.' });
    const limit = rateLimit(`email-test:${admin.id}`, 5, 10 * 60_000);
    if (!limit.allowed) return res.status(429).json({ error: 'Too many tests in a short time. Try again in a few minutes.' });

    const sender = getBrevoSender();
    const sent = await sendBrevoEmail({
      to: [{ email: admin.email }],
      subject: 'Test email from your platform',
      htmlContent:
        `<p>This is a test email sent at ${esc(new Date().toUTCString())}.</p>` +
        `<p>It was sent from <strong>${esc(sender.email)}</strong>. If you are reading this in your inbox, receipts and booking confirmations can reach your customers. If it landed in spam, the sending domain still needs authenticating.</p>`,
      textContent: `This is a test email sent at ${new Date().toUTCString()} from ${sender.email}.`,
      tags: ['platform-test'],
    });
    res.json({
      accepted: sent.success,
      to: admin.email,
      from: sender.email,
      error: sent.success ? null : sent.error ?? 'The email service refused the message.',
    });
  })
);

/** Recent attempts to connect a channel: what device, what browser, how it ended. */
platformRouter.get(
  '/platform/connect-attempts',
  requirePlatformAdmin,
  handler(async (_req, res) => {
    const { data, error } = await serviceClient
      .from('connect_attempts')
      .select('id, tenant_id, provider, start_device, start_browser, return_device, return_browser, outcome, detail, started_at, finished_at')
      .order('started_at', { ascending: false }).limit(40);
    if (error) return res.json({ attempts: [] });
    const ids = [...new Set((data ?? []).map((a) => a.tenant_id).filter(Boolean))];
    const { data: names } = ids.length
      ? await serviceClient.from('tenants').select('id, business_name').in('id', ids)
      : { data: [] as Array<{ id: string; business_name: string }> };
    const nameOf = new Map((names ?? []).map((t) => [t.id, t.business_name]));
    res.json({ attempts: (data ?? []).map((a) => ({ ...a, business_name: a.tenant_id ? nameOf.get(a.tenant_id) ?? null : null })) });
  })
);

/** Mark a platform fault as dealt with. */
platformRouter.post(
  '/platform/alerts/:id/resolve',
  requirePlatformAdmin,
  handler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Unknown alert' });
    await serviceClient.from('platform_alerts')
      .update({ resolved_at: new Date().toISOString() }).eq('id', id).is('resolved_at', null);
    res.json({ ok: true });
  })
);

async function tellOwnersApproved(tenantId: string, businessName: string) {
  if (!isBrevoConfigured()) return;
  try {
    const { data: owners } = await serviceClient
      .from('tenant_users').select('user_id').eq('tenant_id', tenantId).eq('role', 'owner');
    for (const o of owners ?? []) {
      const { data } = await serviceClient.auth.admin.getUserById(o.user_id);
      const email = data?.user?.email;
      if (!email) continue;
      await sendBrevoEmail({
        to: [{ email }],
        subject: `${businessName} is approved`,
        htmlContent:
          `<p><strong>${esc(businessName)}</strong> has been approved. Your agents will now answer your customers.</p>` +
          `<p><a href="${esc(publicApiUrl())}">Open your dashboard</a></p>`,
        textContent: `${businessName} has been approved. Your agents will now answer your customers.\n\n${publicApiUrl()}`,
        tags: ['business-approved'],
      });
    }
  } catch (e) {
    console.warn('[platform] could not email the approval:', e instanceof Error ? e.message : e);
  }
}

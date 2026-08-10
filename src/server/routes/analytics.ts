import { Router } from 'express';
import { requireAuth, handler } from '../auth.js';

export const analyticsRouter = Router();

type Bucket = { date: string; value: number };

/** Groups ISO timestamps into a dense daily series so charts have no gaps. */
function daily(rows: Array<{ created_at?: string | null }>, days: number): Bucket[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.created_at) continue;
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    out.push({ date: key, value: counts.get(key) ?? 0 });
  }
  return out;
}

function dailySum(
  rows: Array<{ created_at?: string | null; amount?: unknown }>,
  days: number
): Bucket[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (!r.created_at) continue;
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    sums.set(key, (sums.get(key) ?? 0) + Number(r.amount || 0));
  }
  const out: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    out.push({ date: key, value: sums.get(key) ?? 0 });
  }
  return out;
}

/**
 * Analytics over a trailing window. Every figure is derived from this
 * tenant's own rows; nothing is synthesised. A new tenant legitimately gets
 * all-zero series, which the UI renders as an empty state rather than a
 * misleading chart.
 */
analyticsRouter.get(
  '/analytics',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const since = new Date(Date.now() - days * 864e5).toISOString();

    const [convos, leads, payments, orders] = await Promise.all([
      ctx.db.from('conversations')
        .select('created_at, ai_enabled, channel_type')
        .eq('tenant_id', ctx.tenantId).gte('created_at', since),
      ctx.db.from('leads')
        .select('created_at, stage, channel_type')
        .eq('tenant_id', ctx.tenantId).gte('created_at', since),
      ctx.db.from('payments')
        .select('created_at, amount, verification_status')
        .eq('tenant_id', ctx.tenantId).gte('created_at', since),
      ctx.db.from('orders')
        .select('created_at, status, total')
        .eq('tenant_id', ctx.tenantId).gte('created_at', since),
    ]);

    const firstError = [convos, leads, payments, orders].find((r) => r.error);
    if (firstError?.error) return res.status(400).json({ error: firstError.error.message });

    const convoRows = convos.data ?? [];
    const leadRows = leads.data ?? [];
    const paymentRows = payments.data ?? [];
    const orderRows = orders.data ?? [];

    const verified = paymentRows.filter((p) => p.verification_status === 'verified');
    const aiHandled = convoRows.filter((c) => c.ai_enabled !== false).length;
    const humanHandled = convoRows.length - aiHandled;
    const wonLeads = leadRows.filter((l) => l.stage === 'won').length;

    // Channel performance: conversations and leads side by side per channel.
    const channels = new Map<string, { channel: string; conversations: number; leads: number }>();
    for (const c of convoRows) {
      const k = c.channel_type ?? 'unknown';
      const e = channels.get(k) ?? { channel: k, conversations: 0, leads: 0 };
      e.conversations++; channels.set(k, e);
    }
    for (const l of leadRows) {
      const k = l.channel_type ?? 'unknown';
      const e = channels.get(k) ?? { channel: k, conversations: 0, leads: 0 };
      e.leads++; channels.set(k, e);
    }

    res.json({
      window_days: days,
      has_data: convoRows.length + leadRows.length + paymentRows.length > 0,
      series: {
        conversations: daily(convoRows, days),
        leads: daily(leadRows, days),
        orders: daily(orderRows, days),
        revenue: dailySum(verified, days),
      },
      totals: {
        conversations: convoRows.length,
        leads: leadRows.length,
        orders: orderRows.length,
        revenue: verified.reduce((s, p) => s + Number(p.amount || 0), 0),
        ai_handled: aiHandled,
        human_handled: humanHandled,
        conversion_rate: leadRows.length ? Number(((wonLeads / leadRows.length) * 100).toFixed(1)) : 0,
      },
      channels: [...channels.values()].sort((a, b) => b.conversations - a.conversations),
    });
  })
);

/**
 * Onboarding progress, computed server-side from real tenant state so the
 * checklist cannot drift from reality or be faked by the browser.
 */
analyticsRouter.get(
  '/onboarding',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const t = ctx.tenantId;

    const count = async (table: string, build: (q: any) => any = (q) => q) => {
      const { count: n } = await build(
        ctx.db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', t)
      );
      return n ?? 0;
    };

    const [{ data: business }, { data: agent }, products, activeChannels, conversations] =
      await Promise.all([
        ctx.db.from('tenants')
          .select('business_name, business_description, address, payment_details, contact_info')
          .eq('id', t).single(),
        ctx.db.from('agent_settings')
          .select('persona, sales_script').eq('tenant_id', t).maybeSingle(),
        count('products'),
        count('channels', (q) => q.eq('status', 'active')),
        count('conversations'),
      ]);

    const paymentsConfigured =
      Boolean(business?.payment_details && Object.keys(business.payment_details).length > 0);
    const agentConfigured =
      Boolean(agent?.persona) || (Array.isArray(agent?.sales_script) && agent.sales_script.length > 0);

    const steps = [
      { id: 'business', label: 'Add your business details',
        done: Boolean(business?.business_name && business?.business_description), href: '/settings' },
      { id: 'products', label: 'Add your first product', done: products > 0, href: '/products' },
      { id: 'channel', label: 'Connect a messaging channel', done: activeChannels > 0, href: '/integrations' },
      { id: 'agent', label: 'Configure your AI agent', done: agentConfigured, href: '/agent' },
      { id: 'payments', label: 'Add your payment details', done: paymentsConfigured, href: '/settings' },
      { id: 'live', label: 'Receive your first conversation', done: conversations > 0, href: '/inbox' },
    ];

    const complete = steps.filter((s) => s.done).length;
    res.json({
      steps,
      completed: complete,
      total: steps.length,
      dismissed: complete === steps.length,
    });
  })
);

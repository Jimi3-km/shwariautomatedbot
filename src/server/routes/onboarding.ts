import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireUser, requireWrite, requireAdmin, handler } from '../auth.js';
import { createTenantForUser } from '../services/tenantSetup.js';
import { allProviders, getProvider, ProviderError } from '../channels/providers/index.js';
import type { ChannelProvider } from '../channels/providers/index.js';

export const onboardingRouter = Router();

/**
 * The setup wizard's backend.
 *
 * Everything here derives the tenant from the session. The one exception is
 * POST /onboarding/business, which runs before a tenant exists and therefore
 * authenticates the user only — it still never accepts a tenant id, it creates
 * one and binds the caller to it as owner.
 *
 * No response on this router contains a token, a secret, a webhook URL or any
 * other operational detail. Configuration gaps are reported as a boolean plus
 * a user-facing sentence; the variable names go to the server log.
 */

// ---------------------------------------------------------------------------
// Step 1 — create the business
// ---------------------------------------------------------------------------
onboardingRouter.post(
  '/onboarding/business',
  requireUser,
  handler(async (req, res) => {
    const businessName = String(req.body?.business_name || '').trim();
    if (!businessName) {
      return res.status(400).json({ error: 'Please enter your business name.' });
    }
    if (businessName.length > 120) {
      return res.status(400).json({ error: 'That business name is too long.' });
    }

    try {
      const result = await createTenantForUser({
        userId: req.authUser!.id,
        businessName,
        businessCategory: req.body?.business_category,
        timezone: req.body?.timezone,
        currency: req.body?.currency,
      });

      // An existing workspace gets its details updated rather than a second
      // one created, so re-running step 1 is safe.
      if (!result.created) {
        await serviceClient
          .from('tenants')
          .update({
            business_name: businessName,
            business_category: String(req.body?.business_category || '').trim() || null,
            ...(req.body?.timezone ? { timezone: String(req.body.timezone) } : {}),
            ...(req.body?.currency
              ? { currency: String(req.body.currency).toUpperCase().slice(0, 3) }
              : {}),
          })
          .eq('id', result.tenantId);
      }

      res.status(result.created ? 201 : 200).json({
        business_name: businessName,
        created: result.created,
      });
    } catch (e) {
      console.error('[onboarding] business creation failed:', e);
      res.status(500).json({ error: "We couldn't create your business. Please try again." });
    }
  })
);

// ---------------------------------------------------------------------------
// Step 2 — channels
// ---------------------------------------------------------------------------

interface ChannelSummary {
  channel_id: string;
  provider: string;
  display_name: string | null;
  status: 'active' | 'disabled';
  health: { healthy: boolean; summary: string; needs_reconnect: boolean } | null;
}

/**
 * Which providers can be offered, and what is already connected.
 *
 * `probe=1` additionally runs each provider's live health check. That costs a
 * network round trip per channel, so the wizard only asks for it on the final
 * step and when the user presses Retry.
 */
onboardingRouter.get(
  '/onboarding/channels',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const probe = req.query.probe === '1';

    const providers = allProviders().map((p) => {
      const a = p.availability();
      if (!a.available) {
        console.warn(`[onboarding] provider ${p.id} unavailable, missing: ${a.missing.join(', ')}`);
      }
      return {
        id: p.id,
        label: p.label,
        mode: p.mode,
        available: a.available,
        // Deliberately no variable names: this string is shown to a business
        // owner, not to an operator.
        unavailable_reason: a.available ? null : `${p.label} isn't available yet.`,
      };
    });

    const { data: rows } = await ctx.db
      .from('channels_safe')
      .select('id, channel_type, display_name, status')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: true });

    const connected: ChannelSummary[] = [];
    for (const row of rows ?? []) {
      const provider = getProvider(row.channel_type);
      let health: ChannelSummary['health'] = null;
      if (probe && provider) {
        health = await safeHealth(provider, row.id, ctx);
      }
      connected.push({
        channel_id: row.id,
        provider: row.channel_type,
        display_name: row.display_name,
        status: row.status === 'active' ? 'active' : 'disabled',
        health,
      });
    }

    res.json({ providers, connected });
  })
);

/** A failing health check must never break the page it is drawn on. */
async function safeHealth(
  provider: ChannelProvider,
  channelId: string,
  ctx: { tenantId: string; userId: string }
) {
  try {
    return await provider.healthCheck(channelId, { tenantId: ctx.tenantId, userId: ctx.userId });
  } catch (e) {
    console.warn(`[onboarding] health check threw for ${provider.id}:`, e instanceof Error ? e.message : e);
    return { healthy: false, summary: "We couldn't check this connection just now.", needs_reconnect: false };
  }
}

// ---------------------------------------------------------------------------
// Step 3 — the AI agent
// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  friendly: 'Warm and conversational. Uses simple language and a little enthusiasm.',
  professional: 'Polite, concise and business-like. Avoids slang.',
  concise: 'Short, direct answers. No filler.',
  enthusiastic: 'Upbeat and energetic, quick to highlight what makes an item worth buying.',
};

/**
 * Builds a persona from three plain-language answers. Everything the model
 * needs is derived here so the user never writes a prompt.
 */
function buildPersona(input: {
  agentName: string;
  businessName: string;
  sells: string;
  description: string;
  tone: string;
}): string {
  const toneLine = TONES[input.tone] ?? TONES.friendly;
  return [
    `You are ${input.agentName}, the sales assistant for ${input.businessName}.`,
    `The business sells: ${input.sells}.`,
    input.description ? `About the business: ${input.description}` : '',
    `Tone: ${toneLine}`,
    'Answer questions about what is available, help the customer choose, and guide them to a purchase.',
    'Never invent prices, stock levels or delivery promises. If you do not know, say so and offer to check.',
    'Never confirm that a payment has been received; a member of staff verifies every payment.',
  ]
    .filter(Boolean)
    .join('\n');
}

onboardingRouter.post(
  '/onboarding/agent',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;

    const sells = String(req.body?.sells || '').trim();
    const description = String(req.body?.description || '').trim();
    const tone = String(req.body?.tone || 'friendly').trim();
    const agentNameRaw = String(req.body?.agent_name || '').trim();

    if (!sells) {
      return res.status(400).json({ error: 'Please tell us what your business sells.' });
    }
    if (!Object.prototype.hasOwnProperty.call(TONES, tone)) {
      return res.status(400).json({ error: 'Please choose one of the listed tones.' });
    }

    const { data: tenant, error: tErr } = await ctx.db
      .from('tenants')
      .select('business_name, agent_name')
      .eq('id', ctx.tenantId)
      .single();

    if (tErr || !tenant) {
      console.error('[onboarding] tenant read failed', tErr);
      return res.status(500).json({ error: "We couldn't save your settings. Please try again." });
    }

    const agentName = agentNameRaw || tenant.agent_name || 'Assistant';

    const { error: bizErr } = await ctx.db
      .from('tenants')
      .update({ business_description: description || null, agent_name: agentName })
      .eq('id', ctx.tenantId);
    if (bizErr) {
      console.error('[onboarding] tenant update failed', bizErr);
      return res.status(500).json({ error: "We couldn't save your settings. Please try again." });
    }

    const persona = buildPersona({
      agentName,
      businessName: tenant.business_name,
      sells,
      description,
      tone,
    });

    // agent_settings is created with the tenant, but upsert keeps this working
    // for workspaces that predate that.
    const { error: agentErr } = await serviceClient.from('agent_settings').upsert(
      {
        tenant_id: ctx.tenantId,
        persona,
        sales_script: [
          'Greet the customer and ask what they are looking for.',
          'Recommend from the catalogue and answer questions honestly.',
          'Share the price and payment details when the customer is ready.',
          'Hand over to a human for anything about a payment or a complaint.',
        ],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );

    if (agentErr) {
      console.error('[onboarding] agent_settings upsert failed', agentErr);
      return res.status(500).json({ error: "We couldn't save your settings. Please try again." });
    }

    res.json({ agent_name: agentName, configured: true });
  })
);

// ---------------------------------------------------------------------------
// Step 4 — state and completion
// ---------------------------------------------------------------------------

/** Everything the wizard needs to resume where the user left off. */
onboardingRouter.get(
  '/onboarding/state',
  requireUser,
  handler(async (req, res) => {
    const userId = req.authUser!.id;

    const { data: memberships } = await serviceClient
      .from('tenant_users').select('tenant_id, role').eq('user_id', userId);

    if (!memberships?.length) {
      return res.json({
        step: 'business',
        complete: false,
        business: null,
        has_channel: false,
        agent_configured: false,
      });
    }

    const tenantId = memberships[0].tenant_id;

    const [{ data: tenant }, { count: activeChannels }, { data: agent }] = await Promise.all([
      serviceClient
        .from('tenants')
        .select('business_name, business_category, business_description, agent_name, timezone, currency, onboarding_completed_at')
        .eq('id', tenantId).single(),
      serviceClient
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('status', 'active'),
      serviceClient
        .from('agent_settings').select('persona').eq('tenant_id', tenantId).maybeSingle(),
    ]);

    const hasChannel = (activeChannels ?? 0) > 0;
    const agentConfigured = Boolean(agent?.persona);
    const complete = Boolean(tenant?.onboarding_completed_at);

    const step = complete
      ? 'done'
      : !hasChannel
        ? 'channels'
        : !agentConfigured
          ? 'agent'
          : 'launch';

    res.json({
      step,
      complete,
      business: tenant
        ? {
            business_name: tenant.business_name,
            business_category: tenant.business_category,
            business_description: tenant.business_description,
            agent_name: tenant.agent_name,
            timezone: tenant.timezone,
            currency: tenant.currency,
          }
        : null,
      has_channel: hasChannel,
      agent_configured: agentConfigured,
    });
  })
);

/**
 * Launch. Re-checks the connections rather than trusting the wizard's own
 * progress, then stamps the tenant as onboarded.
 *
 * A channel that fails its health check does not block launch — the agent is
 * still usable and the Integrations page can fix the connection — but the
 * response says so, so the UI can be honest about it.
 */
onboardingRouter.post(
  '/onboarding/complete',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;

    const { data: rows } = await serviceClient
      .from('channels')
      .select('id, channel_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'active');

    const checks: Array<{ provider: string; healthy: boolean; summary: string }> = [];
    for (const row of rows ?? []) {
      const provider = getProvider(row.channel_type);
      if (!provider) continue;
      const health = await safeHealth(provider, row.id, ctx);
      checks.push({ provider: row.channel_type, healthy: health.healthy, summary: health.summary });
    }

    const { data: agent } = await serviceClient
      .from('agent_settings').select('persona').eq('tenant_id', ctx.tenantId).maybeSingle();

    if (!agent?.persona) {
      return res.status(400).json({
        error: 'Please finish setting up your assistant before launching.',
        code: 'AGENT_NOT_CONFIGURED',
      });
    }
    if (!checks.length) {
      return res.status(400).json({
        error: 'Connect at least one channel so customers can reach you.',
        code: 'NO_CHANNEL',
      });
    }

    const { error } = await serviceClient
      .from('tenants')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', ctx.tenantId);

    if (error) {
      console.error('[onboarding] complete failed', error);
      return res.status(500).json({ error: "We couldn't finish setup. Please try again." });
    }

    res.json({
      launched: true,
      checks,
      all_healthy: checks.every((c) => c.healthy),
    });
  })
);

/**
 * Send a test message on a connected channel so the owner can see the agent
 * working before they leave the wizard.
 */
onboardingRouter.post(
  '/onboarding/test-message',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const channelId = String(req.body?.channel_id || '');
    const recipient = String(req.body?.recipient || '').trim();

    if (!channelId || !recipient) {
      return res.status(400).json({ error: 'Choose a channel and enter where to send the test.' });
    }

    const { data: channel } = await serviceClient
      .from('channels')
      .select('id, channel_type')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).eq('status', 'active')
      .maybeSingle();

    if (!channel) return res.status(404).json({ error: 'That channel is no longer connected.' });

    const provider = getProvider(channel.channel_type);
    if (!provider) return res.status(400).json({ error: 'That channel cannot send test messages.' });

    const { data: tenant } = await serviceClient
      .from('tenants').select('business_name, agent_name').eq('id', ctx.tenantId).single();

    const text =
      `Hi! This is ${tenant?.agent_name ?? 'your assistant'} from ${tenant?.business_name ?? 'your business'}. ` +
      'Your AI assistant is set up and ready to reply to customers.';

    try {
      await provider.sendMessage(channelId, recipient, text, ctx);
      res.json({ sent: true });
    } catch (e) {
      if (e instanceof ProviderError) {
        console.warn(`[onboarding] test message failed on ${provider.id}: ${e.message}`);
        return res.status(e.status).json({ error: e.userMessage });
      }
      console.error('[onboarding] test message failed:', e);
      res.status(502).json({ error: "We couldn't send the test message. Please try again." });
    }
  })
);

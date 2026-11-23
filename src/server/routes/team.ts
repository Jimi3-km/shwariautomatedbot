import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, requireOwner, requireUser, handler, ROLE_LABEL, type Role } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
import { esc, isBrevoConfigured, sendBrevoEmail } from '../services/brevo.js';
import { publicApiUrl } from '../config/publicUrl.js';
import { rateLimit } from '../channels/webchat/rateLimit.js';
import { normalisePhone, sendInviteByWhatsApp } from '../services/alerts.js';

/**
 * Staff: who is in a business, inviting them, and removing them.
 *
 * Only the owner adds or removes people. An invitation is a link sent by
 * email; only a hash of its token is stored, it expires, and it can only be
 * accepted by someone signed in with the address it was sent to.
 */
export const teamRouter = Router();

const INVITE_DAYS = 7;
const INVITABLE: Role[] = ['admin', 'member', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const inviteLink = (token: string) => `${publicApiUrl()}/?invite=${token}`;

async function emailOf(userId: string): Promise<string | null> {
  try {
    const { data } = await serviceClient.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Everyone in the business, by email, plus invitations still waiting. */
teamRouter.get(
  '/team',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('tenant_users')
      .select('id, user_id, role, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });

    const members = await Promise.all(
      (data ?? []).map(async (m) => ({ ...m, email: await emailOf(m.user_id) }))
    );

    // Invitations are the owner's and managers' business, not everyone's.
    let invitations: unknown[] = [];
    if (ctx.role === 'owner' || ctx.role === 'admin') {
      const { data: inv } = await serviceClient
        .from('tenant_invitations')
        .select('id, email, role, expires_at, created_at')
        .eq('tenant_id', ctx.tenantId)
        .is('accepted_at', null).is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      invitations = inv ?? [];
    }

    res.json({ members, invitations });
  })
);

/** Invite someone by email. Owner only. */
teamRouter.post(
  '/team/invitations',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = String(req.body?.role ?? '') as Role;
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!INVITABLE.includes(role)) {
      return res.status(400).json({ error: 'Choose Manager, Staff or Viewer.' });
    }
    // Optional: also send the invitation to their WhatsApp.
    const rawPhone = String(req.body?.phone ?? '').trim();
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      return res.status(400).json({ error: 'Enter the WhatsApp number with its country code, for example +254712345678.' });
    }
    const limit = rateLimit(`invite:${ctx.tenantId}`, 20, 60 * 60_000);
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Too many invitations in the last hour. Try again later.' });
    }

    // Already in the business?
    const { data: current } = await ctx.db
      .from('tenant_users').select('user_id').eq('tenant_id', ctx.tenantId);
    for (const m of current ?? []) {
      if ((await emailOf(m.user_id))?.toLowerCase() === email) {
        return res.status(409).json({ error: 'That person is already in this business.' });
      }
    }

    // A new invitation to the same address replaces the one still open.
    await serviceClient.from('tenant_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId).eq('email', email)
      .is('accepted_at', null).is('revoked_at', null);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    const { data: created, error } = await serviceClient
      .from('tenant_invitations')
      .insert({
        tenant_id: ctx.tenantId, email, role, phone,
        token_hash: hashToken(token), invited_by: ctx.userId, expires_at: expiresAt,
      })
      .select('id, email, role, expires_at, created_at')
      .single();
    if (error || !created) {
      console.error('[team] invitation insert failed:', error?.message);
      return res.status(500).json({ error: "We couldn't create that invitation. Please try again." });
    }

    const { data: tenant } = await serviceClient
      .from('tenants').select('business_name').eq('id', ctx.tenantId).maybeSingle();
    const business = tenant?.business_name ?? 'a business';
    const link = inviteLink(token);

    let emailed = false;
    if (isBrevoConfigured()) {
      const sent = await sendBrevoEmail({
        to: [{ email }],
        subject: `You've been invited to join ${business}`,
        htmlContent:
          `<p>${esc(ctx.email ?? 'The owner')} has invited you to join <strong>${esc(business)}</strong> as ${esc(ROLE_LABEL[role])}.</p>` +
          `<p><a href="${esc(link)}">Accept the invitation</a></p>` +
          `<p>Sign in or create an account with this email address (${esc(email)}) to accept. The link works for ${INVITE_DAYS} days.</p>`,
        textContent:
          `${ctx.email ?? 'The owner'} has invited you to join ${business} as ${ROLE_LABEL[role]}.\n\n` +
          `Accept: ${link}\n\nSign in or create an account with ${email} to accept. The link works for ${INVITE_DAYS} days.`,
        tags: ['team-invitation'],
        tenantId: ctx.tenantId,
        senderName: business,
      }).catch(() => ({ success: false }));
      emailed = Boolean(sent.success);
    }

    // And on WhatsApp, from the business's own number, when one was given.
    let whatsapp: { sent: boolean; reason?: string } | null = null;
    if (phone) {
      const sent = await sendInviteByWhatsApp(ctx.tenantId, phone, {
        business, role: ROLE_LABEL[role], link, invitedBy: ctx.email ?? 'The owner',
      });
      whatsapp = { sent: sent.ok, ...(sent.reason ? { reason: sent.reason } : {}) };
    }

    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'team.invited', resourceType: 'team', resourceId: created.id,
      details: { summary: `Invited ${email} as ${ROLE_LABEL[role]}`, email, role },
    });

    // The link goes back to the owner too, so they can pass it on themselves
    // when email is not set up or the message does not arrive.
    res.status(201).json({ invitation: created, link, emailed, whatsapp });
  })
);

/** Withdraw an invitation. Owner only. */
teamRouter.delete(
  '/team/invitations/:id',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await serviceClient
      .from('tenant_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .is('accepted_at', null).is('revoked_at', null)
      .select('id, email').maybeSingle();
    if (error) return res.status(400).json({ error: 'That invitation could not be withdrawn.' });
    if (!data) return res.status(404).json({ error: 'Invitation not found' });
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'team.invitation_withdrawn', resourceType: 'team', resourceId: data.id,
      details: { summary: `Withdrew the invitation to ${data.email}` },
    });
    res.json({ ok: true });
  })
);

/** Remove someone from the business. Owner only; access ends at once. */
teamRouter.delete(
  '/team/:id',
  requireAuth,
  requireOwner,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: target } = await ctx.db
      .from('tenant_users').select('id, user_id, role')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.user_id === ctx.userId) {
      return res.status(403).json({ error: 'You cannot remove yourself. Hand ownership to someone else first.' });
    }
    const email = await emailOf(target.user_id);
    // The database trigger refuses to remove the last owner.
    const { error } = await ctx.db
      .from('tenant_users').delete().eq('id', target.id).eq('tenant_id', ctx.tenantId);
    if (error) {
      return res.status(409).json({
        error: /at least one owner/i.test(error.message)
          ? 'A business must keep at least one owner.'
          : 'That person could not be removed.',
      });
    }
    // Anything assigned to them goes back to nobody rather than to a ghost.
    await serviceClient.from('conversations').update({ assigned_to: null })
      .eq('tenant_id', ctx.tenantId).eq('assigned_to', target.user_id);
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'team.removed', resourceType: 'team', resourceId: target.id,
      details: { summary: `Removed ${email ?? 'a member'} (${ROLE_LABEL[target.role as Role] ?? target.role})` },
    });
    res.json({ ok: true });
  })
);

/** What an invitation is for, shown before signing in. Says nothing secret. */
teamRouter.get(
  '/invitations/:token',
  handler(async (req, res) => {
    const limit = rateLimit(`invite:look:${req.ip}`, 30, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    const inv = await findOpenInvitation(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invitation is no longer valid. Ask for a new one.' });
    const { data: tenant } = await serviceClient
      .from('tenants').select('business_name').eq('id', inv.tenant_id).maybeSingle();
    res.json({
      business_name: tenant?.business_name ?? 'a business',
      role: inv.role,
      role_label: ROLE_LABEL[inv.role as Role] ?? inv.role,
      email: inv.email,
    });
  })
);

/** Accept an invitation. The signed-in address must be the invited one. */
teamRouter.post(
  '/invitations/:token/accept',
  requireUser,
  handler(async (req, res) => {
    const user = req.authUser!;
    const limit = rateLimit(`invite:accept:${user.id}`, 10, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });

    const inv = await findOpenInvitation(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invitation is no longer valid. Ask for a new one.' });

    if (!user.email || user.email.toLowerCase() !== String(inv.email).toLowerCase()) {
      return res.status(403).json({
        error: `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`,
        code: 'INVITE_WRONG_ACCOUNT',
      });
    }
    // An unconfirmed address proves nothing: anyone can sign up with it.
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Confirm your email address first (check your inbox), then open the invitation again.',
        code: 'INVITE_EMAIL_UNVERIFIED',
      });
    }

    const { data: already } = await serviceClient
      .from('tenant_users').select('id').eq('tenant_id', inv.tenant_id).eq('user_id', user.id).maybeSingle();
    if (!already) {
      const { error } = await serviceClient
        .from('tenant_users').insert({ tenant_id: inv.tenant_id, user_id: user.id, role: inv.role });
      if (error) {
        console.error('[team] accepting an invitation failed:', error.message);
        return res.status(500).json({ error: "We couldn't add you to that business. Please try again." });
      }
    }
    await serviceClient.from('tenant_invitations')
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', inv.id);

    void logAuditEvent({
      tenantId: inv.tenant_id, actorId: user.id, actorType: 'user', actorLabel: user.email,
      action: 'team.joined', resourceType: 'team', resourceId: inv.id,
      details: { summary: `${user.email} joined as ${ROLE_LABEL[inv.role as Role] ?? inv.role}` },
    });
    res.json({ tenant_id: inv.tenant_id, role: inv.role });
  })
);

async function findOpenInvitation(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data } = await serviceClient
    .from('tenant_invitations')
    .select('id, tenant_id, email, role, expires_at')
    .eq('token_hash', hashToken(token))
    .is('accepted_at', null).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return data ?? null;
}

/** The record of who did what in this business. Owner and managers. */
teamRouter.get(
  '/audit',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 200);
    let q = ctx.db
      .from('audit_events')
      .select('id, actor_id, actor_type, actor_label, agent_role, action, resource_type, resource_id, details, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);
    // People, not the agents' every tool call, unless asked for.
    if (req.query.who !== 'all') q = q.in('actor_type', ['user', 'platform_admin']);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: 'The activity log could not be read.' });
    res.json({ events: data ?? [] });
  })
);

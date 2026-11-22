import React, { useState } from 'react';
import { Check, Copy, Mail, Trash2, UserPlus } from 'lucide-react';
import {
  getTeam, updateTeamMember, inviteTeamMember, withdrawInvitation, removeTeamMember, getActivity,
} from '../lib/api';
import { useAsync, useMutation } from '../hooks';
import { useSession, ROLE_LABELS } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, ErrorState, Field, InlineError, Input, LoadingState, Pill, Select, useToast,
} from './ui';
import { formatDateTime, relativeTime } from '../lib/format';
import type { Role } from '../types';

const ROLE_HELP: Array<{ role: Role; text: string }> = [
  { role: 'owner', text: 'Everything, including staff. One business, one or more owners.' },
  { role: 'admin', text: 'Channels, agents, catalogue, payment details and posts. Cannot add or remove staff.' },
  { role: 'member', text: 'Answers customers, handles leads, orders and bookings, verifies payments.' },
  { role: 'viewer', text: 'Can read everything, change nothing.' },
];

/**
 * Who is in this business, and what each of them may do.
 *
 * Only the owner invites, removes or changes a role; everyone else sees the
 * list. The server and the database enforce the same rule, so this screen
 * only decides what to show.
 */
export function TeamPanel() {
  const { user, isOwner, isAdmin, supportMode } = useSession();
  const toast = useToast();
  const state = useAsync(() => getTeam(), []);
  const canManage = isOwner && !supportMode;

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [link, setLink] = useState<{ url: string; emailed: boolean; to: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);

  const invite = useMutation(async () => {
    const result = await inviteTeamMember(email.trim(), role);
    setLink({ url: result.link, emailed: result.emailed, to: email.trim() });
    setEmail('');
    state.reload();
  });
  const change = useMutation(async (id: string, next: string) => {
    await updateTeamMember(id, next);
    toast.push('success', 'Role updated.');
    state.reload();
  });
  const withdraw = useMutation(async (id: string) => {
    await withdrawInvitation(id);
    state.reload();
  });
  const remove = useMutation(async (id: string) => {
    await removeTeamMember(id);
    setRemoving(null);
    toast.push('success', 'Removed. Their access has ended.');
    state.reload();
  });

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* the text is selectable */ }
  }

  if (state.loading && !state.data) return <LoadingState rows={3} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;

  const members = state.data?.members ?? [];
  const invitations = state.data?.invitations ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card>
        <InlineError message={change.error ?? remove.error ?? withdraw.error} />
        <div className="section-label" style={{ marginBottom: 11 }}>People with access</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {members.map((m) => {
            const mine = m.user_id === user.id;
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', flexWrap: 'wrap',
                background: 'var(--surface-2)', borderRadius: 'var(--radius)',
              }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                    {m.email ?? 'Team member'}{mine && <span style={{ color: 'var(--text-3)' }}> (you)</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Added {formatDateTime(m.created_at)}</div>
                </div>
                {canManage && !mine ? (
                  <>
                    <Select
                      aria-label="Role" value={m.role} disabled={change.busy}
                      onChange={(e) => change.run(m.id, e.target.value)}
                      options={(['owner', 'admin', 'member', 'viewer'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                      style={{ height: 30, width: 130, fontSize: 12.5 }}
                    />
                    <Button
                      size="sm" variant="subtle" icon={<Trash2 size={13} />} aria-label={`Remove ${m.email ?? 'member'}`}
                      onClick={() => setRemoving({ id: m.id, label: m.email ?? 'this person' })}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Pill tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABELS[m.role]}</Pill>
                )}
              </div>
            );
          })}
        </div>

        {invitations.length > 0 && (
          <>
            <div className="section-label" style={{ margin: '16px 0 9px' }}>Invited, not yet joined</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {invitations.map((i) => (
                <div key={i.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', flexWrap: 'wrap',
                  border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
                }}>
                  <Mail size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{i.email}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {ROLE_LABELS[i.role]} · link expires {formatDateTime(i.expires_at)}
                    </div>
                  </div>
                  {canManage && (
                    <Button size="sm" variant="subtle" loading={withdraw.busy} onClick={() => withdraw.run(i.id)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {canManage && (
        <Card>
          <div className="section-label" style={{ marginBottom: 11 }}>Invite someone</div>
          <InlineError message={invite.error} />
          <form
            onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.run(); }}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <div style={{ flex: '2 1 220px', minWidth: 0 }}>
              <Field label="Their email address" htmlFor="invite-email">
                <Input
                  id="invite-email" type="email" autoComplete="off" placeholder="name@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 130px', minWidth: 0 }}>
              <Field label="Role" htmlFor="invite-role">
                <Select
                  id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}
                  options={(['admin', 'member', 'viewer'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                />
              </Field>
            </div>
            <Button type="submit" variant="solid" icon={<UserPlus size={14} />} loading={invite.busy} disabled={!email.trim()}>
              Send invitation
            </Button>
          </form>

          {link && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius)',
              background: 'var(--success-bg)', fontSize: 12.5, lineHeight: 1.55,
            }}>
              <div>
                {link.emailed
                  ? `Invitation emailed to ${link.to}. You can also send them this link yourself:`
                  : `We couldn't email ${link.to}, so send them this link yourself:`}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                <code style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace' }}>
                  {link.url}
                </code>
                <Button
                  size="sm" variant={copied ? 'success' : 'subtle'}
                  icon={copied ? <Check size={12} /> : <Copy size={12} />} onClick={copyLink}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-2)' }}>
                It works for 7 days and only for someone signed in with that address.
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="section-label" style={{ marginBottom: 9 }}>What each role can do</div>
        <div style={{ display: 'grid', gap: 7 }}>
          {ROLE_HELP.map((r) => (
            <div key={r.role} style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ flex: '0 0 68px', fontWeight: 600 }}>{ROLE_LABELS[r.role]}</span>
              <span style={{ color: 'var(--text-2)' }}>{r.text}</span>
            </div>
          ))}
        </div>
        {!isOwner && (
          <p className="field-hint" style={{ marginTop: 10 }}>Only the owner can invite people or change a role.</p>
        )}
      </Card>

      {isAdmin && <ActivityLog />}

      <ConfirmDialog
        open={!!removing}
        title="Remove this person?"
        body={`${removing?.label ?? 'They'} will lose access to this business straight away.`}
        confirmLabel="Remove"
        busy={remove.busy}
        onConfirm={() => removing && remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/** Who did what in this business, most recent first. */
function ActivityLog() {
  const state = useAsync(() => getActivity(), []);
  const [open, setOpen] = useState(false);
  const events = state.data?.events ?? [];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-label">Activity log</div>
          <p className="field-hint" style={{ marginTop: 3 }}>
            Every change made by your staff, and anything our support team does in your business.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {state.loading && !state.data && <LoadingState rows={3} />}
          {state.error && <ErrorState message={state.error} onRetry={state.reload} />}
          {!state.loading && !state.error && events.length === 0 && (
            <p className="field-hint">Nothing recorded yet.</p>
          )}
          <div style={{ display: 'grid', gap: 6 }}>
            {events.map((e) => (
              <div key={e.id} style={{
                display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
                padding: '7px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 12.5,
              }}>
                <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                  {String(e.details?.summary ?? e.action)}
                </span>
                <span style={{ color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
                  {e.actor_type === 'platform_admin' ? 'Platform support' : (e.actor_label ?? 'A staff member')}
                </span>
                {e.actor_type === 'platform_admin' && <Pill tone="info">Support</Pill>}
                <span style={{ color: 'var(--text-3)' }} title={formatDateTime(e.created_at)}>{relativeTime(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

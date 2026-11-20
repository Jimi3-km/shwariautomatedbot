import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, ExternalLink,
  Images, Megaphone, Pause, Pencil, Play, Plus, Send, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import {
  getContent, uploadContent, updateContent, deleteContent,
  getPosts, planWeekPosts, approvePosts, updatePost, publishPostNow,
  getPostingSettings, savePostingSettings, getProducts, getServices,
} from '../lib/api';
import type {
  ApprovalMode, ContentItem, PostingSlot, PostingStatus, PostPlatform, PostStatus, ScheduledPost, WeekPlan,
} from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input,
  LoadingState, Modal, PageHeader, Pill, Select, Textarea, useToast,
} from '../components/ui';
import type { PillTone } from '../components/ui';

/**
 * Marketing: what the business posts, and when.
 *
 * Three views of one thing. The Library is the owner's own photos and videos;
 * nothing here is generated. The Calendar is what is laid out to go out, and
 * the only posts that are ever published are the ones approved on it. The
 * Schedule is when to post and how approval works.
 *
 * Every time on this page is in the business's own timezone, whatever device
 * it is opened on: the server reads and writes wall-clock times in that zone.
 */

type Tab = 'calendar' | 'library' | 'schedule';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATUS_LABEL: Record<PostStatus, string> = {
  proposed: 'Needs approval',
  approved: 'Approved',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<PostStatus, PillTone> = {
  proposed: 'warning', approved: 'info', publishing: 'info', published: 'success',
  failed: 'danger', rejected: 'neutral', cancelled: 'neutral',
};

const PLATFORM_LABEL: Record<PostPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook' };

const platformLabel = (p: string | null | undefined): string => (p === 'facebook' ? 'Facebook' : 'Instagram');

/**
 * Where a library item may be posted. An item with nothing listed predates
 * Facebook and was only ever meant for Instagram.
 */
function itemPlatforms(item: Pick<ContentItem, 'platforms'> | null | undefined): PostPlatform[] {
  const list = (item?.platforms ?? []).filter((p): p is PostPlatform => p === 'instagram' || p === 'facebook');
  return list.length ? list : ['instagram'];
}

const MODE_LABEL: Record<ApprovalMode, string> = {
  week: 'Approve the week',
  each: 'Approve each post',
  autopilot: 'Autopilot',
};

const MODE_HINT: Record<ApprovalMode, string> = {
  week: 'Once a week the next seven days are laid out. You approve them together, or change individual posts. Nothing unapproved is published.',
  each: 'Every post needs its own approval before it can go out.',
  autopilot: 'Posts from library items you have already approved go out at their times without asking. A caption that needs a read is still held for you.',
};

// --- time, in the business's timezone --------------------------------------

function usableZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** YYYY-MM-DD of an instant, as the business's calendar reads. */
function ymdIn(at: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function hmIn(at: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(`${ymd}T12:00:00Z`));
}

// --- shared bits -----------------------------------------------------------

function Thumb({ url, type, size }: { url: string; type: 'image' | 'video'; size?: number }) {
  const style: React.CSSProperties = {
    width: size ?? '100%', height: size ?? undefined, aspectRatio: size ? undefined : '1 / 1',
    objectFit: 'cover', borderRadius: 'var(--radius)', background: 'var(--surface-2)',
    display: 'block', flexShrink: 0,
  };
  return type === 'video'
    ? <video src={url} style={style} muted playsInline preload="metadata" />
    : <img src={url} alt="" loading="lazy" style={style} />;
}

function Notice({ tone, children }: { tone: 'warning' | 'danger' | 'info'; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 12px',
      borderRadius: 'var(--radius)', fontSize: 12.5, lineHeight: 1.55,
      background: `var(--${tone}-bg)`, color: `var(--${tone})`,
    }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Marketing() {
  const { canWrite, isAdmin } = useSession();
  const [tab, setTab] = useState<Tab>('calendar');
  const status = useAsync(() => getPostingSettings(), []);
  const tz = usableZone(status.data?.timezone);
  const instagram = status.data?.instagram;
  const facebook = status.data?.facebook;
  // What the calendar posts to: whatever is connected.
  const connected: PostPlatform[] = [
    ...(instagram?.connected ? ['instagram' as const] : []),
    ...(facebook?.connected ? ['facebook' as const] : []),
  ];

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Your own photos and videos, posted to Instagram and your Facebook Page on a calendar you approve."
        actions={
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={tab === 'calendar'} onClick={() => setTab('calendar')}>
              <CalendarDays size={14} /> Calendar
            </button>
            <button type="button" aria-pressed={tab === 'library'} onClick={() => setTab('library')}>
              <Images size={14} /> Library
            </button>
            <button type="button" aria-pressed={tab === 'schedule'} onClick={() => setTab('schedule')}>
              <Clock size={14} /> Schedule
            </button>
          </div>
        }
      />

      <div style={{ padding: '14px 20px 0', display: 'grid', gap: 8 }}>
        {status.data && connected.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-2)' }}>
            <span>Posting to</span>
            {instagram?.connected && (
              <Pill tone={instagram.expired || instagram.can_publish !== true ? 'warning' : 'success'} dot>
                Instagram{instagram.username ? ` @${instagram.username}` : ''}
              </Pill>
            )}
            {facebook?.connected && (
              <Pill tone={facebook.expired || facebook.can_publish === false ? 'warning' : 'success'} dot>
                Facebook{facebook.page_name ? ` · ${facebook.page_name}` : ' Page'}
              </Pill>
            )}
            {!instagram?.connected && (
              <Link to="/integrations" style={{ textDecoration: 'underline' }}>Connect Instagram too</Link>
            )}
            {!facebook?.connected && (
              <Link to="/integrations" style={{ textDecoration: 'underline' }}>Connect a Facebook Page too</Link>
            )}
          </div>
        )}
        {status.data && connected.length === 0 && (
          <Notice tone="warning">
            Neither Instagram nor a Facebook Page is connected, so nothing can be published yet.{' '}
            <Link to="/integrations" style={{ textDecoration: 'underline' }}>Connect one</Link>.
            You can still build the library and the calendar.
          </Notice>
        )}
        {facebook && facebook.connected && (facebook.expired || facebook.can_publish === false) && (
          <Notice tone="warning">
            {facebook.expired
              ? 'The Facebook connection has expired.'
              : 'The Facebook Page is connected for messages, but the person who connected it cannot post to it.'}{' '}
            <Link to="/integrations" style={{ textDecoration: 'underline' }}>Reconnect the Page</Link>{' '}
            and allow posting. Until then approved Facebook posts will fail.
          </Notice>
        )}
        {instagram && instagram.connected && (instagram.expired || instagram.can_publish !== true) && (
          <Notice tone="warning">
            {instagram.expired
              ? 'The Instagram connection has expired.'
              : 'Instagram is connected for messages, but it has not given permission to post.'}{' '}
            <Link to="/integrations" style={{ textDecoration: 'underline' }}>Reconnect Instagram</Link>{' '}
            once and allow posting. Until then approved posts will fail.
          </Notice>
        )}
        {status.data?.settings.paused && (
          <Notice tone="info">
            Posting is paused. Nothing will be published, including approved posts, until it is resumed under Schedule.
          </Notice>
        )}
      </div>

      {tab === 'calendar' && (
        <CalendarTab tz={tz} mode={status.data?.settings.approval_mode ?? 'week'} isAdmin={isAdmin} />
      )}
      {tab === 'library' && <LibraryTab canWrite={canWrite} isAdmin={isAdmin} connected={connected} />}
      {tab === 'schedule' && (
        status.loading && !status.data ? <div className="p-5"><LoadingState rows={3} /></div>
          : status.error ? <ErrorState message={status.error} onRetry={status.reload} />
          : status.data ? <ScheduleTab status={status.data} isAdmin={isAdmin} onSaved={status.reload} />
          : null
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function CalendarTab({ tz, mode, isAdmin }: { tz?: string; mode: ApprovalMode; isAdmin: boolean }) {
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [plan, setPlan] = useState<WeekPlan | null>(null);

  const today = ymdIn(new Date(), tz);
  const start = addDays(today, offset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  const state = useAsync(() => getPosts(`${start}T00:00`, `${addDays(start, 7)}T00:00`), [start]);
  const posts = state.data?.posts ?? [];
  const now = Date.now();
  const isPast = (p: ScheduledPost) => new Date(p.scheduled_for).getTime() <= now;
  const waiting = posts.filter((p) => p.status === 'proposed' && !isPast(p));

  const planWeek = useMutation(async () => {
    const result = await planWeekPosts(offset > 0 ? `${start}T00:00` : undefined);
    setPlan(result);
    const n = result.proposed.length;
    toast.push(
      n ? 'success' : 'info',
      n ? `${n} ${n === 1 ? 'post' : 'posts'} laid out. ${result.mode === 'autopilot' ? '' : 'Nothing is published until you approve.'}`.trim()
        : result.note || (result.already_planned ? 'This week is already laid out.' : 'There was nothing to lay out.')
    );
    state.reload();
  });

  const approveWeek = useMutation(async () => {
    const result = await approvePosts({ week_start: start });
    toast.push(
      result.approved_count ? 'success' : 'info',
      result.approved_count
        ? `${result.approved_count} ${result.approved_count === 1 ? 'post' : 'posts'} approved. They go out at their times.`
        : 'There was nothing to approve.'
    );
    state.reload();
  });

  const approveOne = useMutation(async (post: ScheduledPost) => {
    const result = await approvePosts({ ids: [post.id] });
    if (result.approved_count) toast.push('success', 'Approved. It goes out at its time.');
    else toast.push('error', result.skipped[0]?.why ?? 'It could not be approved.');
    state.reload();
  });

  const setStatus = useMutation(async (post: ScheduledPost, next: 'rejected' | 'cancelled') => {
    await updatePost(post.id, { status: next });
    toast.push('info', next === 'rejected' ? 'Rejected. It will not be published.' : 'Cancelled. It will not be published.');
    state.reload();
  });

  const busy = planWeek.busy || approveWeek.busy || approveOne.busy || setStatus.busy;

  return (
    <div style={{ padding: '14px 20px 20px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" icon={<ChevronLeft size={14} />} onClick={() => { setOffset((o) => o - 1); setPlan(null); }} aria-label="Earlier" />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>
          {dayLabel(start)} – {dayLabel(addDays(start, 6))}
        </span>
        <Button size="sm" icon={<ChevronRight size={14} />} onClick={() => { setOffset((o) => o + 1); setPlan(null); }} aria-label="Later" />
        {offset !== 0 && <Button size="sm" onClick={() => { setOffset(0); setPlan(null); }}>Today</Button>}
        <span style={{ flex: 1 }} />
        {isAdmin && offset >= 0 && (
          <Button size="sm" variant="outline" icon={<Sparkles size={14} />} loading={planWeek.busy} disabled={busy} onClick={() => planWeek.run()}>
            {offset === 0 ? 'Plan next 7 days' : 'Plan this week'}
          </Button>
        )}
        {isAdmin && mode !== 'each' && waiting.length > 0 && (
          <Button size="sm" variant="accent" icon={<Check size={14} />} loading={approveWeek.busy} disabled={busy} onClick={() => approveWeek.run()}>
            Approve week ({waiting.length})
          </Button>
        )}
      </div>

      <InlineError message={planWeek.error || approveWeek.error || approveOne.error || setStatus.error} />

      {plan && plan.unfilled.length > 0 && (
        <Notice tone="warning">
          {plan.unfilled.length} posting {plan.unfilled.length === 1 ? 'time has' : 'times have'} nothing to post:{' '}
          {plan.unfilled.map((u) => (
            (plan.platforms?.length ?? 1) > 1 ? `${u.when} (${platformLabel(u.platform)})` : u.when
          )).join('; ')}. {plan.unfilled[0].why}
        </Notice>
      )}

      {state.data && !state.data.available && (
        <Notice tone="info">Posting is not set up on this workspace yet. A database update is pending.</Notice>
      )}

      {posts.length > 0 && waiting.length === 0 && !posts.some((p) => ['approved', 'publishing', 'published'].includes(p.status)) && (
        <Notice tone="info">Nothing in this week is approved, so nothing will be published.</Notice>
      )}

      {state.loading && !state.data && <LoadingState rows={3} />}
      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

      {state.data && (
        <div className="board" role="list" aria-label="Posts by day">
          {days.map((day) => {
            const list = posts.filter((p) => ymdIn(new Date(p.scheduled_for), tz) === day);
            return (
              <section key={day} className="board-column" role="listitem" aria-label={dayLabel(day)}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 2px' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{dayLabel(day)}</span>
                  {day === today && <Pill tone="accent">Today</Pill>}
                  <span style={{ flex: 1 }} />
                  <span className="board-count">{list.length || ''}</span>
                </header>
                <div className="scroll-y">
                  {list.length === 0 && <div className="board-empty">No post</div>}
                  {list.map((p) => {
                    const late = p.status === 'proposed' && isPast(p);
                    return (
                      <article key={p.id} className="board-card">
                        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', minWidth: 0 }}>
                          <Thumb url={p.media_url} type={p.media_type} size={56} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="board-card-meta">
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{hmIn(new Date(p.scheduled_for), tz)}</span>
                              <Pill tone={late ? 'neutral' : STATUS_TONE[p.status]} dot>
                                {late ? 'Not approved in time' : STATUS_LABEL[p.status]}
                              </Pill>
                              <Pill tone="neutral">{platformLabel(p.platform)}</Pill>
                            </div>
                            {p.about && <span className="board-card-sub" style={{ marginTop: 4 }}>{p.about}</span>}
                          </div>
                        </div>

                        <p style={{
                          fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, overflowWrap: 'anywhere',
                          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {p.caption || <em style={{ color: 'var(--text-3)' }}>No caption</em>}
                        </p>

                        {p.needs_review_reason && p.status !== 'published' && (
                          <p style={{ fontSize: 11.5, color: 'var(--warning)', lineHeight: 1.45 }}>
                            Read before approving: {p.needs_review_reason}
                          </p>
                        )}
                        {p.status === 'failed' && p.failure_reason && (
                          <p style={{ fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.45 }}>{p.failure_reason}</p>
                        )}
                        {p.status === 'published' && p.external_permalink && (
                          <a
                            href={p.external_permalink} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', gap: 4, alignItems: 'center' }}
                          >
                            <ExternalLink size={12} /> View on {platformLabel(p.platform)}
                          </a>
                        )}

                        {isAdmin && p.status !== 'published' && p.status !== 'publishing' && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {p.status === 'proposed' && !late && (
                              <Button size="sm" variant="success" icon={<Check size={12} />} disabled={busy} onClick={() => approveOne.run(p)}>
                                Approve
                              </Button>
                            )}
                            <Button size="sm" icon={<Pencil size={12} />} disabled={busy} onClick={() => setEditing(p)}>
                              {p.status === 'failed' || p.status === 'rejected' || p.status === 'cancelled' || late ? 'Reschedule' : 'Edit'}
                            </Button>
                            {p.status === 'proposed' && (
                              <Button size="sm" variant="subtle" icon={<X size={12} />} disabled={busy} onClick={() => setStatus.run(p, 'rejected')}>
                                Reject
                              </Button>
                            )}
                            {p.status === 'approved' && (
                              <Button size="sm" variant="subtle" icon={<X size={12} />} disabled={busy} onClick={() => setStatus.run(p, 'cancelled')}>
                                Cancel
                              </Button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {state.data && state.data.available && posts.length === 0 && (
        <EmptyState
          icon={<Megaphone size={22} />}
          title="Nothing laid out for these days"
          body="Approve some items in the library, then plan the week. Posts are proposed for you to approve; nothing goes out on its own."
        />
      )}

      {editing && (
        <PostEditor
          post={editing} tz={tz}
          onClose={() => setEditing(null)}
          onDone={(message) => { toast.push('success', message); setEditing(null); state.reload(); }}
        />
      )}
    </div>
  );
}

function PostEditor({ post, tz, onClose, onDone }: {
  post: ScheduledPost; tz?: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const toast = useToast();
  const initialWhen = `${ymdIn(new Date(post.scheduled_for), tz)}T${hmIn(new Date(post.scheduled_for), tz)}`;
  const [caption, setCaption] = useState(post.caption ?? '');
  const [when, setWhen] = useState(initialWhen);
  const [confirming, setConfirming] = useState(false);
  const revived = post.status === 'failed' || post.status === 'rejected' || post.status === 'cancelled';

  const save = useMutation(async () => {
    const body: { caption?: string; scheduled_for?: string } = {};
    if (caption !== (post.caption ?? '')) body.caption = caption;
    if (when && when !== initialWhen) body.scheduled_for = when;
    if (!body.caption && body.caption !== '' && !body.scheduled_for) { onClose(); return; }
    const updated = await updatePost(post.id, body);
    onDone(updated.status === 'proposed' && post.status !== 'proposed'
      ? 'Saved. It is back on the calendar and needs approving.'
      : 'Saved.');
  });

  const publish = useMutation(async () => {
    const result = await publishPostNow(post.id);
    setConfirming(false);
    if (result.outcome === 'failed') {
      toast.push('error', result.message);
      onDone('The post was not published. The reason is on the calendar.');
      return;
    }
    onDone(result.message);
  });

  return (
    <>
      <Modal
        open onClose={onClose} title="Edit post" width={540}
        footer={
          <>
            <Button variant="subtle" icon={<Send size={13} />} disabled={save.busy} onClick={() => setConfirming(true)}>
              Publish now
            </Button>
            <span style={{ flex: 1 }} />
            <Button onClick={onClose}>Close</Button>
            <Button variant="accent" loading={save.busy} onClick={() => save.run()}>Save</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 13 }}>
          <InlineError message={save.error || publish.error} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Thumb url={post.media_url} type={post.media_type} size={96} />
            <div style={{ minWidth: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
              <Pill tone={STATUS_TONE[post.status]} dot>{STATUS_LABEL[post.status]}</Pill>
              {post.about && <div style={{ marginTop: 6 }}>About: {post.about}</div>}
              {revived && <div style={{ marginTop: 6 }}>Saving a new time puts it back on the calendar as a proposal.</div>}
              {post.failure_reason && post.status === 'failed' && (
                <div style={{ marginTop: 6, color: 'var(--danger)' }}>{post.failure_reason}</div>
              )}
            </div>
          </div>

          <Field
            label="Caption"
            hint="A price or an offer here is checked against your catalogue and business facts."
            error={post.needs_review_reason && caption === post.caption ? post.needs_review_reason : undefined}
          >
            <Textarea rows={6} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>

          <Field label="Date and time" hint={tz ? `In your business timezone (${tz}).` : 'In your business timezone.'}>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        tone="accent"
        title="Publish this now?"
        body={`It goes to ${platformLabel(post.platform)} straight away, for everyone to see, with the caption as last saved. This cannot be undone from here.`}
        confirmLabel="Publish now"
        busy={publish.busy}
        onConfirm={() => publish.run()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function LibraryTab({ canWrite, isAdmin, connected }: {
  canWrite: boolean; isAdmin: boolean; connected: PostPlatform[];
}) {
  const toast = useToast();
  const state = useAsync(() => getContent(), []);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const setStatus = useMutation(async (item: ContentItem, status: ContentItem['status']) => {
    await updateContent(item.id, { status });
    toast.push('success',
      status === 'approved' ? 'Approved. It can now be put on the calendar.'
        : status === 'archived' ? 'Archived. It will not be proposed again.'
        : 'Moved back to drafts.');
    state.reload();
  });

  const remove = useMutation(async (item: ContentItem) => {
    const result = await deleteContent(item.id);
    toast.push('info', result.archived ? 'It has been posted before, so it was archived instead of deleted.' : 'Deleted.');
    setDeleting(null);
    state.reload();
  });

  const all = state.data?.items ?? [];
  const items = showArchived ? all : all.filter((i) => i.status !== 'archived');
  const approved = all.filter((i) => i.status === 'approved').length;

  return (
    <div style={{ padding: '14px 20px 20px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
          {all.length ? `${approved} approved for posting · ${all.length} in total` : 'Your own photos and videos only. Nothing is generated.'}
        </span>
        <span style={{ flex: 1 }} />
        {all.some((i) => i.status === 'archived') && (
          <Button size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
        )}
        {canWrite && (
          <Button size="sm" variant="accent" icon={<Upload size={14} />} onClick={() => setUploading(true)}>
            Upload
          </Button>
        )}
      </div>

      <InlineError message={setStatus.error || remove.error} />
      {state.loading && !state.data && <LoadingState rows={3} />}
      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}
      {state.data && !state.data.available && (
        <Notice tone="info">Posting is not set up on this workspace yet. A database update is pending.</Notice>
      )}

      {state.data && state.data.available && !items.length && (
        <EmptyState
          icon={<Images size={22} />}
          title="Nothing in the library yet"
          body="Upload your own photos and videos, say what each is about, and approve the ones that may be posted."
          action={canWrite && (
            <Button variant="accent" icon={<Plus size={14} />} onClick={() => setUploading(true)}>Upload the first one</Button>
          )}
        />
      )}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
        {items.map((item) => (
          <Card key={item.id} style={{ display: 'grid', gap: 9, alignContent: 'start' }}>
            <Thumb url={item.media_url} type={item.media_type} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pill tone={item.status === 'approved' ? 'success' : item.status === 'draft' ? 'warning' : 'neutral'} dot>
                {item.status === 'approved' ? 'Approved' : item.status === 'draft' ? 'Draft' : 'Archived'}
              </Pill>
              {item.media_type === 'video' && <Pill tone="neutral">Video</Pill>}
              {itemPlatforms(item).map((p) => <Pill key={p} tone="neutral">{PLATFORM_LABEL[p]}</Pill>)}
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                Posted {item.times_used}{item.max_uses != null ? ` of ${item.max_uses}` : ''}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
              {item.about || <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>Not linked to anything</span>}
            </div>
            <p style={{
              fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, overflowWrap: 'anywhere',
              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {item.caption || <em style={{ color: 'var(--text-3)' }}>No caption yet</em>}
            </p>
            {item.review_reason && (
              <p style={{ fontSize: 11.5, color: 'var(--warning)', lineHeight: 1.45 }}>
                Read before posting: {item.review_reason}
              </p>
            )}
            {canWrite && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isAdmin && item.status === 'draft' && (
                  <Button size="sm" variant="success" icon={<Check size={12} />} disabled={setStatus.busy} onClick={() => setStatus.run(item, 'approved')}>
                    Approve
                  </Button>
                )}
                <Button size="sm" icon={<Pencil size={12} />} onClick={() => setEditing(item)}>Edit</Button>
                {item.status !== 'archived' ? (
                  <Button size="sm" variant="subtle" disabled={setStatus.busy} onClick={() => setStatus.run(item, 'archived')}>Archive</Button>
                ) : (
                  <Button size="sm" variant="subtle" disabled={setStatus.busy} onClick={() => setStatus.run(item, 'draft')}>Restore</Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="subtle" icon={<Trash2 size={12} />} aria-label="Delete" onClick={() => setDeleting(item)} />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {uploading && (
        <ContentEditor
          item={null} isAdmin={isAdmin} connected={connected}
          onClose={() => setUploading(false)}
          onSaved={(saved) => {
            toast.push(saved.note ? 'info' : 'success', saved.note ?? (saved.status === 'approved' ? 'Uploaded and approved.' : 'Uploaded as a draft.'));
            setUploading(false);
            state.reload();
          }}
        />
      )}
      {editing && (
        <ContentEditor
          item={editing} isAdmin={isAdmin} connected={connected}
          onClose={() => setEditing(null)}
          onSaved={() => { toast.push('success', 'Saved.'); setEditing(null); state.reload(); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this item?"
        body="The photo or video is removed from the library. If it has been posted before it is archived instead, so the calendar keeps its record. Posts already published are not affected."
        confirmLabel="Delete"
        busy={remove.busy}
        onConfirm={() => deleting && remove.run(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ContentEditor({ item, isAdmin, connected, onClose, onSaved }: {
  item: ContentItem | null; isAdmin: boolean; connected: PostPlatform[];
  onClose: () => void; onSaved: (saved: ContentItem) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState(item?.caption ?? '');
  const [link, setLink] = useState(
    item?.product_id ? `product:${item.product_id}` : item?.service_id ? `service:${item.service_id}` : ''
  );
  const [about, setAbout] = useState(item && !item.product_id && !item.service_id ? item.about ?? '' : '');
  const [maxUses, setMaxUses] = useState(item?.max_uses != null ? String(item.max_uses) : '');
  const [approve, setApprove] = useState(false);
  // A new item starts marked for whatever is connected; an existing one keeps its own.
  const [platforms, setPlatforms] = useState<PostPlatform[]>(
    item ? itemPlatforms(item) : connected.length ? connected : ['instagram']
  );
  const togglePlatform = (p: PostPlatform, on: boolean) =>
    setPlatforms((cur) => (['instagram', 'facebook'] as PostPlatform[]).filter((x) => (x === p ? on : cur.includes(x))));

  const catalogue = useAsync(async () => {
    const [products, services] = await Promise.all([
      getProducts().catch(() => ({ products: [] })),
      getServices(true).catch(() => ({ services: [] })),
    ]);
    return [
      ...products.products.map((p) => ({ value: `product:${p.id}`, label: `Product: ${p.name}` })),
      ...services.services.map((s) => ({ value: `service:${s.id}`, label: `Service: ${s.name}` })),
    ];
  }, []);

  const save = useMutation(async () => {
    const [kind, id] = link ? link.split(':') : ['', ''];
    const uses = maxUses.trim() === '' ? null : Number(maxUses);
    if (!platforms.length) throw new Error('Choose where this may be posted: Instagram, Facebook, or both.');

    if (item) {
      onSaved(await updateContent(item.id, {
        caption,
        product_id: kind === 'product' ? id : null,
        service_id: kind === 'service' ? id : null,
        about: kind ? null : about.trim() || null,
        max_uses: uses,
        platforms,
      }));
      return;
    }

    if (!file) throw new Error('Choose a photo or video to upload.');
    const form = new FormData();
    form.append('file', file);
    form.append('caption', caption);
    if (kind === 'product') form.append('product_id', id);
    if (kind === 'service') form.append('service_id', id);
    if (!kind && about.trim()) form.append('about', about.trim());
    if (uses !== null) form.append('max_uses', String(uses));
    form.append('platforms', platforms.join(','));
    if (approve) form.append('status', 'approved');
    onSaved(await uploadContent(form));
  });

  return (
    <Modal
      open onClose={onClose} title={item ? 'Edit library item' : 'Upload a photo or video'} width={540}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" loading={save.busy} disabled={!item && !file} onClick={() => save.run()}>
            {item ? 'Save' : 'Upload'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} />

        {item ? (
          <div style={{ maxWidth: 160 }}><Thumb url={item.media_url} type={item.media_type} /></div>
        ) : (
          <Field
            label="Photo or video" required
            hint="Your own JPEG photo (up to 8 MB) or MP4 video. Instagram needs a JPEG for photos."
          >
            <input
              ref={fileRef} type="file" className="field" accept="image/jpeg,image/png,video/mp4"
              style={{ height: 'auto', padding: 8 }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        )}

        <Field label="Caption" hint="Write it yourself, or ask Shwari for a draft. A price or offer is checked against your catalogue.">
          <Textarea rows={5} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>

        <Field label="What is it about?" hint="Linking a product or service stops the same one being posted twice running.">
          <Select
            value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="Not a product or service"
            options={catalogue.data ?? []}
          />
        </Field>

        {!link && (
          <Field label="Or describe it" hint="For example: behind the scenes, the team, a happy customer.">
            <Input value={about} maxLength={120} onChange={(e) => setAbout(e.target.value)} />
          </Field>
        )}

        <Field
          label="Where may it be posted?"
          hint={
            platforms.some((p) => !connected.includes(p))
              ? `Not connected yet: ${platforms.filter((p) => !connected.includes(p)).map((p) => PLATFORM_LABEL[p]).join(' and ')}. Nothing is posted there until it is.`
              : 'It is only ever posted where you tick. Ticking both posts it to both at the same time.'
          }
        >
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Checkbox
              label="Instagram"
              checked={platforms.includes('instagram')} onChange={(e) => togglePlatform('instagram', e.target.checked)}
            />
            <Checkbox
              label="Facebook Page"
              checked={platforms.includes('facebook')} onChange={(e) => togglePlatform('facebook', e.target.checked)}
            />
          </div>
        </Field>

        <Field label="How many times may it be posted?" hint="Leave empty for no limit. Going out on Instagram and Facebook at the same time counts once.">
          <Input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="No limit" />
        </Field>

        {!item && isAdmin && (
          <Checkbox
            label="Approve it for posting now"
            checked={approve} onChange={(e) => setApprove(e.target.checked)}
          />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function ScheduleTab({ status, isAdmin, onSaved }: {
  status: PostingStatus; isAdmin: boolean; onSaved: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<ApprovalMode>(status.settings.approval_mode);
  const [slots, setSlots] = useState<PostingSlot[]>(status.settings.slots);
  const paused = status.settings.paused;

  const save = useMutation(async () => {
    await savePostingSettings({ approval_mode: mode, slots });
    toast.push('success', 'Saved. Posts already on the calendar keep their times.');
    onSaved();
  });

  const togglePause = useMutation(async () => {
    await savePostingSettings({ paused: !paused });
    toast.push('info', paused ? 'Posting is on again.' : 'Posting is paused. Nothing will be published.');
    onSaved();
  });

  const setSlot = (index: number, patch: Partial<PostingSlot>) =>
    setSlots((cur) => cur.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  return (
    <div className="p-5" style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
      <InlineError message={save.error || togglePause.error} />

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{paused ? 'Posting is paused' : 'Posting is on'}</div>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.55 }}>
              {paused
                ? 'Nothing is published, including approved posts. They stay on the calendar.'
                : 'Approved posts are published at their times. Pause to stop everything at once.'}
            </p>
          </div>
          {isAdmin && (
            <Button
              variant={paused ? 'accent' : 'danger'} loading={togglePause.busy}
              icon={paused ? <Play size={14} /> : <Pause size={14} />}
              onClick={() => togglePause.run()}
            >
              {paused ? 'Resume posting' : 'Pause posting'}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'grid', gap: 13 }}>
          <Field label="How posts are approved" hint={MODE_HINT[mode]}>
            <Select
              value={mode} disabled={!isAdmin}
              onChange={(e) => setMode(e.target.value as ApprovalMode)}
              options={(Object.keys(MODE_LABEL) as ApprovalMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            />
          </Field>

          <div>
            <div className="field-label">Posting days and times</div>
            <p className="field-hint" style={{ marginBottom: 8 }}>
              {status.timezone ? `In your business timezone (${status.timezone}).` : 'In your business timezone.'}{' '}
              One post goes out at each time.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {slots.length === 0 && (
                <div className="board-empty">No posting times. Nothing will be laid out until you add one.</div>
              )}
              {slots.map((slot, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                    <Select
                      aria-label="Day" value={String(slot.day)} disabled={!isAdmin}
                      onChange={(e) => setSlot(i, { day: Number(e.target.value) })}
                      options={DAY_NAMES.map((name, d) => ({ value: String(d), label: name }))}
                    />
                  </div>
                  <div style={{ flex: '0 1 130px' }}>
                    <Input
                      aria-label="Time" type="time" value={slot.time} disabled={!isAdmin}
                      onChange={(e) => setSlot(i, { time: e.target.value })}
                    />
                  </div>
                  {isAdmin && (
                    <Button
                      size="sm" variant="subtle" icon={<X size={13} />} aria-label="Remove this time"
                      onClick={() => setSlots((cur) => cur.filter((_, n) => n !== i))}
                    />
                  )}
                </div>
              ))}
            </div>
            {isAdmin && slots.length < 21 && (
              <div style={{ marginTop: 10 }}>
                <Button size="sm" icon={<Plus size={13} />} onClick={() => setSlots((cur) => [...cur, { day: 1, time: '18:00' }])}>
                  Add a time
                </Button>
              </div>
            )}
          </div>

          {isAdmin ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="accent" loading={save.busy} onClick={() => save.run()}>Save schedule</Button>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Only an owner or admin can change the schedule.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

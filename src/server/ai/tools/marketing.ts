import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, bool, oneOf, type Tool, type AgentContext } from './types.js';
import { parseInTimezone, safeTimezone } from '../time.js';
import {
  MarketingError, NOT_SET_UP, missingTable, isUuid, describeWhen,
  getSettings, saveSettings, instagramStatus, loadGrounding, checkCaption,
  planWeek, listPosts, approvePosts, updatePost, schedulePost,
  type ContentItem, type ScheduledPost, type PostStatus,
} from '../../services/marketing.js';

/**
 * Posting, by chat.
 *
 * Shwari runs the calendar for the owner: what is in the library, what is
 * going out this week, approving, moving, rejecting, pausing. Every rule that
 * matters lives in services/marketing.ts, which the dashboard uses too, so
 * there is no second, weaker path here: these tools cannot publish, cannot
 * approve anything that is not on the calendar, and never write or alter
 * media. Each result carries the real counts and names so the reply can only
 * report what happened.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Run a service call, turning its plain-language failures into tool errors. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MarketingError) throw new ToolInputError(e.message);
    throw e;
  }
}

function when(args: Record<string, unknown>, key: string, ctx: AgentContext): Date | null {
  const raw = str(args, key, { max: 40 });
  if (!raw) return null;
  const parsed = parseInTimezone(raw, ctx.timezone);
  if (!parsed) throw new ToolInputError(`${key} must be a date and time, e.g. 2026-11-27T18:00.`);
  return parsed;
}

const short = (text: string | null | undefined, max = 140) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}...` : t;
};

function postView(p: ScheduledPost, tz: string) {
  return {
    post_id: p.id,
    when: describeWhen(p.scheduled_for, tz),
    scheduled_for: p.scheduled_for,
    about: p.about || null,
    kind: p.media_type === 'video' ? 'video' : 'photo',
    caption: short(p.caption),
    status: p.status,
    needs_review: p.needs_review_reason || undefined,
    failure: p.status === 'failed' ? p.failure_reason || undefined : undefined,
    link: p.external_permalink || undefined,
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

const UNAPPROVED_NOTE =
  'Posts with status "proposed" are NOT approved and will NOT be published. Only "approved" posts go out, at their time. Never tell the owner a post was published unless its status is "published".';

// ---------------------------------------------------------------------------

export const listContentLibrary: Tool = {
  name: 'list_content_library',
  description:
    "List the photos and videos the owner has uploaded for posting: what each is about, its caption, whether it is approved for posting, and how often it has been used. Use it before proposing posts, and to answer \"what do we have to post\". You cannot add media: only the owner's own uploads, on the Marketing page.",
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'approved', 'archived'], description: 'Only items in this state. Leave out for everything except archived.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const status = str(args, 'status', { lower: true });
    let q = serviceClient.from('content_items').select('*').eq('tenant_id', ctx.tenantId);
    if (status === 'draft' || status === 'approved' || status === 'archived') q = q.eq('status', status);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (error) {
      if (missingTable(error)) return { items: [], total: 0, note: NOT_SET_UP };
      throw new Error(error.message);
    }
    const all = ((data ?? []) as ContentItem[]).filter((i) => status === 'archived' || i.status !== 'archived');
    const grounding = all.length ? await loadGrounding(ctx.tenantId) : null;

    return {
      total: all.length,
      by_status: countBy(all.map((i) => i.status)),
      items: all.slice(0, 40).map((i) => ({
        content_item_id: i.id,
        about: i.about || null,
        kind: i.media_type === 'video' ? 'video' : 'photo',
        caption: short(i.caption),
        status: i.status,
        times_posted: i.times_used ?? 0,
        reuse_limit: i.max_uses ?? null,
        needs_review: grounding ? checkCaption(grounding, i.caption ?? '', i).reason || undefined : undefined,
      })),
      note: !all.length
        ? 'The library is empty. The owner uploads photos and videos on the Marketing page; you cannot create them.'
        : !all.some((i) => i.status === 'approved')
          ? 'Nothing is approved for posting yet. Items are approved on the Marketing page, under Library.'
          : undefined,
    };
  },
};

export const proposeWeekPosts: Tool = {
  name: 'propose_week_posts',
  description:
    "Lay out the next seven days of posts from the approved library, one per posting time. It only PROPOSES: nothing is published until the owner approves (unless the business is on autopilot). Calling it again does not duplicate a week already planned. The result lists what was proposed, which posting times could not be filled and why, and whether anything needs reading first.",
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Start of the seven days, as local date-time. Defaults to now.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const tz = safeTimezone(ctx.timezone);
    const plan = await guarded(() => planWeek(ctx.tenantId, { from: when(args, 'from', ctx) }));
    if (!plan.available) return { proposed_count: 0, proposed: [], note: NOT_SET_UP };
    const waiting = plan.proposed.filter((p) => p.status === 'proposed');
    const instagram = await instagramStatus(ctx.tenantId);

    return {
      week_starting: plan.week_start,
      approval_mode: plan.mode,
      posting_paused: plan.paused,
      proposed_count: plan.proposed.length,
      waiting_for_approval: waiting.length,
      approved_automatically: plan.proposed.length - waiting.length,
      proposed: plan.proposed.map((p) => postView(p, tz)),
      already_on_the_calendar: plan.already_planned,
      unfilled_count: plan.unfilled.length,
      unfilled: plan.unfilled.map((u) => ({ when: u.when, why: u.why })),
      library: plan.library,
      instagram_can_post: instagram.can_publish === true,
      note: [
        plan.note,
        waiting.length ? UNAPPROVED_NOTE : '',
        plan.unfilled.length ? 'The library is running low: ask the owner to upload more photos or videos.' : '',
        instagram.can_publish === true ? '' : 'Instagram is not connected with permission to post yet, so approved posts will fail until it is reconnected on the Integrations page.',
      ].filter(Boolean).join(' ') || undefined,
    };
  },
};

export const listScheduledPosts: Tool = {
  name: 'list_scheduled_posts',
  description:
    'Read the posting calendar: what is proposed, approved, published or failed, with times and captions. Use it for "what is going out this week", before approving or changing a post (it gives the post_id), and to check whether something was actually published.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Local date-time. Defaults to the start of today.' },
      to: { type: 'string', description: 'Local date-time. Defaults to 14 days after from.' },
      status: { type: 'string', enum: ['proposed', 'approved', 'publishing', 'published', 'failed', 'rejected', 'cancelled'] },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const tz = safeTimezone(ctx.timezone);
    const from = when(args, 'from', ctx) ?? new Date(Date.now() - 12 * 3_600_000);
    const to = when(args, 'to', ctx) ?? new Date(from.getTime() + 14 * 86_400_000);
    const status = str(args, 'status', { lower: true }) as PostStatus | '';

    const [{ available, posts }, settings] = await Promise.all([
      listPosts(ctx.tenantId, { from, to, status: status || null, limit: 100 }),
      getSettings(ctx.tenantId),
    ]);
    if (!available) return { total: 0, posts: [], note: NOT_SET_UP };

    const waiting = posts.filter((p) => p.status === 'proposed').length;
    return {
      total: posts.length,
      by_status: countBy(posts.map((p) => p.status)),
      approval_mode: settings.approval_mode,
      posting_paused: settings.paused,
      posts: posts.slice(0, 40).map((p) => postView(p, tz)),
      note: [
        !posts.length ? 'Nothing is on the calendar for those dates.' : '',
        waiting ? `${waiting} ${waiting === 1 ? 'post is' : 'posts are'} waiting for approval. ${UNAPPROVED_NOTE}` : '',
        settings.paused ? 'Posting is paused: nothing will be published until it is resumed.' : '',
      ].filter(Boolean).join(' ') || undefined,
    };
  },
};

export const approvePostsTool: Tool = {
  name: 'approve_posts',
  description:
    'Approve posts so they are published at their time. Pass post_ids from list_scheduled_posts, or week_start (a date) to approve every proposed post in the seven days from that date. Only use it when the owner has said to approve: this is what lets a post go out in public. The result says exactly which were approved and which were not, and why.',
  parameters: {
    type: 'object',
    properties: {
      post_ids: { type: 'array', items: { type: 'string' }, description: 'The posts to approve.' },
      week_start: { type: 'string', description: 'A date such as 2026-11-23: approve every proposed post in the seven days from it.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const tz = safeTimezone(ctx.timezone);
    const ids = Array.isArray(args.post_ids) ? args.post_ids.map((v) => String(v).trim()).filter(Boolean) : [];
    const weekStart = str(args, 'week_start', { max: 10 });
    if (!ids.length && !weekStart) throw new ToolInputError('Pass post_ids, or week_start to approve a whole week.');

    const result = await guarded(() => approvePosts(ctx.tenantId, {
      ids: ids.length ? ids : null,
      weekStart: ids.length ? null : weekStart,
      by: ctx.userId,
    }));
    const settings = await getSettings(ctx.tenantId);
    const instagram = await instagramStatus(ctx.tenantId);

    return {
      approved_count: result.approved.length,
      approved: result.approved.map((p) => postView(p, tz)),
      not_approved_count: result.skipped.length,
      not_approved: result.skipped,
      note: [
        result.approved.length
          ? 'These are approved, not yet published: each goes out at its time. Say "approved", not "posted".'
          : 'Nothing was approved.',
        settings.paused ? 'Posting is paused, so they will not go out until it is resumed.' : '',
        instagram.can_publish === true ? '' : 'Instagram is not connected with permission to post, so these will fail until it is reconnected on the Integrations page.',
      ].filter(Boolean).join(' '),
    };
  },
};

export const updateScheduledPost: Tool = {
  name: 'update_scheduled_post',
  description:
    'Change one post on the calendar: edit its caption, move it to another time, swap its photo or video for another approved library item, reject a proposal, or cancel an approved post. To put a specific library item on the calendar at a chosen time, leave out post_id and pass content_item_id with scheduled_for: it is added as a proposal for the owner to approve. A caption you write is a draft: an approved post you re-caption goes back to proposed. You cannot change a post that is already published.',
  parameters: {
    type: 'object',
    properties: {
      post_id: { type: 'string', description: 'From list_scheduled_posts. Leave out only when adding a new post.' },
      caption: { type: 'string', description: 'The new caption. State no price or offer that the catalogue and business facts do not.' },
      scheduled_for: { type: 'string', description: 'The new time, as local date-time, e.g. 2026-11-27T18:00.' },
      content_item_id: { type: 'string', description: 'An approved item from list_content_library.' },
      action: { type: 'string', enum: ['reject', 'cancel'], description: 'reject a proposal, or cancel an approved post.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const tz = safeTimezone(ctx.timezone);
    const postId = str(args, 'post_id', { max: 60 });
    const itemId = str(args, 'content_item_id', { max: 60 });
    const scheduledFor = when(args, 'scheduled_for', ctx);
    const action = str(args, 'action', { lower: true });
    const hasCaption = typeof args.caption === 'string';

    if (!postId) {
      if (!itemId || !scheduledFor) {
        throw new ToolInputError('Pass post_id to change a post, or content_item_id and scheduled_for to add one.');
      }
      let post = await guarded(() => schedulePost(ctx.tenantId, { contentItemId: itemId, scheduledFor }));
      if (hasCaption && String(args.caption).trim() !== (post.caption ?? '').trim()) {
        post = await guarded(() => updatePost(ctx.tenantId, post.id, { caption: String(args.caption) }, { by: ctx.userId, byAgent: true }));
      }
      return {
        added: true,
        post: postView(post, tz),
        note: post.status === 'proposed' ? `Added as a proposal. ${UNAPPROVED_NOTE}` : 'Added and approved automatically (autopilot).',
      };
    }

    if (!isUuid(postId)) throw new ToolInputError('That post_id is not on the calendar. Read the calendar with list_scheduled_posts and use the post_id it gives.');
    if (action && action !== 'reject' && action !== 'cancel') throw new ToolInputError('action must be reject or cancel.');
    if (!action && !hasCaption && !scheduledFor && !itemId) {
      throw new ToolInputError('Say what to change: caption, scheduled_for, content_item_id, or action.');
    }

    const post = await guarded(() => updatePost(
      ctx.tenantId,
      postId,
      action
        ? { status: action === 'reject' ? 'rejected' : 'cancelled' }
        : {
            caption: hasCaption ? String(args.caption) : undefined,
            scheduledFor: scheduledFor ?? undefined,
            contentItemId: itemId || undefined,
          },
      { by: ctx.userId, byAgent: true }
    ));

    return {
      changed: true,
      post: postView(post, tz),
      note:
        post.status === 'proposed' ? `It is a proposal now. ${UNAPPROVED_NOTE}`
        : post.status === 'rejected' || post.status === 'cancelled' ? 'It will not be published.'
        : post.status === 'approved' ? 'It is still approved and will go out at its time.'
        : undefined,
    };
  },
};

export const setPostingSchedule: Tool = {
  name: 'set_posting_schedule',
  description:
    'Set when the business posts and how posts are approved. slots is the complete list of posting times (it replaces the current list); approval_mode is week (the owner approves a week at a time - the default), each (every post needs its own approval) or autopilot (approved library items go out without asking). Posts already on the calendar are not moved. Changing to autopilot means posts go out unprompted, so only do it when the owner has plainly asked.',
  parameters: {
    type: 'object',
    properties: {
      slots: {
        type: 'array',
        description: 'Every posting time in a week, in the business timezone.',
        items: {
          type: 'object',
          properties: {
            day: { type: 'number', description: '0 = Sunday, 1 = Monday ... 6 = Saturday.' },
            time: { type: 'string', description: '24-hour time, e.g. 18:00.' },
          },
          required: ['day', 'time'],
        },
      },
      approval_mode: { type: 'string', enum: ['week', 'each', 'autopilot'] },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    if (args.slots === undefined && args.approval_mode === undefined) {
      throw new ToolInputError('Pass slots, approval_mode, or both.');
    }
    const settings = await guarded(() => saveSettings(ctx.tenantId, {
      slots: args.slots,
      approval_mode: args.approval_mode === undefined ? undefined : oneOf(args, 'approval_mode', ['week', 'each', 'autopilot'] as const, null),
    }));
    return {
      saved: true,
      approval_mode: settings.approval_mode,
      posting_paused: settings.paused,
      posts_per_week: settings.slots.length,
      posting_times: settings.slots.map((s) => `${DAY_NAMES[s.day]} ${s.time}`),
      note: 'This is now what the Marketing page shows under Schedule. Posts already on the calendar keep their times.',
    };
  },
};

export const pausePosting: Tool = {
  name: 'pause_posting',
  description:
    'Pause or resume posting for the whole business. While paused nothing is published, including posts already approved; they stay on the calendar. Pass paused: true to stop, false to resume. A post left waiting more than a day past its time is not published late.',
  parameters: {
    type: 'object',
    properties: { paused: { type: 'boolean', description: 'true to pause, false to resume.' } },
    required: ['paused'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    if (args.paused === undefined) throw new ToolInputError('paused is required: true to pause, false to resume.');
    const settings = await guarded(() => saveSettings(ctx.tenantId, { paused: bool(args, 'paused', true) }));
    const { posts } = await listPosts(ctx.tenantId, { from: new Date(), status: 'approved', limit: 100 });
    return {
      posting_paused: settings.paused,
      approved_posts_waiting: posts.length,
      note: settings.paused
        ? 'Posting is paused. Nothing will be published until it is resumed.'
        : 'Posting is on again. Approved posts go out at their times.',
    };
  },
};

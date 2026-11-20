import crypto from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth, requireWrite, requireAdmin, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { parseInTimezone } from '../ai/time.js';
import {
  MarketingError, NOT_SET_UP, missingTable, isUuid,
  getSettings, saveSettings, instagramStatus,
  loadGrounding, checkCaption,
  planWeek, approvePosts, updatePost, schedulePost, publishNow,
  type ContentItem, type PostPatch,
} from '../services/marketing.js';

export const marketingRouter = Router();

/**
 * Marketing: the content library, the posting calendar and its settings.
 *
 * Reads go through the caller's own session, so row level security decides
 * what they see. Every write goes through the service role, pinned to the
 * tenant the session resolved - never to an id in the body. Anything that
 * decides what the public sees (approving, publishing, the schedule) needs an
 * owner or admin.
 */

const BUCKET = 'post-media';
const IMAGE_LIMIT = 8 * 1024 * 1024;
const VIDEO_LIMIT = 100 * 1024 * 1024;

const TYPES: Record<string, { ext: string; kind: 'image' | 'video' }> = {
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMIT, files: 1, fields: 12 },
  fileFilter: (_req, file, cb) => {
    if (TYPES[file.mimetype]) return cb(null, true);
    cb(new MarketingError('Upload a JPEG or PNG photo, or an MP4 video.', 415));
  },
});

/** multer, with its errors turned into the JSON the dashboard expects. */
function receiveFile(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof MarketingError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. Videos can be up to 100 MB.' : 'That upload was not valid.',
      });
    }
    console.error('[marketing] upload failed:', err);
    res.status(400).json({ error: 'That upload was not valid.' });
  });
}

/** Do the first bytes match what the file claims to be? */
function looksLike(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'video/mp4') return buffer.length > 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp';
  return false;
}

/** Run a handler, answering a MarketingError with its own status and words. */
function route(fn: (req: Request, res: Response) => Promise<unknown>) {
  return handler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof MarketingError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });
}

const isAdmin = (req: Request) => req.ctx!.role === 'owner' || req.ctx!.role === 'admin';

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseWhen(value: unknown, timezone: string | null): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return parseInTimezone(value.trim().slice(0, 40), timezone);
}

async function tenantTimezone(tenantId: string): Promise<string | null> {
  const { data } = await serviceClient.from('tenants').select('timezone').eq('id', tenantId).limit(1);
  return Array.isArray(data) && data[0] ? data[0].timezone ?? null : null;
}

/** What a library item is about: a product, a service, or a free label. */
async function resolveAbout(
  tenantId: string,
  body: Record<string, unknown>
): Promise<{ product_id: string | null; service_id: string | null; about: string | null }> {
  const productId = text(body.product_id, 60);
  const serviceId = text(body.service_id, 60);
  const about = text(body.about, 120) || null;

  if (productId) {
    if (!isUuid(productId)) throw new MarketingError('That product could not be found.');
    const { data } = await serviceClient.from('products').select('id, name').eq('tenant_id', tenantId).eq('id', productId).limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new MarketingError('That product could not be found.');
    return { product_id: row.id, service_id: null, about: about || row.name };
  }
  if (serviceId) {
    if (!isUuid(serviceId)) throw new MarketingError('That service could not be found.');
    const { data } = await serviceClient.from('services').select('id, name').eq('tenant_id', tenantId).eq('id', serviceId).limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new MarketingError('That service could not be found.');
    return { product_id: null, service_id: row.id, about: about || row.name };
  }
  return { product_id: null, service_id: null, about };
}

function maxUses(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new MarketingError('The reuse limit must be a whole number of at least 1, or left empty.');
  return n;
}

// ---------------------------------------------------------------------------
// The content library
// ---------------------------------------------------------------------------

marketingRouter.get(
  '/content',
  requireAuth,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('content_items')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(500);
    // The table arrives with migration 0024. Until then the library is empty.
    if (error) return res.json({ items: [], available: !missingTable(error) });

    const items = (data ?? []) as ContentItem[];
    // Each caption is checked against the catalogue as it stands today, so a
    // price that has since changed shows up here before it is posted.
    const grounding = items.length ? await loadGrounding(ctx.tenantId) : null;
    res.json({
      available: true,
      items: items.map((item) => ({
        ...item,
        review_reason: grounding ? checkCaption(grounding, item.caption ?? '', item).reason : null,
      })),
    });
  })
);

marketingRouter.post(
  '/content',
  requireAuth,
  requireWrite,
  receiveFile,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new MarketingError('Choose a photo or video to upload.');

    const type = TYPES[file.mimetype];
    if (!type || !looksLike(file.buffer, file.mimetype)) {
      throw new MarketingError('That file is not a JPEG or PNG photo or an MP4 video.', 415);
    }
    if (type.kind === 'image' && file.size > IMAGE_LIMIT) {
      throw new MarketingError('That photo is too large. Photos can be up to 8 MB.', 413);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const about = await resolveAbout(ctx.tenantId, body);
    const wantsApproved = text(body.status, 20) === 'approved';
    if (wantsApproved && !isAdmin(req)) {
      throw new MarketingError('Only an owner or admin can approve content for posting. Save it as a draft instead.', 403);
    }

    const path = `${ctx.tenantId}/${crypto.randomUUID()}.${type.ext}`;
    const storage = serviceClient.storage.from(BUCKET);
    const { error: upErr } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '31536000',
      upsert: false,
    });
    if (upErr) {
      console.error('[marketing] storage upload failed:', upErr.message);
      throw new MarketingError(
        /bucket/i.test(upErr.message) ? NOT_SET_UP : 'The file could not be stored. Please try again.',
        502
      );
    }
    const mediaUrl = storage.getPublicUrl(path).data.publicUrl;

    const { data, error } = await serviceClient
      .from('content_items')
      .insert({
        tenant_id: ctx.tenantId,
        media_url: mediaUrl,
        media_path: path,
        media_type: type.kind,
        caption: text(body.caption, 2200),
        ...about,
        platforms: ['instagram'],
        status: wantsApproved ? 'approved' : 'draft',
        max_uses: maxUses(body.max_uses),
        created_by: ctx.userId,
      })
      .select('*');

    const row = !error && Array.isArray(data) ? (data[0] as ContentItem | undefined) : undefined;
    if (!row) {
      // Do not leave a file behind that no row points at.
      await storage.remove([path]).catch(() => undefined);
      if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
      console.error('[marketing] could not save the library item:', error?.message);
      throw new MarketingError('The item could not be saved. Please try again.', 500);
    }

    const check = checkCaption(await loadGrounding(ctx.tenantId), row.caption ?? '', row);
    res.status(201).json({
      ...row,
      review_reason: check.reason,
      // Instagram's publishing API documents JPEG as its only photo format.
      note: file.mimetype === 'image/png'
        ? 'Saved. Instagram officially accepts JPEG photos only, so this PNG may be refused when it is posted. A JPEG copy is safer.'
        : undefined,
    });
  })
);

marketingRouter.patch(
  '/content/:id',
  requireAuth,
  requireWrite,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const id = String(req.params.id);
    if (!isUuid(id)) throw new MarketingError('That item could not be found.', 404);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const change: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.caption !== undefined) change.caption = text(body.caption, 2200);
    if (body.product_id !== undefined || body.service_id !== undefined || body.about !== undefined) {
      Object.assign(change, await resolveAbout(ctx.tenantId, body));
    }
    if (body.max_uses !== undefined) change.max_uses = maxUses(body.max_uses);
    if (body.status !== undefined) {
      const status = text(body.status, 20);
      if (status !== 'draft' && status !== 'approved' && status !== 'archived') {
        throw new MarketingError('The status must be draft, approved or archived.');
      }
      if (status === 'approved' && !isAdmin(req)) {
        throw new MarketingError('Only an owner or admin can approve content for posting.', 403);
      }
      change.status = status;
    }

    const { data, error } = await serviceClient
      .from('content_items').update(change)
      .eq('tenant_id', ctx.tenantId).eq('id', id)
      .select('*');
    if (error) {
      if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
      throw new Error(error.message);
    }
    const row = Array.isArray(data) ? (data[0] as ContentItem | undefined) : undefined;
    if (!row) throw new MarketingError('That item could not be found.', 404);
    const check = checkCaption(await loadGrounding(ctx.tenantId), row.caption ?? '', row);
    res.json({ ...row, review_reason: check.reason });
  })
);

marketingRouter.delete(
  '/content/:id',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const id = String(req.params.id);
    if (!isUuid(id)) throw new MarketingError('That item could not be found.', 404);

    const { data: found, error: readErr } = await serviceClient
      .from('content_items').select('id, media_path').eq('tenant_id', ctx.tenantId).eq('id', id).limit(1);
    if (readErr) {
      if (missingTable(readErr)) throw new MarketingError(NOT_SET_UP, 503);
      throw new Error(readErr.message);
    }
    const item = Array.isArray(found) ? found[0] : null;
    if (!item) throw new MarketingError('That item could not be found.', 404);

    const { data: posts } = await serviceClient
      .from('scheduled_posts').select('id, status').eq('tenant_id', ctx.tenantId).eq('content_item_id', id).limit(200);
    const used = Array.isArray(posts) ? posts : [];
    if (used.some((p) => ['proposed', 'approved', 'publishing'].includes(p.status))) {
      throw new MarketingError('This item is on the calendar. Reject or cancel those posts first.', 409);
    }

    // Something that was posted keeps its picture on the calendar, so the item
    // is archived rather than removed.
    if (used.length) {
      await serviceClient.from('content_items')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId).eq('id', id);
      return res.json({ deleted: false, archived: true });
    }

    const { error } = await serviceClient.from('content_items').delete().eq('tenant_id', ctx.tenantId).eq('id', id);
    if (error) throw new Error(error.message);
    if (item.media_path && String(item.media_path).startsWith(`${ctx.tenantId}/`)) {
      await serviceClient.storage.from(BUCKET).remove([item.media_path]).catch(() => undefined);
    }
    res.json({ deleted: true, archived: false });
  })
);

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

marketingRouter.get(
  '/posts',
  requireAuth,
  route(async (req, res) => {
    const ctx = req.ctx!;
    // A time without an offset is wall-clock time in the business's timezone,
    // so the calendar shows the same days on any device.
    const timezone = await tenantTimezone(ctx.tenantId);
    const from = parseWhen(req.query.from, timezone);
    const to = parseWhen(req.query.to, timezone);

    let q = ctx.db.from('scheduled_posts').select('*').eq('tenant_id', ctx.tenantId);
    if (from && !Number.isNaN(from.getTime())) q = q.gte('scheduled_for', from.toISOString());
    if (to && !Number.isNaN(to.getTime())) q = q.lt('scheduled_for', to.toISOString());
    const { data, error } = await q.order('scheduled_for', { ascending: true }).limit(300);
    if (error) return res.json({ posts: [], available: !missingTable(error) });
    res.json({ posts: data ?? [], available: true });
  })
);

/** Put one library item on the calendar at a chosen time, as a proposal. */
marketingRouter.post(
  '/posts',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const when = parseWhen(req.body?.scheduled_for, await tenantTimezone(ctx.tenantId));
    if (!when) throw new MarketingError('Choose a date and time for the post.');
    const post = await schedulePost(ctx.tenantId, {
      contentItemId: String(req.body?.content_item_id ?? ''),
      scheduledFor: when,
    });
    res.status(201).json(post);
  })
);

marketingRouter.post(
  '/posts/plan-week',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const from = parseWhen(req.body?.from, await tenantTimezone(ctx.tenantId));
    const plan = await planWeek(ctx.tenantId, { from });
    if (!plan.available) throw new MarketingError(NOT_SET_UP, 503);
    res.json(plan);
  })
);

marketingRouter.post(
  '/posts/approve',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 100) : null;
    const weekStart = typeof req.body?.week_start === 'string' ? req.body.week_start.trim() : null;
    const result = await approvePosts(ctx.tenantId, { ids, weekStart, by: ctx.userId });
    res.json({ ...result, approved_count: result.approved.length });
  })
);

marketingRouter.patch(
  '/posts/:id',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: PostPatch = {};

    if (body.status !== undefined) {
      const status = text(body.status, 20);
      if (status !== 'rejected' && status !== 'cancelled') {
        throw new MarketingError('A post can be rejected or cancelled here. Use approve to approve it.');
      }
      patch.status = status;
    }
    if (body.caption !== undefined) patch.caption = typeof body.caption === 'string' ? body.caption : '';
    if (body.content_item_id !== undefined) patch.contentItemId = String(body.content_item_id);
    if (body.scheduled_for !== undefined) {
      const when = parseWhen(body.scheduled_for, await tenantTimezone(ctx.tenantId));
      if (!when) throw new MarketingError('That is not a date and time.');
      patch.scheduledFor = when;
    }

    res.json(await updatePost(ctx.tenantId, String(req.params.id), patch, { by: ctx.userId }));
  })
);

marketingRouter.post(
  '/posts/:id/publish-now',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const { outcome, post } = await publishNow(ctx.tenantId, String(req.params.id), { by: ctx.userId });
    res.json({
      outcome,
      post,
      message:
        outcome === 'published' ? 'Published.'
        : outcome === 'processing' ? 'Instagram is still processing the video. It will be published as soon as it is ready.'
        : outcome === 'failed' ? (post.failure_reason || 'It could not be published.')
        : 'It is already being published.',
    });
  })
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

marketingRouter.get(
  '/posting-settings',
  requireAuth,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const [settings, instagram, timezone] = await Promise.all([
      getSettings(ctx.tenantId), instagramStatus(ctx.tenantId), tenantTimezone(ctx.tenantId),
    ]);
    res.json({ settings, instagram, timezone });
  })
);

marketingRouter.put(
  '/posting-settings',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const ctx = req.ctx!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const settings = await saveSettings(ctx.tenantId, {
      approval_mode: body.approval_mode,
      paused: body.paused,
      slots: body.slots,
    });
    res.json({ settings });
  })
);

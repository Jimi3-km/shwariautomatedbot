import { INSTAGRAM_GRAPH_URL } from '../../config/meta.js';

/**
 * Publishing to Instagram (Instagram Login for Business, graph.instagram.com).
 *
 * Meta publishes in two steps: a media container is created from a public URL,
 * and then the container is published. A photo's container is ready almost at
 * once; a video is processed first and has to be polled until it is FINISHED.
 *
 * Nothing here retries a publish. If Instagram does not answer the publish
 * call, the post may or may not have gone out, and the error says exactly
 * that (`uncertain`) so the caller never posts the same thing twice to find
 * out.
 */

export type PublishErrorCode =
  | 'not_connected' | 'permission' | 'token' | 'rate_limited'
  | 'media' | 'processing' | 'rejected' | 'unreachable';

export class InstagramPublishError extends Error {
  readonly code: PublishErrorCode;
  /** A sentence the owner can read. Never contains a token or a raw payload. */
  readonly userMessage: string;
  /** True when the post may have been published despite the failure. */
  readonly uncertain: boolean;
  /** True when reconnecting Instagram is what fixes it. */
  readonly needsReconnect: boolean;

  constructor(code: PublishErrorCode, userMessage: string, opts: { uncertain?: boolean; detail?: string } = {}) {
    super(opts.detail ? `${userMessage} (${opts.detail})` : userMessage);
    this.name = 'InstagramPublishError';
    this.code = code;
    this.userMessage = userMessage;
    this.uncertain = Boolean(opts.uncertain);
    this.needsReconnect = code === 'permission' || code === 'token' || code === 'not_connected';
  }
}

export const RECONNECT_MESSAGE =
  'Instagram has not given this app permission to post. Reconnect Instagram on the Integrations page and allow posting, then try again.';

export interface PublishInput {
  accessToken: string;
  /** The professional account id. Falls back to "me" when it is not known. */
  igUserId: string | null;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
  /** A container made on an earlier run, to resume instead of uploading again. */
  containerId?: string | null;
  /** How long to wait for the media to finish processing, in total. */
  waitMs?: number;
  pollMs?: number;
}

export type PublishResult =
  | { state: 'published'; postId: string; permalink: string | null; containerId: string }
  /** Still processing on Instagram's side. Call again later with the same container. */
  | { state: 'processing'; containerId: string };

interface MetaErrorBody {
  error?: {
    message?: string; type?: string; code?: number; error_subcode?: number;
    error_user_title?: string; error_user_msg?: string;
  };
}

const TIMEOUT_MS = 20_000;

async function call(
  path: string,
  token: string,
  init: { method: 'GET' | 'POST'; params?: Record<string, string> },
  fallback: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(init.params ?? {});
  const query = params.toString();
  const url = init.method === 'GET' && query
    ? `${INSTAGRAM_GRAPH_URL}/${path}?${query}`
    : `${INSTAGRAM_GRAPH_URL}/${path}`;

  const res = await fetch(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.method === 'POST' ? params : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok && body && typeof body === 'object' && !('error' in (body as object))) {
    return body as Record<string, unknown>;
  }
  throw toPublishError(res.status, (body ?? {}) as MetaErrorBody, fallback);
}

/** Turn Meta's error into one of ours, with words an owner can act on. */
export function toPublishError(status: number, body: MetaErrorBody, fallback: string): InstagramPublishError {
  const e = body.error ?? {};
  const text = `${e.message ?? ''} ${e.error_user_msg ?? ''}`;
  const detail = [e.code != null ? `code ${e.code}` : '', e.error_subcode != null ? `subcode ${e.error_subcode}` : '', (e.message ?? '').slice(0, 160)]
    .filter(Boolean).join(', ');

  // 10 and 200-299 are Meta's permission errors; 3 is "capability not granted".
  if (e.code === 10 || e.code === 3 || (e.code != null && e.code >= 200 && e.code <= 299) ||
      /permission|not authorized|instagram_business_content_publish/i.test(text)) {
    return new InstagramPublishError('permission', RECONNECT_MESSAGE, { detail });
  }
  if (e.code === 190 || status === 401) {
    return new InstagramPublishError('token',
      'The Instagram connection has expired. Reconnect Instagram on the Integrations page, then try again.', { detail });
  }
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.error_subcode === 2207042 || status === 429) {
    return new InstagramPublishError('rate_limited',
      'Instagram is not accepting more posts from this account right now (its own limit was reached). Try again later.', { detail });
  }
  if (e.code === 9004 || e.error_subcode === 2207052 || e.error_subcode === 2207003 || e.error_subcode === 2207026 ||
      e.error_subcode === 2207004 || e.error_subcode === 2207005 || e.error_subcode === 2207009 || /media|image|video|aspect ratio|format/i.test(text)) {
    const said = (e.error_user_msg || e.message || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return new InstagramPublishError('media',
      said ? `Instagram could not use this photo or video: ${said}` : 'Instagram could not use this photo or video.', { detail });
  }
  if (status >= 500) {
    return new InstagramPublishError('unreachable', 'Instagram had a problem on its side. Try again later.', { detail });
  }
  const said = (e.error_user_msg || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return new InstagramPublishError('rejected', said ? `Instagram rejected the post: ${said}` : fallback, { detail });
}

function unreachable(e: unknown, uncertain: boolean): InstagramPublishError {
  if (e instanceof InstagramPublishError) return e;
  return new InstagramPublishError(
    'unreachable',
    uncertain
      ? 'Instagram did not confirm the post. It may or may not have gone out - check the account before posting it again.'
      : 'Instagram could not be reached. Nothing was posted.',
    { uncertain, detail: e instanceof Error ? e.message.slice(0, 160) : undefined }
  );
}

/** Step 1: a container for one photo, or one video posted as a reel. */
export async function createMediaContainer(input: PublishInput): Promise<string> {
  const account = input.igUserId || 'me';
  const params: Record<string, string> = input.mediaType === 'video'
    ? { media_type: 'REELS', video_url: input.mediaUrl }
    : { image_url: input.mediaUrl };
  if (input.caption.trim()) params.caption = input.caption.slice(0, 2200);

  let out: Record<string, unknown>;
  try {
    out = await call(`${account}/media`, input.accessToken, { method: 'POST', params }, 'Instagram rejected the post.');
  } catch (e) {
    throw unreachable(e, false);
  }
  const id = out.id != null ? String(out.id) : '';
  if (!id) throw new InstagramPublishError('rejected', 'Instagram did not accept the photo or video.');
  return id;
}

export type ContainerStatus = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

export async function containerStatus(accessToken: string, containerId: string): Promise<{ status: ContainerStatus; detail: string }> {
  let out: Record<string, unknown>;
  try {
    out = await call(containerId, accessToken, { method: 'GET', params: { fields: 'status_code,status' } }, 'Instagram could not say whether the media is ready.');
  } catch (e) {
    throw unreachable(e, false);
  }
  const code = String(out.status_code ?? '').toUpperCase();
  const known: ContainerStatus[] = ['FINISHED', 'IN_PROGRESS', 'ERROR', 'EXPIRED', 'PUBLISHED'];
  return {
    status: (known as string[]).includes(code) ? (code as ContainerStatus) : 'UNKNOWN',
    detail: String(out.status ?? '').slice(0, 200),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Publish one photo or video.
 *
 * Returns 'processing' rather than failing when a video is not ready within
 * the wait: the container is kept and the next call resumes from it.
 */
export async function publishToInstagram(input: PublishInput): Promise<PublishResult> {
  if (!input.accessToken) {
    throw new InstagramPublishError('not_connected', 'Instagram is not connected. Connect it on the Integrations page.');
  }
  if (!/^https:\/\//i.test(input.mediaUrl)) {
    throw new InstagramPublishError('media', 'The photo or video has no public address Instagram can fetch.');
  }

  const containerId = input.containerId || (await createMediaContainer(input));
  const account = input.igUserId || 'me';
  const deadline = Date.now() + Math.max(0, input.waitMs ?? (input.mediaType === 'video' ? 45_000 : 12_000));
  const pollMs = Math.max(1, input.pollMs ?? 3_000);

  for (;;) {
    const { status, detail } = await containerStatus(input.accessToken, containerId);
    if (status === 'FINISHED') break;
    if (status === 'PUBLISHED') {
      // Published on an earlier run that never heard back. Do not publish again.
      throw new InstagramPublishError('rejected',
        'Instagram reports this was already published. Check the account; it was not posted a second time.', { uncertain: true });
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new InstagramPublishError('media',
        status === 'EXPIRED'
          ? 'Instagram stopped waiting for this media. Nothing was posted.'
          : `Instagram could not process this photo or video${detail ? `: ${detail}` : '.'}`);
    }
    if (Date.now() + pollMs > deadline) return { state: 'processing', containerId };
    await sleep(pollMs);
  }

  // From here a failure to hear back is not a failure to post.
  let published: Record<string, unknown>;
  try {
    published = await call(`${account}/media_publish`, input.accessToken,
      { method: 'POST', params: { creation_id: containerId } }, 'Instagram rejected the post.');
  } catch (e) {
    if (e instanceof InstagramPublishError && e.code !== 'unreachable') throw e;
    throw unreachable(e instanceof InstagramPublishError ? null : e, true);
  }

  const postId = published.id != null ? String(published.id) : '';
  if (!postId) {
    throw new InstagramPublishError('unreachable',
      'Instagram did not confirm the post. It may or may not have gone out - check the account before posting it again.',
      { uncertain: true });
  }

  // The link is a courtesy. The post is out whether or not this answers.
  let permalink: string | null = null;
  try {
    const media = await call(postId, input.accessToken, { method: 'GET', params: { fields: 'permalink' } }, '');
    permalink = typeof media.permalink === 'string' ? media.permalink : null;
  } catch { /* published; just no link */ }

  return { state: 'published', postId, permalink, containerId };
}

import { META_GRAPH_URL } from '../../config/meta.js';
import { withAppSecretProof } from './whatsapp.js';
import type { PublishErrorCode } from './instagramPublish.js';

/**
 * Publishing to a Facebook Page.
 *
 * Unlike Instagram there is no container step: one call hands Facebook the
 * public address of the photo or video and the post is made. That makes the
 * single call the point of no return, so nothing here retries it. If Facebook
 * does not answer, the post may or may not have gone out, and the error says
 * exactly that (`uncertain`) so the caller never posts the same thing twice to
 * find out.
 */

export class FacebookPublishError extends Error {
  readonly code: PublishErrorCode;
  /** A sentence the owner can read. Never contains a token or a raw payload. */
  readonly userMessage: string;
  /** True when the post may have been published despite the failure. */
  readonly uncertain: boolean;
  /** True when reconnecting the Page is what fixes it. */
  readonly needsReconnect: boolean;

  constructor(code: PublishErrorCode, userMessage: string, opts: { uncertain?: boolean; detail?: string } = {}) {
    super(opts.detail ? `${userMessage} (${opts.detail})` : userMessage);
    this.name = 'FacebookPublishError';
    this.code = code;
    this.userMessage = userMessage;
    this.uncertain = Boolean(opts.uncertain);
    this.needsReconnect = code === 'permission' || code === 'token' || code === 'not_connected';
  }
}

export const FACEBOOK_RECONNECT_MESSAGE =
  'Facebook has not given this app permission to post to the Page. Reconnect the Page on the Integrations page and allow posting, then try again.';

const UNCONFIRMED =
  'Facebook did not confirm the post. It may or may not have gone out - check the Page before posting it again.';

export interface FacebookPublishInput {
  /** The Page access token. */
  accessToken: string;
  pageId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
  /** How long to wait for Facebook to answer. A video is fetched before it does. */
  timeoutMs?: number;
}

export interface FacebookPublishResult {
  state: 'published';
  postId: string;
  permalink: string | null;
}

interface MetaErrorBody {
  error?: {
    message?: string; type?: string; code?: number; error_subcode?: number;
    error_user_title?: string; error_user_msg?: string;
  };
}

/** Turn Meta's error into one of ours, with words an owner can act on. */
export function toFacebookPublishError(status: number, body: MetaErrorBody, fallback: string): FacebookPublishError {
  const e = body.error ?? {};
  const text = `${e.message ?? ''} ${e.error_user_msg ?? ''}`;
  const detail = [e.code != null ? `code ${e.code}` : '', e.error_subcode != null ? `subcode ${e.error_subcode}` : '', (e.message ?? '').slice(0, 160)]
    .filter(Boolean).join(', ');

  if (e.code === 190 || status === 401) {
    return new FacebookPublishError('token',
      'The Facebook connection has expired. Reconnect the Page on the Integrations page, then try again.', { detail });
  }
  // 10 and 200-299 are Meta's permission errors; 3 is "capability not granted".
  if (e.code === 10 || e.code === 3 || (e.code != null && e.code >= 200 && e.code <= 299) ||
      /permission|not authorized|pages_manage_posts/i.test(text)) {
    return new FacebookPublishError('permission', FACEBOOK_RECONNECT_MESSAGE, { detail });
  }
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.code === 368 || status === 429) {
    return new FacebookPublishError('rate_limited',
      'Facebook is not accepting more posts from this Page right now (its own limit was reached). Try again later.', { detail });
  }
  if (status >= 500) {
    // The request reached Facebook and it failed part-way: it cannot be said
    // from here whether the post was made.
    return new FacebookPublishError('unreachable', UNCONFIRMED, { uncertain: true, detail });
  }
  if (e.code === 324 || e.code === 1500 || e.code === 6000 || e.code === 6001 || /photo|image|video|file|url/i.test(text)) {
    const said = (e.error_user_msg || e.message || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return new FacebookPublishError('media',
      said ? `Facebook could not use this photo or video: ${said}` : 'Facebook could not use this photo or video.', { detail });
  }
  const said = (e.error_user_msg || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return new FacebookPublishError('rejected', said ? `Facebook rejected the post: ${said}` : fallback, { detail });
}

async function call(
  path: string,
  token: string,
  init: { method: 'GET' | 'POST'; params?: Record<string, string>; timeoutMs: number },
  fallback: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(init.params ?? {});
  const query = params.toString();
  const request: RequestInit = {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.method === 'POST' ? params : undefined,
    signal: AbortSignal.timeout(init.timeoutMs),
  };
  const target = init.method === 'GET' && query ? `/${path}?${query}` : `/${path}`;
  const res = await fetch(`${META_GRAPH_URL}${withAppSecretProof(target, request)}`, request);

  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok && body && typeof body === 'object' && !('error' in (body as object))) {
    return body as Record<string, unknown>;
  }
  throw toFacebookPublishError(res.status, (body ?? {}) as MetaErrorBody, fallback);
}

/** Facebook gives a video's link as a path; a post's as a full address. */
function absolute(link: unknown): string | null {
  if (typeof link !== 'string' || !link) return null;
  if (/^https:\/\//i.test(link)) return link;
  return link.startsWith('/') ? `https://www.facebook.com${link}` : null;
}

/** Publish one photo or video to a Page. Called once per post; never retried. */
export async function publishToFacebookPage(input: FacebookPublishInput): Promise<FacebookPublishResult> {
  if (!input.accessToken || !input.pageId) {
    throw new FacebookPublishError('not_connected', 'No Facebook Page is connected. Connect one on the Integrations page.');
  }
  if (!/^https:\/\//i.test(input.mediaUrl)) {
    throw new FacebookPublishError('media', 'The photo or video has no public address Facebook can fetch.');
  }

  const video = input.mediaType === 'video';
  const caption = input.caption.trim();
  const params: Record<string, string> = video
    ? { file_url: input.mediaUrl, ...(caption ? { description: caption } : {}) }
    : { url: input.mediaUrl, ...(caption ? { caption } : {}) };

  // From the moment this is sent, a failure to hear back is not a failure to post.
  let made: Record<string, unknown>;
  try {
    made = await call(
      `${encodeURIComponent(input.pageId)}/${video ? 'videos' : 'photos'}`,
      input.accessToken,
      { method: 'POST', params, timeoutMs: input.timeoutMs ?? (video ? 45_000 : 20_000) },
      'Facebook rejected the post.'
    );
  } catch (e) {
    if (e instanceof FacebookPublishError) throw e;
    throw new FacebookPublishError('unreachable', UNCONFIRMED, {
      uncertain: true, detail: e instanceof Error ? e.message.slice(0, 160) : undefined,
    });
  }

  // A photo answers with the post it became; a video with the video itself.
  const postId = made.post_id != null ? String(made.post_id) : made.id != null ? String(made.id) : '';
  if (!postId) throw new FacebookPublishError('unreachable', UNCONFIRMED, { uncertain: true });

  // The link is a courtesy. The post is out whether or not this answers.
  let permalink: string | null = null;
  try {
    const node = await call(postId, input.accessToken,
      { method: 'GET', params: { fields: 'permalink_url' }, timeoutMs: 10_000 }, '');
    permalink = absolute(node.permalink_url);
  } catch { /* published; just no link */ }

  return { state: 'published', postId, permalink };
}

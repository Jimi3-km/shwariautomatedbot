import type { NextFunction, Request, Response } from 'express';
import { logAuditEvent } from './audit.js';

/**
 * The activity log: every change a signed-in person makes in a business.
 *
 * Recorded once, here, rather than remembered route by route, so a new route
 * is logged without anyone thinking about it. A change made by a platform
 * admin working inside a business is marked as theirs, so the owner can see
 * exactly what the platform did.
 *
 * Reads are not recorded. Nor are the handful of routes that write their own,
 * more detailed entry.
 */

/** Routes that record themselves, or that are not worth a line. */
const SKIP: RegExp[] = [
  /^\/conversations\/[^/]+\/read$/,
  /^\/notifications\/read$/,
  /^\/payments\/[^/]+\/verify$/,
  /^\/team(\/|$)/,
  /^\/invitations\//,
  /^\/shwari\/chat$/,
  /^\/platform\//,
  /^\/admin\//,
];

/** What each change is, in words. Keyed by method and route pattern. */
const SUMMARY: Record<string, string> = {
  'POST /conversations/:id/reply': 'Replied to a customer',
  'POST /conversations/:id/takeover': 'Changed who answers a conversation',
  'PATCH /leads/:id': 'Updated a lead',
  'POST /orders': 'Created an order',
  'PATCH /orders/:id': 'Updated an order',
  'POST /payments/:id/receipt': 'Sent a receipt',
  'POST /appointments': 'Created a booking',
  'PATCH /appointments/:id': 'Updated a booking',
  'POST /tickets': 'Opened a support ticket',
  'PATCH /tickets/:id': 'Updated a support ticket',
  'PATCH /follow-ups/:id': 'Updated a follow-up',
  'POST /products': 'Added a product',
  'PATCH /products/:id': 'Updated a product',
  'PUT /products/:id': 'Updated a product',
  'DELETE /products/:id': 'Removed a product',
  'POST /services': 'Added a service',
  'PATCH /services/:id': 'Updated a service',
  'PUT /services/:id': 'Updated a service',
  'DELETE /services/:id': 'Removed a service',
  'PUT /agent': 'Changed the agent settings',
  'PATCH /agent': 'Changed the agent settings',
  'PUT /business': 'Changed the business details',
  'PATCH /business': 'Changed the business details',
  'PUT /agents/:role': 'Changed an agent',
  'PATCH /agents/:role': 'Changed an agent',
  'POST /channels/telegram': 'Connected Telegram',
  'POST /channels/:provider/connect': 'Started connecting a channel',
  'POST /channels/:provider/credentials': 'Connected a channel',
  'POST /channels/facebook/select-page': 'Chose a Facebook Page',
  'DELETE /channels/:id': 'Disconnected a channel',
  'POST /shwari/pairing-code': 'Created a code to link Shwari on chat',
  'DELETE /shwari/linked/:id': 'Unlinked a chat account from Shwari',
  'POST /content': 'Added to the content library',
  'PATCH /content/:id': 'Updated a library item',
  'DELETE /content/:id': 'Removed a library item',
  'POST /posts': 'Scheduled a post',
  'POST /posts/plan-week': 'Planned the week of posts',
  'POST /posts/approve': 'Approved posts',
  'PATCH /posts/:id': 'Changed a post',
  'DELETE /posts/:id': 'Removed a post',
  'POST /posts/:id/publish-now': 'Published a post',
  'PUT /posting-settings': 'Changed the posting settings',
  'PATCH /posting-settings': 'Changed the posting settings',
  'POST /onboarding/complete': 'Finished setting up the business',
};

export function recordActivity(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  res.on('finish', () => {
    const ctx = req.ctx;
    if (!ctx || res.statusCode >= 400) return;
    const pattern = typeof req.route?.path === 'string' ? req.route.path : req.path;
    if (SKIP.some((r) => r.test(req.path))) return;

    const key = `${req.method} ${pattern}`;
    const resource = pattern.split('/').filter(Boolean)[0] ?? 'unknown';
    void logAuditEvent({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorType: ctx.supportMode ? 'platform_admin' : 'user',
      actorLabel: ctx.email,
      action: `${resource}.${req.method.toLowerCase()}`,
      resourceType: resource,
      resourceId: typeof req.params?.id === 'string' ? req.params.id : null,
      details: { summary: SUMMARY[key] ?? `Made a change (${key})`, route: key },
      ipAddress: req.ip ?? null,
    });
  });
  next();
}

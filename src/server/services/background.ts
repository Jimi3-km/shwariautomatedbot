/**
 * Work that continues after the HTTP response has been sent.
 *
 * Webhooks must be acknowledged quickly, but the AI turn they trigger takes
 * seconds. On a long-lived Node process a floating promise is enough. On Vercel
 * it is not: the function is frozen as soon as the response is flushed, and a
 * floating promise is simply abandoned mid-flight — the customer's message is
 * recorded and never answered.
 *
 * Vercel exposes `waitUntil` on its request context, which keeps the function
 * alive (up to maxDuration) until the promise settles. It is read from the
 * documented global symbol rather than from `@vercel/functions`, so there is no
 * extra dependency and the same code runs unchanged under `tsx server.ts`.
 */

type WaitUntil = (promise: Promise<unknown>) => void;

function vercelWaitUntil(): WaitUntil | null {
  try {
    const ctx = (globalThis as Record<symbol, any>)[Symbol.for('@vercel/request-context')];
    const waitUntil = ctx?.get?.()?.waitUntil;
    return typeof waitUntil === 'function' ? (waitUntil as WaitUntil) : null;
  } catch {
    return null;
  }
}

/**
 * Run `task` to completion without holding the response open.
 *
 * Never rejects and never throws: a failure is logged under `label`. The
 * returned promise resolves when the task has settled, which tests can await.
 */
export function runInBackground(label: string, task: () => Promise<unknown>): Promise<void> {
  const settled = (async () => {
    try {
      await task();
    } catch (e) {
      console.error(`[${label}] background work failed:`, e instanceof Error ? e.message : e);
    }
  })();

  const waitUntil = vercelWaitUntil();
  if (waitUntil) {
    try {
      waitUntil(settled);
    } catch {
      /* outside a request scope; the floating promise is all we have */
    }
  }
  return settled;
}

/** Rejects after `ms`. Used to stop a task before the platform kills it silently. */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

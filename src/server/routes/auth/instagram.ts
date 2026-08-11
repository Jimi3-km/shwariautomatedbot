import { Router } from 'express';
import { serviceClient } from '../../supabase.js';
import { handler } from '../../auth.js';
import {
  instagramOAuthConfigured,
  notConfigured,
  metaConfig,
} from '../../config/meta.js';
import {
  buildAuthorizeUrl,
  createState,
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
  InstagramOAuthError,
} from '../../services/meta/instagram.js';

export const instagramAuthRouter = Router();

/**
 * Instagram sign-in.
 *
 * The Instagram identity is linked to a real Supabase Auth user rather than
 * used to mint our own JWT. Every RLS policy in this project resolves tenancy
 * through auth.uid(); a self-issued JWT would satisfy our middleware while
 * silently disabling database-level isolation. So the callback ends by handing
 * the browser a genuine Supabase session.
 */

/** Where to bounce the browser when the flow ends. */
function appOrigin(req: import('express').Request): string {
  if (metaConfig.instagram.redirectUri) {
    try { return new URL(metaConfig.instagram.redirectUri).origin; } catch { /* fall through */ }
  }
  return `${req.protocol}://${req.get('host')}`;
}

function failRedirect(req: import('express').Request, reason: string): string {
  return `${appOrigin(req)}/?auth_error=${encodeURIComponent(reason)}`;
}

// ---------------------------------------------------------------------------
// GET /api/auth/instagram  → redirect to Meta's consent screen
// ---------------------------------------------------------------------------
instagramAuthRouter.get(
  '/auth/instagram',
  handler(async (req, res) => {
    const cfg = instagramOAuthConfigured();
    if (!cfg.configured) {
      console.warn('[auth/instagram] start blocked, missing:', cfg.missing.join(', '));
      return res.status(503).json(notConfigured('Instagram sign-in', cfg));
    }

    const state = createState();
    const url = buildAuthorizeUrl(state);
    console.log('[auth/instagram] redirecting to Meta consent screen');
    // State is carried in the URL and verified by HMAC on return, so no
    // server-side session store is required.
    res.redirect(302, url);
  })
);

// ---------------------------------------------------------------------------
// GET /api/auth/instagram/callback
// ---------------------------------------------------------------------------
instagramAuthRouter.get(
  '/auth/instagram/callback',
  handler(async (req, res) => {
    const cfg = instagramOAuthConfigured();
    if (!cfg.configured) {
      return res.status(503).json(notConfigured('Instagram sign-in', cfg));
    }

    const { code, state, error, error_reason: errorReason } = req.query as Record<string, string>;

    // 1. User denied consent, or Meta returned an error.
    if (error) {
      console.log(`[auth/instagram] user denied or Meta error: ${error} (${errorReason ?? 'no reason'})`);
      const reason = error === 'access_denied' ? 'instagram_cancelled' : 'instagram_error';
      return res.redirect(302, failRedirect(req, reason));
    }

    // 2. CSRF check before any token exchange.
    if (!state || !verifyState(state)) {
      console.warn('[auth/instagram] state verification failed — possible CSRF or expired link');
      return res.redirect(302, failRedirect(req, 'instagram_state_invalid'));
    }

    if (!code) {
      return res.redirect(302, failRedirect(req, 'instagram_no_code'));
    }

    try {
      // 3. Code → short-lived token → long-lived token.
      const shortLived = await exchangeCodeForToken(code);
      const longLived = await exchangeForLongLivedToken(shortLived.accessToken);

      // 4. Who is this?
      const profile = await fetchProfile(longLived.accessToken);
      console.log(`[auth/instagram] authenticated instagram user ${profile.id} (@${profile.username})`);

      // 5. Find an existing link, or create the Supabase Auth user.
      const userId = await linkOrCreateUser(profile.id, profile.username, profile.profilePictureUrl);

      // 6. Hand the browser a REAL Supabase session via a one-time magic link.
      //    We never fabricate a JWT: auth.uid() must stay authoritative.
      const email = `instagram_${profile.id}@users.noreply.local`;
      const { data: link, error: linkErr } = await serviceClient.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });

      if (linkErr || !link?.properties?.hashed_token) {
        console.error('[auth/instagram] could not mint a session:', linkErr?.message);
        return res.redirect(302, failRedirect(req, 'instagram_session_failed'));
      }

      // The SPA calls supabase.auth.verifyOtp() with this token to establish
      // the session client-side. The token is single-use and short-lived.
      const target = new URL(`${appOrigin(req)}/`);
      target.searchParams.set('ig_token', link.properties.hashed_token);
      target.searchParams.set('ig_email', email);
      console.log(`[auth/instagram] linked instagram ${profile.id} to auth user ${userId}`);
      return res.redirect(302, target.toString());
    } catch (err) {
      if (err instanceof InstagramOAuthError) {
        console.error(`[auth/instagram] Meta error (${err.metaCode ?? 'n/a'}): ${err.message}`);
        return res.redirect(302, failRedirect(req, 'instagram_exchange_failed'));
      }
      console.error('[auth/instagram] unexpected failure:', err);
      return res.redirect(302, failRedirect(req, 'instagram_unexpected'));
    }
  })
);

/**
 * Resolve an Instagram identity to a Supabase Auth user.
 *
 * A duplicate Instagram id links back to the same account rather than creating
 * a second one — user_profiles.instagram_id is UNIQUE, so this is enforced by
 * the database as well as by this lookup.
 */
async function linkOrCreateUser(
  instagramId: string,
  username: string,
  pictureUrl?: string
): Promise<string> {
  const { data: existing } = await serviceClient
    .from('user_profiles')
    .select('user_id')
    .eq('instagram_id', instagramId)
    .maybeSingle();

  if (existing?.user_id) {
    await serviceClient
      .from('user_profiles')
      .update({ instagram_username: username, profile_picture: pictureUrl ?? null })
      .eq('user_id', existing.user_id);
    return existing.user_id;
  }

  const email = `instagram_${instagramId}@users.noreply.local`;
  const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provider: 'instagram', instagram_id: instagramId, instagram_username: username },
  });

  let userId = created?.user?.id;

  // createUser fails if the address already exists (e.g. a retried callback);
  // fall back to locating that user instead of erroring out.
  if (!userId) {
    if (createErr) console.warn('[auth/instagram] createUser fallback:', createErr.message);
    const { data: list } = await serviceClient.auth.admin.listUsers();
    const users = (list?.users ?? []) as Array<{ id: string; email?: string | null }>;
    userId = users.find((u) => u.email === email)?.id;
  }
  if (!userId) throw new Error('Could not create or locate the Supabase user');

  const { error: profileErr } = await serviceClient.from('user_profiles').upsert(
    {
      user_id: userId,
      instagram_id: instagramId,
      instagram_username: username,
      profile_picture: pictureUrl ?? null,
      provider: 'instagram',
    },
    { onConflict: 'user_id' }
  );
  if (profileErr) {
    console.error('[auth/instagram] profile upsert failed:', profileErr.message);
    throw new Error('Could not save the Instagram profile');
  }

  return userId;
}

/** Lets the login screen show the button only when the server can honour it. */
instagramAuthRouter.get(
  '/auth/instagram/available',
  handler(async (_req, res) => {
    const cfg = instagramOAuthConfigured();
    res.json({ available: cfg.configured, missing: cfg.configured ? [] : cfg.missing });
  })
);

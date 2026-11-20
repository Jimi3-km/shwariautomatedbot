# Deployment setup

Everything an operator has to configure, in the order it becomes necessary.

You can run the product with **step 1 only**. Web chat needs no third party, so
a business can sign up, onboard and hold real conversations before any Meta
credential exists. Steps 3 and 4 add WhatsApp and Instagram.

At any point, sign in as an admin and call `GET /api/setup/status` to see what
is still missing. It names the exact variables and never prints a value.

> **Getting the Meta values:** see **[META_CREDENTIALS.md](./META_CREDENTIALS.md)**
> for a click-by-click walkthrough against the `builtwithai dm agent` app
> (App ID `1561926828265582`). This page is the reference; that one is the
> procedure.

---

## 1. Core (required)

In `.env`:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | same page, the publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the service_role key. **Server only.** |
| `PUBLIC_API_URL` | The public origin of this API, e.g. `https://app.example.com`. Used to build the web chat snippet and the URLs you register with Meta. |

That is enough to deploy, sign up, onboard and use web chat.

---

## 2. The AI agent (required for any AI reply)

Without these, messages still arrive and appear in the Inbox — they just get no
automated reply.

| Variable | Value |
|---|---|
| `SHWARI_API_KEY` | An NVIDIA API key from [build.nvidia.com](https://build.nvidia.com). Powers every agent — see [SHWARI_AGENT.md](SHWARI_AGENT.md). |
| `SHWARI_MODEL` | Optional. Defaults to `nvidia/nemotron-3-ultra-550b-a55b`. `SHWARI_FAST_MODEL` and `SHWARI_FALLBACK_MODEL` are optional overrides for the fast and fallback profiles. |
| `INTERNAL_API_SECRET` | Invent one: `openssl rand -hex 32`. Authenticates the scheduled jobs that call `/api/internal/*`. |

There is no n8n step any more. Every channel delivers to this API
(`<PUBLIC_API_URL>/api/webhooks/...`) and the native agent replies. The old
`N8N_AGENT_WEBHOOK_URL`, `N8N_META_WEBHOOK_URL` and `N8N_TELEGRAM_WEBHOOK_URL`
variables are not read and can be removed. A Telegram bot that was connected
while n8n was in use still points its webhook there: reconnect it from
Integrations.

---

## 3. WhatsApp

### In the Meta dashboard

Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
your app (create a **Business** type app if you have none), then add the
**WhatsApp** product.

| Variable | Where to find it |
|---|---|
| `META_APP_ID` | App settings → Basic → **App ID** |
| `META_APP_SECRET` | App settings → Basic → **App secret** (click *Show*) |
| `META_WHATSAPP_CONFIG_ID` | WhatsApp → Embedded Signup → your **configuration ID** |

### Values you invent, then register

| Variable | Value | Also paste into Meta at |
|---|---|---|
| `META_VERIFY_TOKEN` | Any random string | WhatsApp → Configuration → Webhook → **Verify token** |
| `META_WHATSAPP_REDIRECT_URI` | `https://<PUBLIC_API_URL>/api/channels/oauth/whatsapp/callback` | App settings → Basic → **Valid OAuth Redirect URIs** |
| `META_TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` | *(nowhere — ours alone)* |

### Webhook

WhatsApp → Configuration → Webhook:

- **Callback URL** → `https://<PUBLIC_API_URL>/api/webhooks/meta`
- **Verify token** → your `META_VERIFY_TOKEN`
- Subscribe to the **`messages`** field

Click *Verify and save*. Meta calls the callback immediately; if it fails,
`META_VERIFY_TOKEN` does not match, or the URL is not publicly reachable.

---

## 4. Instagram

Add the **Instagram** product to the same app and use *Instagram Login for
Business*.

> The Instagram credentials are **not** the App ID and App Secret from the Basic
> page. Meta issues a separate pair under the Instagram product. Using the wrong
> pair is the usual cause of a silent `invalid_client`.

| Variable | Where to find it |
|---|---|
| `INSTAGRAM_CLIENT_ID` | Instagram → API setup with Instagram login → **Instagram app ID** |
| `INSTAGRAM_CLIENT_SECRET` | same panel → **Instagram app secret** |

| Variable | Value | Also paste into Meta at |
|---|---|---|
| `INSTAGRAM_CONNECT_REDIRECT_URI` | `https://<PUBLIC_API_URL>/api/channels/oauth/instagram/callback` | Instagram → **OAuth redirect URIs** |
| `INSTAGRAM_REDIRECT_URI` | `https://<PUBLIC_API_URL>/api/auth/instagram/callback` | same list — **optional**, only for "Sign in with Instagram" |

Instagram also uses `META_APP_SECRET` and `META_VERIFY_TOKEN` from step 3,
because inbound DMs arrive on the same signed webhook. Subscribe the Instagram
product to the **`messages`** field against the same callback URL.

The business's Instagram account must be a **Professional** (Business or
Creator) account, and must have messaging access enabled.

---

## 4b. Facebook Page

Messenger messages to a business's Facebook Page, and publishing approved
posts to it. Uses the same Meta app, app secret, verify token and encryption
key as steps 3 and 4. The full walk-through is in `docs/FACEBOOK.md`.

| Variable | Where to find it |
|---|---|
| `META_FACEBOOK_CONFIG_ID` | Facebook Login for Business -> Configurations -> the **configuration ID** of a configuration that grants `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `pages_manage_engagement` and `pages_manage_posts`. Not the WhatsApp configuration. |

| Variable | Value | Also paste into Meta at |
|---|---|---|
| `META_FACEBOOK_REDIRECT_URI` | `https://<PUBLIC_API_URL>/api/channels/oauth/facebook/callback` - **optional**, this is the default | Facebook Login for Business -> Settings -> **Valid OAuth Redirect URIs** |

Webhooks -> **Page**: the same callback URL (`https://<PUBLIC_API_URL>/api/webhooks/meta`)
and the same verify token as above, subscribed to the **`messages`** field
(and `messaging_postbacks`, `feed`).

Only a **Page** can be connected, never a personal profile. Apply migration
`20261120_0025_facebook_pages.sql` before connecting one.

---

## 4a. Verified against Meta's live docs

Checked via the Meta Developer Tools MCP, so these are current rather than
remembered:

- **Instagram uses three hosts.** `www.instagram.com/oauth/authorize` for the
  consent window, `api.instagram.com/oauth/access_token` for the code
  exchange, `graph.instagram.com` for long-lived tokens and data. Using the API
  host for the authorize step silently fails.
- **The Instagram token response is nested**: `{ data: [{ access_token,
  user_id, permissions }] }`, not a flat object. The flat shape is the older
  Basic Display API.
- **Scopes are `instagram_business_*`.** The old `business_basic` style values
  were deprecated on 27 January 2025.
- **Instagram Login for Business needs no linked Facebook Page.**
- **WhatsApp Embedded Signup v4 documents the JavaScript SDK** as the entry
  point, not a plain redirect. See the note in
  `src/server/services/meta/whatsapp.ts` — the server-side half (code
  exchange, WABA discovery via `debug_token`, phone number lookup, app
  subscription) matches the docs and is unaffected.
- **Embedded Signup v2 is deprecated on 15 October 2026**; v4 is current.
- **The Embedded Signup exchangeable code lives 30 seconds.**
- **Graph API version is pinned to v25.0**, matching current documentation.
- WhatsApp Embedded Signup additionally expects you to subscribe to the
  `account_update` webhook, and to be a Solution Partner or Tech Provider.

## 5. App Review

Before Meta approves your app, only users you add as testers can complete the
WhatsApp and Instagram flows. Request:

- `whatsapp_business_management`
- `whatsapp_business_messaging`
- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_content_publish` (publishing posts from the Marketing
  calendar; see `docs/MARKETING.md`)
- `pages_show_list`, `pages_manage_metadata`, `pages_messaging`,
  `pages_read_engagement`, `pages_manage_engagement`, `pages_manage_posts`
  (connecting a Facebook Page; see `docs/FACEBOOK.md`)

Web chat and Telegram are unaffected and work for real customers throughout.

---

## Quick reference: what is generated, not obtained

Never ask Meta for these — the system creates them:

- the per-channel pipeline secret (`channels.secret_token`)
- the web chat **site key** (public) and visitor session tokens
- OAuth `state` values
- the WhatsApp **WABA id**, **phone number id** and business access token
- the Instagram **user id** and long-lived token
- the Facebook **Page id** and Page access token

All are discovered or minted during the connect flow and stored per tenant,
encrypted where they are credentials. None of them belongs in `.env`.

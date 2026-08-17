# Deployment setup

Everything an operator has to configure, in the order it becomes necessary.

You can run the product with **step 1 only**. Web chat needs no third party, so
a business can sign up, onboard and hold real conversations before any Meta
credential exists. Steps 3 and 4 add WhatsApp and Instagram.

At any point, sign in as an admin and call `GET /api/setup/status` to see what
is still missing. It names the exact variables and never prints a value.

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

## 2. The AI pipeline (required for any AI reply)

Without these, messages still arrive and appear in the Inbox — they just get no
automated reply.

| Variable | Value |
|---|---|
| `N8N_AGENT_WEBHOOK_URL` | The production URL of the **Meta Inbound** webhook node in n8n, e.g. `https://<you>.app.n8n.cloud/webhook/meta-in`. Used by WhatsApp, Instagram **and web chat**. |
| `N8N_TELEGRAM_WEBHOOK_URL` | The production URL of the **Telegram Inbound** node, e.g. `.../webhook/telegram-in`. |
| `INTERNAL_API_SECRET` | Invent one: `openssl rand -hex 32`. Lets n8n send replies back through this API. |

`N8N_META_WEBHOOK_URL` is still accepted as the old name for
`N8N_AGENT_WEBHOOK_URL`, so an existing deployment keeps working.

### In n8n, once

Open the workflow and edit the **Send Reply (Channel API)** node:

- **URL** → `https://<your PUBLIC_API_URL>/api/internal/send`
- **Header** `x-internal-secret` → the same value as `INTERNAL_API_SECRET`

Until you do this, WhatsApp, Instagram and web chat store messages but never
reply. Telegram is unaffected — it keeps its own original send node.

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

## 5. App Review

Before Meta approves your app, only users you add as testers can complete the
WhatsApp and Instagram flows. Request:

- `whatsapp_business_management`
- `whatsapp_business_messaging`
- `instagram_business_basic`
- `instagram_business_manage_messages`

Web chat and Telegram are unaffected and work for real customers throughout.

---

## Quick reference: what is generated, not obtained

Never ask Meta for these — the system creates them:

- the per-channel pipeline secret (`channels.secret_token`)
- the web chat **site key** (public) and visitor session tokens
- OAuth `state` values
- the WhatsApp **WABA id**, **phone number id** and business access token
- the Instagram **user id** and long-lived token

All are discovered or minted during the connect flow and stored per tenant,
encrypted where they are credentials. None of them belongs in `.env`.

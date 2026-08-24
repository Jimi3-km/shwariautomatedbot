# Getting the Meta credentials — step by step

For the app **builtwithai dm agent**, App ID **`1561926828265582`**
(Tech Provider verified, use cases already configured).

Everything below is either copied out of the dashboard, invented by you, or
generated on your machine. Nothing here is discovered automatically — the
values the *system* discovers (WABA id, phone number id, access tokens) are
listed at the end so you don't go hunting for them.

Work top to bottom. Step 0 has to come first because four later values contain
your public URL.

---

## Step 0 — Deploy, and settle on your public URL

Meta will not accept a webhook it cannot reach, and every redirect URI has to
match the deployed origin exactly.

```bash
PUBLIC_API_URL=https://shwariautomatedbot.vercel.app    # no trailing slash
```

Everything below writes `<PUBLIC_API_URL>` where that value goes.

Sanity check before continuing — this must answer from the public internet,
not just your laptop:

```bash
curl -i "$PUBLIC_API_URL/api/health"          # expect 200 {"ok":true}
```

---

## Step 1 — `META_APP_ID`

Already known. No lookup needed.

```bash
META_APP_ID=1561926828265582
```

---

## Step 2 — `META_APP_SECRET`

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
   **builtwithai dm agent**
2. Left sidebar → **App settings** → **Basic**
3. **App secret** → click **Show** → re-enter your Facebook password
4. Copy it

```bash
META_APP_SECRET=<paste>
```

This one value does three jobs: the WhatsApp token exchange, the `debug_token`
call that finds the customer's WABA, and — most importantly — verifying the
`x-hub-signature-256` on **every inbound webhook, Instagram included**. Get it
wrong and messages are silently rejected with a 401.

Treat it like a database password. Server-side only, never in the frontend.

---

## Step 3 — `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET`

> These are **not** the App ID and App Secret from step 1 and 2. Meta issues a
> separate pair under the Instagram product. Using the step-1/2 pair here is
> the single most common cause of a silent `invalid_client`.

1. Left sidebar → **Instagram** → **API setup with Instagram login**
2. Scroll to **3. Set up Instagram business login**
3. Open **Business login settings**
4. Copy **Instagram App ID** → `INSTAGRAM_CLIENT_ID`
5. Copy **Instagram app secret** (click Show) → `INSTAGRAM_CLIENT_SECRET`

```bash
INSTAGRAM_CLIENT_ID=<paste>
INSTAGRAM_CLIENT_SECRET=<paste>
```

While you are on that panel, add the redirect URIs from step 6 — the field is
right there under **OAuth redirect URIs**.

---

## Step 4 — `META_WHATSAPP_CONFIG_ID`

The WhatsApp Embedded Signup configuration lives under Facebook Login for
Business, not under the WhatsApp product.

1. Left sidebar → **Facebook Login for Business** → **Configurations**
2. **Create from template** → choose
   **WhatsApp Embedded Signup Configuration With 60 Expiration Token**
   (or **Create configuration** → login variation **WhatsApp Embedded Signup**)
3. Products to onboard → tick **WhatsApp Cloud API**
4. Assets → keep **WhatsApp accounts**. Untick anything you do not need —
   every extra asset is another screen your customers can abandon on
5. Finish, then copy the **configuration ID**

Already created for this app:

```bash
META_WHATSAPP_CONFIG_ID=1089974970383116
```

### Also, once, on the same product

**Facebook Login for Business → Settings → Client OAuth settings** — set all of
these to **Yes**:

- Client OAuth login
- Web OAuth login
- Enforce HTTPS
- Embedded Browser OAuth Login
- Use Strict Mode for redirect URIs

And add your domain to **Allowed domains** and **Valid OAuth redirect URIs**.
Embedded Signup returns the WABA and phone number ids to the spawning window
only if the domain is listed in both.

---

## Step 5 — Values you invent

Nothing to look up; generate and keep them.

```bash
# Any random string. You will paste this into Meta in step 7.
META_VERIFY_TOKEN=$(openssl rand -hex 16)

# Encrypts stored Meta tokens at rest (AES-256-GCM). Ours alone — Meta never sees it.
META_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Lets n8n send replies back through this API. Ours alone.
INTERNAL_API_SECRET=$(openssl rand -hex 32)
```

Losing `META_TOKEN_ENCRYPTION_KEY` makes every stored token undecryptable and
every connected customer has to reconnect. Back it up wherever you keep
production secrets.

---

## Step 6 — Redirect URIs

Three URIs, all derived from step 0.

```bash
META_WHATSAPP_REDIRECT_URI=<PUBLIC_API_URL>/api/channels/oauth/whatsapp/callback
INSTAGRAM_CONNECT_REDIRECT_URI=<PUBLIC_API_URL>/api/channels/oauth/instagram/callback
INSTAGRAM_REDIRECT_URI=<PUBLIC_API_URL>/api/auth/instagram/callback
```

Register them in the dashboard:

| URI | Where to paste it |
|---|---|
| WhatsApp callback | Facebook Login for Business → Settings → **Valid OAuth redirect URIs** |
| Instagram connect callback | Instagram → API setup with Instagram login → Business login settings → **OAuth redirect URIs** |
| Instagram sign-in callback | same Instagram field. Optional — only for "Sign in with Instagram" on the login screen |

They must match character for character, including `https://` and no trailing
slash. Meta rejects the token exchange if the URI differs by a single
character from the one used to start the flow.

---

## Step 7 — The webhook

One callback serves both WhatsApp and Instagram.

For **each** product (WhatsApp → Configuration → Webhook, and Instagram →
Webhooks):

- **Callback URL** → `<PUBLIC_API_URL>/api/webhooks/meta`
- **Verify token** → your `META_VERIFY_TOKEN` from step 5
- **Subscribe to** → the **`messages`** field

Click **Verify and save**. Meta calls the URL immediately with a challenge. If
it fails, it is one of exactly three things: the verify token does not match,
the URL is not publicly reachable, or the app is not running.

For WhatsApp also subscribe to **`account_update`** — it fires when a customer
finishes Embedded Signup and carries the business info.

---

## Step 8 — Check your work

Restart the API, sign in as an admin, and open **Integrations**. The setup
panel disappears when everything is configured. Or hit it directly:

```bash
curl -s "$PUBLIC_API_URL/api/setup/status" \
  -H "authorization: Bearer <your dashboard JWT>" | jq
```

`all_ready: true` and empty `missing_environment_variables` everywhere means
WhatsApp and Instagram will now appear as connectable in onboarding.

---

## The complete `.env` block

```bash
PUBLIC_API_URL=https://shwariautomatedbot.vercel.app

META_APP_ID=1561926828265582
META_APP_SECRET=
META_VERIFY_TOKEN=
META_TOKEN_ENCRYPTION_KEY=

META_WHATSAPP_CONFIG_ID=1089974970383116
META_WHATSAPP_REDIRECT_URI=https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback

INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_CONNECT_REDIRECT_URI=https://shwariautomatedbot.vercel.app/api/channels/oauth/instagram/callback
INSTAGRAM_REDIRECT_URI=https://shwariautomatedbot.vercel.app/api/auth/instagram/callback

INTERNAL_API_SECRET=
N8N_AGENT_WEBHOOK_URL=https://<you>.app.n8n.cloud/webhook/meta-in

# Not a Meta credential. Powers the Shwari agent — see SHWARI_AGENT.md.
SHWARI_API_KEY=
```

---

## What you will *not* find in the dashboard

These are discovered per customer during the connect flow and stored encrypted.
If you go looking for them you will waste an afternoon:

- the customer's **WABA id** — read from `debug_token` granular scopes
- the customer's **phone number id** — read from `/{waba}/phone_numbers`
- the customer's **access token** — from the code exchange
- the customer's **Instagram user id** and long-lived token
- the per-channel **pipeline secret** and web chat **site key** — minted by us

---

## The one thing you must still add in the dashboard

The Embedded Signup URL Meta generated for you returns to the **app root**:

    redirect_uri=https://shwariautomatedbot.vercel.app/

The code sends users to the same entry point but returns to the **callback**:

    https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback

That is deliberate. The callback is what carries the signed `state` back, and
the state is what tells the server which tenant is connecting. Returning to the
root would leave a code with no way to attribute it to a business — the server
refuses that rather than guessing.

So add the callback URL to **Facebook Login for Business → Settings → Valid
OAuth redirect URIs**, and `shwariautomatedbot.vercel.app` to **Allowed
domains**. Strict Mode requires an exact match, so paste it character for
character, with no trailing slash.

---

## Note on what the API reported

When I inspected the app I saw no OAuth redirect URIs and no webhook
subscriptions on the legacy settings endpoint. On a use-case-configured app
that endpoint does not reflect per-use-case configuration, so this is expected
rather than contradictory — but steps 6 and 7 are still worth confirming
rather than assuming.

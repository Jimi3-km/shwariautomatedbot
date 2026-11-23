# Connect a Facebook Page

A business connects its Facebook **Page** on the Integrations page. Once
connected:

- **Messenger messages to the Page reach the Inbox** and are answered by the
  same team (Sales, Bookings, Orders & Payments, Support) as every other
  channel. Receipts and product photos are sent as pictures.
- **Approved posts are published to the Page** from the Marketing calendar,
  alongside or instead of Instagram.

Comments on the Page's posts are not handled yet (that is Phase 2 of
marketing). They arrive on the webhook and are ignored.

## What "connect Facebook" means

Meta lets an app act on a **Page**, never on a personal profile. So connecting
is two steps:

1. The owner signs in with Facebook (Facebook Login for Business) as someone
   who manages the Page, and ticks the Page when Facebook asks which Pages to
   share.
2. They say which Page this business uses. If they shared exactly one, that is
   the answer and it is connected at once. If they shared several, the app
   shows a picker and connects nothing until they choose. If they shared none,
   it says so and connects nothing.

One Page belongs to one business, and one business has one Page. Connecting a
different Page later switches the earlier one off.

## Setting it up (once, by whoever runs the Meta app)

This uses the same Meta app as WhatsApp and Instagram. `META_APP_ID`,
`META_APP_SECRET`, `META_VERIFY_TOKEN` and `META_TOKEN_ENCRYPTION_KEY` are
reused; see `docs/SETUP.md` for those.

### 1. Create a Facebook Login for Business configuration

Meta dashboard > your app > **Facebook Login for Business** > **Configurations**
> **Create configuration**.

- Access token type: **User access token**.
- Assets: **Pages**.
- Permissions - all six:

  | Permission | Why |
  |---|---|
  | `pages_show_list` | to see which Pages the person manages |
  | `pages_manage_metadata` | to subscribe the Page to this app's webhook |
  | `pages_messaging` | to receive and answer Messenger messages |
  | `pages_read_engagement` | to read the Page and its posts |
  | `pages_manage_engagement` | for replying to comments (Phase 2) |
  | `pages_manage_posts` | to publish approved posts |

Save it and copy its **Configuration ID**. This is a different configuration
from the WhatsApp Embedded Signup one; do not reuse that id.

### 2. Set the environment variables

In Vercel (Project > Settings > Environment Variables), then redeploy:

| Variable | Value |
|---|---|
| `META_FACEBOOK_CONFIG_ID` | the Configuration ID from step 1 |
| `META_FACEBOOK_REDIRECT_URI` | optional. Defaults to `https://<site>/api/channels/oauth/facebook/callback`, worked out from `PUBLIC_API_URL`. Set it only if the default is wrong. |

### 3. Register the redirect URI

Facebook Login for Business > **Settings** > **Valid OAuth Redirect URIs**, add
exactly:

```
https://<site>/api/channels/oauth/facebook/callback
```

`https`, no trailing slash, and the same domain as `PUBLIC_API_URL`. The
domain must also be listed under App settings > Basic > **App domains**.

### 4. Add the Page webhook

Meta dashboard > **Webhooks** > choose **Page** from the list (the same thing
is offered under Messenger > Messenger API settings > Configure webhooks).

- **Callback URL**: `https://<site>/api/webhooks/meta` - the same one as
  Instagram and WhatsApp.
- **Verify token**: the same value as `META_VERIFY_TOKEN`.
- Subscribe to the **`messages`** field. Also tick `messaging_postbacks` and
  `feed`; the app asks for all three when it subscribes a Page.

Each Page is subscribed to the app automatically when it is connected. This
step only tells Meta where to send what those Pages receive.

### 5. Apply the database update

Apply `supabase/migrations/20261120_0025_facebook_pages.sql`. Until it is
applied, connecting a Page stops with "the database needs its latest update"
and nothing is connected.

### 6. Check it

Integrations > "Instagram, WhatsApp or Facebook won't connect?" > **Run check**
(admins only) lists a *Facebook Page* section: the configuration id is set, the redirect address matches this site,
and a `page` webhook pointing here is subscribed to `messages`.

## Connecting, as the owner

Integrations > **Facebook Page** > **Connect** > sign in to Facebook > tick the
Page > Continue. If you manage several Pages you are asked which one this
business uses. The card then shows the Page's name.

On a phone the sign-in opens in the browser, not the Facebook app. If the app
opens instead, go back, press and hold **Continue**, and choose "Open in
browser".

## Posting to the Page

On Marketing > Library each item says where it may be posted: Instagram,
Facebook, or both. An item is only ever posted where it is ticked. Items
uploaded before a Page was connected are Instagram-only until you tick
Facebook on them.

When a week is planned, a post is proposed for each connected platform the
item allows. An item ticked for both goes out on both at the same posting
time, as two posts on the calendar that you approve like any others. That
counts as one use of the item against its reuse limit.

Nothing is published that was not approved, and each post is published once: a
post that Facebook did not confirm is marked failed with "it may or may not
have gone out - check the Page", and is never tried again unless you reschedule
it.

## Limits

- **Pages only.** A personal profile, a group or a friend's timeline cannot be
  connected or posted to. This is Meta's rule.
- **The 24-hour window.** A Page may message a person only within 24 hours of
  that person's last message. Outside it the app does not send, and says why.
  Follow-ups on Facebook are therefore sent inside that window or not at all.
  A person who has never written to the Page cannot be messaged.
- **App Review.** Until the six permissions have been granted Advanced access
  in App Review and the app is Live, only people with a role on the Meta app
  (admin, developer, tester) can connect a Page. Anyone else gets an error
  from Facebook or comes back with no Page. Add them under App roles, or
  complete App Review.
- **Customer names.** Meta lets an app read the name of someone who has
  written to the Page, but withholds it for some people and regions. The
  conversation still arrives; it just has no name until they give one.
- **Photos and videos** must be at a public `https` address, which the
  library's uploads are. Very large videos can take Facebook longer to accept
  than a single run allows; such a post is marked failed with the "check the
  Page" note rather than posted twice.

## Disconnecting

Integrations > Facebook Page > **Disconnect**. The stored Page token is deleted
and the channel is switched off: no more Messenger messages are answered and
Facebook posts will fail until a Page is connected again. Conversation history
and the calendar are kept.

To remove the app's access on Facebook's side as well, the owner can open
Facebook > Settings > **Business integrations** and remove the app there.

## Where the token lives

The Page access token is stored encrypted (AES-256-GCM) in `meta_tokens`,
which only the server can read. It is never put in the `channels` row, a
response, a log line, or an address sent to the browser. The Pages offered in
the picker are kept encrypted in `facebook_page_choices` for at most 15
minutes; the browser is sent only their names and ids. The person's own
Facebook token is used once, to list their Pages, and is not kept.

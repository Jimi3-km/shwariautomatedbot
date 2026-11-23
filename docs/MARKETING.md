# Marketing: posting to Instagram

Phase 1 of the marketing agent. The business posts its own photos and videos
to Instagram on a calendar the owner approves. The agent posts; it does not
yet reply to comments or messages (that is Phase 2).

A connected Facebook Page is posted to as well: each library item says where
it may go (Instagram, Facebook or both), and a week is planned for every
platform that is connected. With no Page connected nothing here changes. See
`docs/FACEBOOK.md`.

## How it works

1. **Library** (`/marketing` > Library). The owner uploads a photo or video,
   writes a caption, says which product or service it is about, and approves
   it. Only *approved* library items can ever be put on the calendar. Nothing
   is generated or edited: media is the owner's own upload, stored in the
   public `post-media` storage bucket.
2. **Schedule** (`/marketing` > Schedule). The posting days and times, in the
   business's own timezone (three a week by default: Monday, Wednesday and
   Friday at 18:00), the approval mode, and a pause switch.
3. **Calendar** (`/marketing` > Calendar). Once a week the next seven days are
   laid out: one approved item per posting time, never the same item twice in
   a week, not the same product two posts running when there is anything else,
   and never past an item's reuse limit. The owner gets a "posts to approve"
   notification. They approve the week, or edit, move, reject or approve posts
   one by one.
4. **Publishing.** The scheduler (`GET /api/internal/cron/dispatch`, every five
   minutes) publishes posts that are **approved** and whose time has come.
   The result - published with a link, or failed with the reason - shows on
   the calendar and in the bell.

Shwari can do all of it by chat ("what is going out this week", "approve the
week", "move Friday's post to Saturday at 10", "pause posting"), using the same
rules as the dashboard.

## The rules the code enforces

- **Only approved posts are published.** The publisher reads rows with status
  `approved` and nothing else. A week nobody approved publishes nothing.
- **Once.** A post is claimed by moving it from `approved` to `publishing` with
  a filter on its status, so two overlapping scheduler runs, or a run and a
  "Publish now" click, post it once. A post that failed is never retried on
  its own: a person reschedules it.
- **Honest failures.** If Instagram or Facebook does not confirm a publish, or
  a run is interrupted mid-publish, the post is marked failed with "it may or
  may not have gone out - check Instagram (or the Page) before posting it
  again". It is not sent again to find out.
- **Not late.** An approved post more than 24 hours past its time is marked
  "missed its time" instead of being published late. A proposed post whose
  time has passed cannot be approved; it has to be given a new time.
- **Grounded captions.** A caption that states a price must state a catalogue
  price (and, for an item linked to a product or service, that one's price). A
  caption that mentions a discount, a percentage off, "free", an offer or a
  sale needs a business fact that says so. Otherwise the post carries a
  "read before approving" reason. A person may still approve it; autopilot
  never does.
- **Daily ceiling.** At most 20 posts per business in any 24 hours, well under
  Instagram's own limit.

## Approval modes

Set under Schedule, or by asking Shwari. New businesses start on *approve the
week*.

| Mode | What happens |
|---|---|
| Approve the week (default) | The week is proposed; the owner approves it in one go ("Approve week") or post by post. Unapproved posts are not published. |
| Approve each post | The same, but every post needs its own approval; approving a whole week at once is refused. |
| Autopilot | Posts made from already-approved library items are approved automatically when they are laid out. A post whose caption fails the check is still held for a person. |

Whatever the mode, a caption Shwari writes or rewrites is a draft: an approved
post it re-captions goes back to "needs approval".

## The Meta permission

Publishing uses Meta's official Instagram API with Instagram Login for
Business (`graph.instagram.com`), the same connection used for messages. It
needs one more permission:

- **`instagram_business_content_publish`**

The app now asks for it when Instagram is connected. Two consequences:

- **Existing Instagram connections must be reconnected once.** A connection
  made before this change was never asked for the permission and cannot gain
  it afterwards. Go to Integrations, reconnect Instagram, and allow posting.
  Until then the Marketing page shows a banner, and an approved post fails
  with "Reconnect Instagram ... and allow posting".
- **App Review.** Until Meta approves `instagram_business_content_publish` for
  the app, publishing works only for Instagram accounts that have a role on
  the Meta app (admins, developers, testers). Everything else - the library,
  the calendar, approval - works for every business in the meantime.

## Limits

- **Professional accounts only.** Instagram accepts API publishing from
  Business and Creator accounts, not personal ones.
- **Public media URL.** Instagram fetches the photo or video from its address,
  so media is stored in a public bucket. Do not upload anything that should
  not be public.
- **Formats.** Photos: JPEG (Instagram's API documents JPEG as its only photo
  format; a PNG can be uploaded but may be refused when it is posted). Videos:
  MP4, published as reels. Carousels and stories are not built.
- **Upload size.** Photos up to 8 MB, videos up to 100 MB in the API. On
  Vercel the platform itself rejects a request body larger than about 4.5 MB
  before it reaches the API, so larger uploads (most videos) need either a
  host without that limit or direct-to-storage uploads, which are not built
  yet.
- **Videos take time.** Instagram processes a video before it can be
  published. If it is not ready within a run, the post waits and the next run
  resumes from the same upload; after six tries it is marked failed.
- **No native scheduling.** Instagram's API has none: the scheduler is the
  schedule. A post goes out within about five minutes of its time.
- **Daily cap.** 20 posts per business per 24 hours (ours); Instagram also has
  its own.

## How to pause

- Marketing > Schedule > **Pause posting**, or
- tell Shwari "pause posting".

While paused nothing is published, including posts already approved; they keep
their approval and stay on the calendar. Resume from the same place. A post
left more than a day past its time is marked missed rather than published
late. To stop a single post, reject or cancel it on the calendar.

## Setting it up

1. Apply migration `supabase/migrations/20261120_0024_marketing_posts.sql`. It
   creates `content_items`, `scheduled_posts`, `posting_settings`, the
   `post-media` bucket, and widens the notification kinds. Until it is applied
   the Marketing page is empty and nothing is published.
2. Reconnect Instagram on Integrations and allow posting.
3. Upload and approve a few items, then "Plan next 7 days" on the calendar.

## Where the code is

- Rules and publishing: `src/server/services/marketing.ts`
- Instagram calls: `src/server/services/meta/instagramPublish.ts`
- API: `src/server/routes/marketing.ts`
- Shwari's tools: `src/server/ai/tools/marketing.ts`
- Page: `src/pages/Marketing.tsx`
- Tests: `src/server/ai/__tests__/marketing.test.mjs`

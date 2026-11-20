# Shwari roadmap

**Goal:** a business that runs itself end to end, where a person is needed only
to verify payments and to handle what the team flags.

The rules every phase must keep are in `.claude/skills/shwari-platform/SKILL.md`.
Read that first.

Written 20 November 2026. Phases are ordered by dependency, not by date: each
one is only worth starting when the one before it is seen working in
production.

---

## Where we are

**Working in production**
- Five agents (manager, sales, bookings, orders, support) on Telegram, web
  chat and Instagram DMs, pinned to one model.
- Records are read before the model answers; replies are checked before they
  are sent; a payment proof is recorded by the runtime.
- Orders, bookings, payment claims, verification, receipt in chat and by
  email, notifications, lead scoring, a leads board, automatic check-ins.
- Learning from owner corrections, QA notes, staff replies and repeated
  mistakes.

**Not yet true**
- WhatsApp is not connected (Meta approval outstanding).
- The Meta app is in Development mode, so only test accounts reach the agents.
- Scheduled work runs once a day (Vercel Hobby); follow-ups otherwise ride on
  incoming traffic.
- The model is weak at calling tools on its own; the runtime compensates.
- Most of the last two days' changes are tested but have had one or two real
  runs each.

**The honest gap to "runs itself":** nothing brings customers in, public
comments are ignored, and reliability has been proven on a handful of test
conversations, not on real volume.

---

## Phase 0 - Make what exists dependable

*Nothing new until this holds. Autonomy multiplies whatever reliability we have.*

| Work | Why |
|---|---|
| Meta app Live: business verification, App Review for Instagram messaging | Real customers cannot reach the agents until this is done |
| WhatsApp connected | The main sales channel in Kenya |
| A scheduler that runs every few minutes: the database's own (`pg_cron` + `pg_net`) calling the existing scheduled endpoints, with the shared secret held in Supabase Vault. Decided 20 Nov 2026; Vercel's daily cron stays as a backstop | Follow-ups, reminders and, later, posting cannot wait for a daily run |
| One reply per customer message; photos and voice notes understood, not just noted | Duplicate and blind replies are the most visible defect left |
| A weekly quality review from `review_agent_quality` with a target | So "reliable" is a number, not a feeling |
| Reset every secret that was pasted into a chat | They are compromised |

**Done when:** over two weeks of real traffic, at least 90% of conversations
finish without a person other than payment verification, and no reply is held
back for a false claim more than once in 200 turns.

---

## Phase 1 - Marketing agent: publishing

*The agent posts; it does not yet talk.*

**What the owner gets**
- A **content library**: upload your own photos and videos, write or approve a
  caption, tag the product or service it is about, choose where it may go.
  The agent never generates or edits images; when the library is running low
  for a product, Shwari asks for more.
- A **calendar**: how often to post, on which days and hours, per platform.
- **Approval modes**: approve the week (the default), approve each post, or
  autopilot from already-approved items.
- **The weekly approval**: once a week Shwari lays out the next seven days of
  posts - media, caption, platform, time. The owner approves the lot, swaps or
  edits individual posts, or rejects one. Only approved posts are published; a
  week nobody approved publishes nothing, and Shwari says so.
- Posts published to **Instagram** and the **Facebook Page** on schedule, with
  the result (published, failed and why) on the calendar.
- Shwari can do all of it by chat: "post the bridal bundle on Friday at 6",
  "what is going out this week", "pause posting".

**What the agent does**
- Picks the next post from approved items, respecting cadence, reuse limits
  and not repeating a product two posts running.
- Drafts captions for approval, grounded only in the catalogue and business
  facts. A draft that states a price or an offer is checked against the
  catalogue before it can be approved.
- Refuses to publish anything unapproved, and flags a failed or rejected post.

**Depends on**
- New Meta permissions through App Review: publishing to Instagram, and
  posting to a Facebook Page. Facebook Pages need Facebook Login for
  Business in addition to the Instagram login used today.
- Public hosting for media (Supabase Storage).
- The Phase 0 scheduler.

**Limits to design around**
- Instagram accepts API publishing only for professional accounts, from a
  public media URL, with a daily cap on posts.
- There is no native scheduling in the API: our scheduler is the schedule.

**Done when:** a business posts for two weeks from the calendar with no post
missed, duplicated or published unapproved.

---

## Phase 2 - Marketing agent: engagement

*The agent answers the public and turns interest into conversations.*

- **Comments** on Instagram and Facebook arrive by webhook and are classified:
  question, buying intent, praise, complaint, spam.
- **Public replies** are short and never state anything the catalogue does not.
- **Buying intent moves to a private message** ("I've sent you the details"),
  using the platform's private-reply-to-a-comment feature, and the
  conversation is handed to Sales, Bookings or Orders with the post it came
  from attached.
- **Complaints** get one calm public reply and a handover to a person. They are
  never answered with a pitch and never hidden.
- **Spam and abuse** are hidden where the platform allows, and logged.
- **Facebook Messenger** becomes a channel like the others.
- Every lead carries its **source**: which post, which comment, which channel.

**Guardrails specific to this phase**
- A per-post and per-hour cap on public replies, so the agent cannot flood a
  thread.
- No reply to its own comments or to other businesses.
- Public replies pass a stricter check than private ones: no prices unless the
  post itself shows them, no customer details, no promises.

**Done when:** in a month, comments are answered within minutes, at least one
in five buying-intent comments becomes a private conversation, and no public
reply had to be deleted.

---

## Phase 3 - Selling without a person

*Close the loop from first touch to delivered order.*

- **Payment matched automatically.** Connect M-Pesa (Daraja) so a payment to
  the business's till or paybill is matched to the open order by amount,
  account and time. A match the system is sure of can be **auto-verified**;
  anything uncertain stays with a person. *This is the one step that removes
  the remaining human bottleneck, and the owner chooses how far to trust it.*
- **Delivery status** the customer can ask about: dispatched, with whom,
  expected when - entered by staff or by a courier integration.
- **Stock that moves.** An order reserves stock; out-of-stock items stop being
  offered and stop being posted about.
- **Reminders and reviews.** Appointment reminders, "did it arrive?", and a
  request for a review after delivery.
- **Media understood.** A photo of a payment message or a product is read, not
  just acknowledged.

**Done when:** an order can go from a comment to delivered with the only human
action being a glance at the payments that did not match automatically.

---

## Phase 4 - The business runs itself

- **A daily brief** from Shwari: what sold, what is stuck, what it did, the
  three things that need the owner.
- **Marketing learns.** Posts and replies are scored by the conversations and
  sales they produced; the calendar favours what works.
- **Campaigns.** "Promote the bridal bundle this week" becomes posts,
  follow-ups to interested leads, and a report.
- **Limits the owner sets once:** spend, discount, order value and message
  volume ceilings that the team cannot exceed.
- **An audit trail** the owner can read: everything the team did and why.

---

## What stays human, by design

- Verifying a payment the system could not match with certainty.
- Refunds, disputes and anything that moves money out.
- Complaints, legal or safety matters, and angry customers.
- Approving content, until the owner chooses autopilot.
- Changing who has access, connecting channels, and entering secrets.

---

## Risks to keep in view

| Risk | What we do about it |
|---|---|
| Meta rejects or delays App Review | Start Phase 0 approvals now; build Phase 1 so it can run on test accounts meanwhile |
| A wrong public post or reply | Approval by default, grounding checks, caps, and instant pause from Shwari or the dashboard |
| The model skips an action | The runtime performs anything that must happen; the model only words it |
| Account restricted for automation | No unsolicited messages, no engagement farming, platform windows respected |
| The owner stops watching | Notifications for every flagged case; a daily brief; hard ceilings |
| Cost per conversation | Measure tokens per turn; keep pre-reads small; one model call where one will do |

---

## Decisions needed before Phase 1

1. ~~Approval mode at launch~~ - **decided 20 Nov 2026: approve the week.**
2. ~~Who makes the content~~ - **decided 20 Nov 2026: the owner's own media only;
   no AI-generated images.**
3. **Facebook** - is there a Facebook Page for each business, and should it
   mirror Instagram or have its own calendar?
4. **Payment automation** - is auto-verifying a confident M-Pesa match
   acceptable in Phase 3, or must every payment stay with a person?
5. ~~Scheduler~~ - **decided 20 Nov 2026: the database's own scheduler.**

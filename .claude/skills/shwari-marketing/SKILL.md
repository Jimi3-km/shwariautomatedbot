---
name: shwari-marketing
description: How Shwari is described to the outside world, and how its public imagery is made. Read this before writing or changing the landing page, a tutorial, an ad, a post or any other public copy or picture of the product, and before answering "what can we say about Shwari". It holds the positioning, the claims that are true today and where each can be seen, the voice, the asset inventory in public/landing with how to redo each one, the data-masking rules, and what must never be claimed.
---

# Shwari marketing

Written 22 November 2026 from a walk through the live app and the code. The
product rules are in `.claude/skills/shwari-platform/SKILL.md`; nothing here
may contradict them. When the product changes, change this file and the
landing page together.

## Who it is for, in their words

An owner of a small business that sells through chats: a shop, a salon, a
studio, a service company. Customers message on WhatsApp, Instagram, Messenger,
Telegram or the website, usually when the owner is busy.

What they say:

- "I answer the same price questions all day and still miss messages."
- "People say they have paid and I have to dig through my phone to check."
- "Orders live in my chats. I lose track of who ordered what."
- "I never get round to posting."
- "I can't give my staff my phone."

## What it is

**One line:** An AI team that answers your customers, takes the order and gets you paid.

**One paragraph:** Shwari is six AI agents working from your own catalogue.
They answer customers on WhatsApp, Instagram, Messenger, Telegram and web
chat, record orders and bookings, and send invoices and receipts as PDFs on
your letterhead. A person on your side confirms every payment; nothing is
marked paid on an agent's say-so. You run it by talking to Shwari, the
manager agent, and you hear at once when something needs you.

## Proof points true today, and where to see each

Check a claim against this table before using it. "Seen" means seen on screen
on 22 Nov 2026; "code" means read in the code but the demo business had no
live record of it to look at.

| Claim | Where it shows | Basis |
|---|---|---|
| Six agents: Shwari, Sales, Support, Bookings, Orders & Payments, Marketing | AI team page ("6 of 6 agents on") | Seen |
| Each agent has a fixed job, rules it always follows, and takes your instructions | AI team page, open an agent | Seen |
| Five channels: Telegram, WhatsApp Business, Instagram, Facebook Page (Messenger), Web chat | Integrations; Overview "Channels" | Seen listed; Telegram and Instagram seen connected |
| One inbox, each conversation marked with channel, lead stage and "AI handling"; a person can Take over | Inbox | Seen |
| Leads board from New to Won, with channel and interest score | Leads | Seen |
| Agents answer from the catalogue only | Platform rules 1 and 2; Products and Services pages | Code and rules |
| A payment message becomes a claim; only a person verifies it | Payments ("Your AI agent can never mark a payment verified"), Verify / Reject, "Verify this payment?" | Seen (page, a verified payment); Verify button and dialog from code |
| After Verify the customer gets a confirmation and a PDF receipt in chat and by email | `paymentNotice.ts`; Settings > Invoices & receipts preview text | Code; receipt drawn with the real renderer |
| Invoices: raise, send as PDF, Mark paid, Open PDF, Send again, Cancel invoice; awaiting and overdue totals | Invoices | Seen |
| An invoice goes to the customer's chat if they have messaged, otherwise by email | New invoice dialog hints; Inbox shows "PDF · Invoice INV-00001.pdf" | Seen |
| "Invoice bookings automatically" | Settings > Invoices & receipts | Seen (the switch) |
| Letterhead: banner or logo, contact details, tax number, closing note, colour, PAID mark, live preview | Settings > Invoices & receipts | Seen; preview redrawn with demo details |
| Pop-ups and the bell in the dashboard | Settings > Notifications ("Everything appears in the bell, and pops up on screen...") | Seen described; pop-up markup in `NotificationsBell.tsx` |
| Alerts to chosen WhatsApp numbers and to your own Telegram bot; choose what to alert about; send a test alert | Settings > Notifications | Seen |
| Numbered dots in the menu for Leads, Appointments, Support and Orders; opening the page clears the dot | `AppShell.tsx` | Code |
| Marketing: your own photos and videos only, nothing generated; Instagram and Facebook Page; approve the week, each post, or autopilot; posting days and times; pause | Marketing > Calendar, Library, Schedule | Seen (empty calendar and library; schedule set) |
| Roles Owner, Manager, Staff, Viewer; invite by email with optional WhatsApp number; invitations expire; activity log | Settings > Team | Seen |
| Shwari sets up the business from plain language; also on Telegram for owner and managers | Shwari page ("Talk on Telegram"); AI team "What it handles" | Seen |
| Works in a phone browser with a bottom bar (Home, Inbox, Shwari, Orders, More) | Any page at phone width | Seen |
| A new business is reviewed before its agents answer customers | Banner text in `AppShell.tsx` | Code |

## Voice

Plain and direct. Say what happens, in the order it happens, in the words the
product itself uses on screen.

**Use:** agent, catalogue, order, booking, payment claim, verify, receipt,
invoice, letterhead, alert, pop-up, inbox, lead, approve, your own photos,
a person, your staff.

**Avoid:** revolutionary, seamless, supercharge, effortless, 10x, autopilot
(except as the name of the approval mode), "fully automated", "never miss a
sale", "24/7" as a headline, "AI-powered" as a prefix on everything, exclamation
marks, em dashes as decoration.

Rules of thumb:

- Lead with what the owner gets, then how. "You check that the money arrived."
- Quote the product's own sentences where they are good ("Customers claim a
  payment; you confirm it.").
- Say the limits out loud. They are the reason an owner can trust it: an
  agent never verifies a payment, never invents a price, never posts
  unapproved content.
- No numbers that were not measured. No customer names, logos or quotes.
- UK spelling: catalogue, colour.

## Workflows worth showing, and the asset that shows each

| Workflow | Asset | Kind |
|---|---|---|
| The product at a glance | `tour.webm` / `tour.mp4` | Video from real screens |
| Message to receipt (the whole sale) | `src/components/landing/SaleExplainer.tsx` | Explainer in code |
| One inbox across channels; Take over | `inbox.webp` | Screenshot |
| Leads board | `leads.webp` | Screenshot |
| Payment check | `payments.webp` | Screenshot |
| Receipt and invoice documents | `receipt.webp`, `invoice-doc.webp` | Real renderer, demo data |
| Letterhead with live preview | `letterhead.webp` | Screenshot |
| Raising and sending an invoice | `invoice.webm` / `invoice.mp4`; spares `invoices.webp`, `invoice-new.webp`, `invoice-menu.webp` | Video from real screens |
| An alert in three places | `AlertsExplainer` in `src/components/landing/Explainers.tsx` | Explainer in code |
| Choosing what to be alerted about | `notifications.webp` | Screenshot |
| The six agents | `ai-team.webp` | Screenshot |
| Talking to Shwari | `shwari.webp` | Screenshot (a real exchange) |
| Approving a week of posts | `MarketingExplainer` in `Explainers.tsx`; `marketing-schedule.webp`; spare `marketing-calendar.webp` | Explainer in code, screenshot |
| Roles and invitations | `team.webp` | Screenshot |
| On a phone | `phone.webm` / `phone.mp4`, `phone-chat.webp`, `phone-invoices.webp`; spares `phone-home.webp`, `phone-payments.webp` | Video and screenshots |

The explainers exist because the demo business had no pending payment claim,
no bell notifications, no new-activity dots and no planned posts on the day of
capture, and making them would have meant changing real records. Their wording
is copied from the product: pop-up titles and bodies (`operations.ts`,
`paymentNotice.ts`), the Payments buttons and "Verify this payment?" dialog
(`Payments.tsx`), the confirmation sentence (`paymentNotice.ts`), "Needs
approval", "Approve week (3)" and the toast (`Marketing.tsx`). If those
strings change, change the explainers. When real data exists, replace an
explainer's scene with a capture where it reads better.

## Asset inventory: `public/landing/`

Total 2.3 MB. The page loads images lazily and videos with `preload="none"`,
so a visitor downloads only what they scroll to. Spares are not referenced by
the page.

| File | Size | Pixels | What it is |
|---|---|---|---|
| `tour.webm` / `tour.mp4` / `tour-poster.webp` | 400 / 342 / 19 KB | 960x570, 13.7 s | Overview, Inbox, Leads, Invoices, Payments, AI team, crossfaded |
| `invoice.webm` / `invoice.mp4` / `invoice-poster.webp` | 243 / 201 / 19 KB | 960x570, 10.1 s | Invoices list, New invoice dialog, row menu, the invoice in the chat |
| `phone.webm` / `phone.mp4` / `phone-poster.webp` | 329 / 187 / 15 KB | 390x844, 10.5 s | Home, Inbox, a conversation, Invoices, Payments at phone size |
| `overview.webp` (spare) | 33 KB | 1280x760 | Overview |
| `inbox.webp` | 58 KB | 1280x760 | Inbox with a conversation open |
| `leads.webp` | 16 KB | 1048x400 | Leads board, top |
| `invoices.webp` (spare) | 22 KB | 1048x470 | Invoices list |
| `invoice-new.webp` (spare) | 24 KB | 760x740 | New invoice dialog, filled with demo values, not submitted |
| `invoice-menu.webp` (spare) | 7 KB | 600x250 | Row menu: Open PDF, Send again, Cancel invoice |
| `payments.webp` | 14 KB | 1048x330 | Payments, "All" tab, one verified payment |
| `letterhead.webp` | 43 KB | 1048x622 | Settings > Invoices & receipts, form beside the preview |
| `notifications.webp` | 19 KB | 740x500 | Settings > Notifications, "What to alert about" |
| `team.webp` | 22 KB | 740x480 | Settings > Team: invitation, invite form, roles |
| `marketing-schedule.webp` | 21 KB | 620x520 | Marketing > Schedule |
| `marketing-calendar.webp` (spare) | 20 KB | 1048x360 | Marketing > Calendar, empty week |
| `ai-team.webp` | 35 KB | 900x570 | AI team: the customer-facing agents and Marketing |
| `shwari.webp` | 18 KB | 1030x196 | Shwari chat: a request and the start of its reply |
| `receipt.webp` | 31 KB | 720x748 | Sample receipt |
| `invoice-doc.webp` | 33 KB | 720x900 | Sample invoice |
| `phone-home.webp` (spare), `phone-chat.webp`, `phone-invoices.webp`, `phone-payments.webp` (spare) | 22 / 43 / 30 / 20 KB | 540x1170 | Phone-size screens |

### How to redo them

**Screenshots (desktop).** In the app's built-in browser, signed in to the
demo business, with the viewport emulated at 1280x760. The pane returns a
screenshot only 800 px wide, so each view is captured as four sharp tiles and
stitched:

1. Inject the masking script (below) and let it run on every change.
2. For each tile set `document.documentElement.style.transform = 'scale(1.6)'`
   with `transformOrigin` of `0 0`, `100% 0`, `0 100%`, `100% 100%`, and take a
   lossless region capture of the whole 800x475 frame. Clear the transform
   afterwards.
3. Stitch onto a 1280x760 canvas with ffmpeg: tiles at (0,0), (480,0),
   (0,285), (480,285).
4. Crop to the part that matters and encode:
   `ffmpeg -i in.png -vf "crop=W:H:X:Y" -c:v libwebp -quality 86 out.webp`.

**Screenshots (phone).** Viewport preset "mobile" (375x812), reload, inject
the masking script, take a plain screenshot (it arrives at 750x1624), then
`-vf scale=540:-2`.

**Videos.** Crossfades between the stitched stills (no screen recording):
each still held about 2.2 s with a 0.5 s `xfade`, at 24 fps, scaled to
960x570 (phone: 390x844). Encoded twice:
`-c:v libvpx-vp9 -b:v 0 -crf 32 -an` and
`-c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an`.
The poster is the first still as WebP. Keep each file under about 1 MB.

**Documents.** `renderReceiptPng` from `src/server/services/receiptImage.ts`
with the data shape in `receiptLayout.ts`, run with `npx tsx` from a throwaway
script in the repo root (deleted afterwards). Demo business "Amani Home
Studio", customer "Jane Wanjiru", accent `#4f46e5`, `logoData: null`,
`letterheadData: null`; `kind: 'invoice'` with `dueDate`, `status: 'unpaid'`
and `payLines` for the invoice. Then `-vf scale=720:-2` to WebP.

**What may be touched while capturing.** Open pages, dialogs and menus; type
into forms; press "Preview changes" on the letterhead (it only redraws the
preview). Never press Send, Create and send, Save as draft, Mark paid, Verify,
Reject, Approve, Plan next 7 days, Invite, Withdraw, Disconnect or any Save.
Close dialogs with Escape and reload when done so nothing typed lingers.

## Data masking

The demo business holds real people's details. Nothing that identifies a real
person may appear in public imagery: no customer or staff name, email, phone
number, chat handle, platform user id, or payment reference. The signed-in
email address must never appear. The business name "BuiltWithAI Studio" and
its own public Instagram handle may.

Before any capture, run a script in the page that walks every text node and
replaces known real values and patterns, and keeps doing so on every DOM
change (a `MutationObserver`). Masked on 22 Nov 2026:

| Real value | Shown as |
|---|---|
| The signed-in email (sidebar, Team) | `owner@example.com` |
| The Telegram customer's name, first name and initials | `Jane Wanjiru`, `Jane`, `JW` |
| The Telegram customer's numeric chat id | `700000000` |
| The Instagram customer's handle | `@amani.designs` |
| A lead named by first name only | `Peter Kamau` |
| A raw Instagram user id on the Overview | `Brian Otieno` |
| The payment reference | `QWE12RT45X` |
| The invited staff member's email | `amina@example.com` |
| Any other personal email (gmail, yahoo, outlook, hotmail, icloud) | an `example.com` address |
| Any Kenyan phone number | `+254 700 000 000` |
| The business's previous name inside an old Shwari message | `BuiltWithAI Studio` |
| A person's name inside a Shwari reply | `Peter` |
| Business phone, email and website on the letterhead preview | typed as demo values into the unsaved form, then "Preview changes" |

Rules:

- Read the page text before capturing and look at every tile afterwards. A
  picture drawn by the server (the receipt preview) is not reached by text
  masking; change what feeds it or do not show it.
- Demo names are always the same set, so pictures agree with each other:
  customer Jane Wanjiru, business Amani Home Studio (documents and
  explainers), order ORD-00042, reference QWE12RT45X, phone +254 700 000 000.
- Figures (counts, totals, dates) are left as they are. Do not inflate a
  dashboard to look busier.
- Reload afterwards. Masking changes the page in the browser only; it never
  touches a record.
- If a view cannot be made safe, leave it out.

## Never claim

- That an agent confirms, verifies or receives a payment, or that payments
  are matched or collected automatically. There is no M-Pesa integration and
  no payment links.
- That anything is posted without approval, or that images, video or captions
  are produced without the owner. Media is the owner's own.
- That agents reply to public comments or reviews. Planned, not built.
- Delivery tracking, stock reservation, a daily brief, campaigns, reviews
  requests. On the roadmap, not built.
- A native Android or iOS app. It is the dashboard in a phone browser.
- That WhatsApp, Instagram or Messenger are guaranteed to work for a new
  business. They depend on Meta approving the account; say so.
- Response times, uptime, "24/7", conversion rates, time saved, number of
  customers or messages, or any other figure nobody measured.
- Testimonials, customer logos, case studies, awards, pricing or plans.
- That it replaces staff, or that no person is needed. A person verifies
  every payment and handles what the team flags.
- The model, vendor or any internal technical detail as a selling point.
- Anything about a feature you have not just seen in the app or read in the
  code. If you cannot confirm it, leave it out.

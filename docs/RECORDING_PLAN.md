# Screen recording plan

Twelve short recordings that, between them, show every flow in the product.
They are used for three things:

1. **A platform skill file** written from what the product actually does on
   screen, not from memory of the code.
2. **Tutorial imagery**: stills and short clips cut from the recordings.
3. **The landing page**: short looping clips of the real product, and copy
   that matches what it does today.

## How to record

- **Tool:** anything that saves an MP4. On Windows, `Win + Alt + R` (Xbox Game
  Bar) records the active window; OBS works too.
- **Window:** the browser at 1440 x 900 or larger, zoom 100%, bookmarks bar
  hidden, no other tabs showing. Dark or light, but the same in every session.
- **Phone sessions:** record the phone's screen (screen recording in the
  control centre) and send the file as it is.
- **Pace:** move slowly, pause one second after each click, and let each page
  finish loading before the next action.
- **No sound needed.** I work from what is on screen and cannot hear narration.
  If something needs explaining, add a line to the notes file (below).
- **Use a demo business**, not a real customer's. Customer names, phone
  numbers and payment references appear on screen and will end up in public
  imagery. Where real data is unavoidable, say so in the notes and I will
  blur or cut it.
- **Never show a secret:** no bot tokens, API keys or passwords on screen.
  Session 6 covers how to handle the one place a token is typed.
- **One file per session**, named as shown (`01-first-run.mp4`). If a session
  goes wrong, stop and re-record just that one.

**Notes file:** optional `NN-notes.txt` beside a recording, for anything the
screen does not show (why a step matters, what a customer would have typed,
something that looked wrong).

## Where to put them

Put all the files in one folder on this computer (for example
`Downloads\shwari-recordings`) and tell me the folder. I will ask the app for
access to it.

## The sessions

Each is two to five minutes. Sessions 1 to 3 are the ones the landing page
needs first.

### 01 - First run: sign up to a live agent  (`01-first-run.mp4`)
*Account: a brand-new email address.*
1. Open the landing page, scroll it once top to bottom, press **Start Free**.
2. Create the account; show the confirmation step.
3. Go through setup: business name and category, the assistant, connecting a
   channel (web chat is quickest), **Launch**.
4. Land on the dashboard with the "waiting for approval" banner showing.

### 02 - A customer conversation, end to end  (`02-customer-chat.mp4`)
*Two windows side by side: the customer's chat (Telegram or web chat) and the dashboard Inbox.*
1. As the customer: greet, ask about a product or service, ask the price.
2. Place an order (or book a service); give name and phone when asked.
3. Show the Inbox updating: the conversation, which agent answered, the lead.
4. Show the new-activity dots appear on Orders or Appointments, and the pop-up.

### 03 - Getting paid: claim, verify, receipt  (`03-payment-receipt.mp4`)
*Continue from session 2.*
1. As the customer: send a payment message (an M-Pesa style confirmation).
2. Dashboard: the pop-up and the bell, then **Payments**; open the claim.
3. Press **Verify**.
4. Customer window: the confirmation and the receipt PDF arriving. Open the PDF.

### 04 - Invoices  (`04-invoices.mp4`)
1. **Invoices → New invoice**: pick a customer, add two lines from the
   catalogue, set a due date, **Create and send**.
2. Customer window: the invoice PDF arriving. Open it.
3. Customer sends a payment message; dashboard **Payments → Verify**; back on
   **Invoices** the invoice now reads Paid.
4. Raise a second invoice and use **Mark paid** instead.
5. **Settings → Invoices & receipts**: switch on "Invoice bookings automatically".

### 05 - Making it yours: receipts, invoices and letterhead  (`05-letterhead.mp4`)
1. **Settings → Invoices & receipts**.
2. Upload a logo; watch the preview change. Then upload a letterhead banner.
3. Fill in the contact details, tax number and closing note; change the colour.
4. **Save**, then open a real receipt PDF to show the result.

### 06 - Connecting channels  (`06-channels.mp4`)
1. **Integrations**: show the list and what is connected.
2. Connect **Telegram**. *Before pasting the bot token, stop the recording,
   paste it, press Connect, then start recording again.* The token must never
   be on screen.
3. Connect **web chat**; copy the embed snippet; show the widget on a test page.
4. Start the **WhatsApp** or **Instagram** connection as far as Meta's sign-in
   page, then cancel. (A full connect only if you are happy to show that account.)
5. Press **Check** on a connected channel.

### 07 - Shwari, the manager  (`07-shwari.mp4`)
1. Open **Shwari** in the dashboard. Ask it to add a product with a price.
2. Ask it to change the opening hours.
3. Ask "what happened today?" and "who is waiting on us?".
4. Show the product on **Products** and the hours on **Settings**.
5. Optional: the same from Telegram, after linking the chat with a pairing code.

### 08 - The AI team  (`08-ai-team.mp4`)
1. **AI team**: open each agent's section (Sales, Support, Bookings, Orders,
   Marketing); switch one off and on.
2. **AI agent settings**: persona, sales script, escalation rules.
3. **Agent QA**: open a turn, read what the agent did, label it.

### 09 - Marketing  (`09-marketing.mp4`)
1. **Marketing**: upload two photos to the library.
2. **Plan the week**; open a proposed post; edit the caption.
3. **Approve** the week. Show the calendar.
4. Posting settings: approval mode, pause.

### 10 - Team and alerts  (`10-team-alerts.mp4`)
1. **Settings → Team**: invite a staff member by email and WhatsApp; show the
   role descriptions; change a role; open the activity log.
2. **Settings → Notifications**: add a WhatsApp number; show the Telegram bot
   section (do not paste a token on screen); untick and re-tick an alert;
   **Send a test alert**.
3. The phone receiving the alert (a photo or a phone screen recording is fine).

### 11 - Running the platform  (`11-platform.mp4`)
*Account: the platform admin.*
1. **Platform**: the list of businesses and the figures at the top.
2. **Approve** the business created in session 1.
3. **Open** a business; show the support-mode banner; **Leave**.
4. Pause and resume a business's agents.
5. **Email check** and the Meta setup check (results only; no secrets appear).

### 12 - On a phone  (`12-mobile.mp4`)
*Phone screen recording, signed in as an owner.*
1. Home, the bottom bar, **More**.
2. Inbox: open a conversation and reply.
3. Payments: verify a claim.
4. Invoices: open one.

## What I do with each recording

1. Check it plays and note its length and size.
2. Pull a still every second or two and read through them in order.
3. Write up the flow as it really happened: each screen, each action, what
   changed. Anything that looks broken or confusing goes on a fix list.
4. Pick the stills for tutorials and the ten-to-twenty-second stretches for
   landing-page clips; cut and compress those.
5. After the last session: write the platform skill file and the marketing
   skill file, update the landing page, and show you before anything is
   published.

## Privacy

Nothing from the recordings is published until you have seen it. Clips for the
landing page are cut to the product only, with any real name, number or
reference blurred. The original recordings stay on your computer.

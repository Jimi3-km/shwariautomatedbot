# Email delivery

Every email the platform sends goes through Brevo (`src/server/services/brevo.ts`).
This page maps each one: what triggers it, which address it goes to, and what
has to be configured for it to arrive.

## The emails

| Email | Triggered by | Sent to | Code |
|---|---|---|---|
| **Order received** | An agent records an order (`record_order`) | The email on the customer's lead, or one given by staff | `sendOrderReceipt` in `src/server/ai/tools/operations.ts` |
| **Booking confirmed** | An agent books an appointment (`book_appointment`) | The email on the customer's lead | `sendAppointmentConfirmation` in `src/server/ai/tools/operations.ts` |
| **Payment receipt** | A person presses **Verify** on the Payments page | `payments.customer_email`, else the email on the lead | `notifyPaymentVerified` in `src/server/services/paymentNotice.ts` |
| **Receipt, again** | A customer or staff asks for it (`resend_receipt`) | The email on the lead only | `resendReceipt` in `src/server/ai/tools/growth.ts` |
| **Reply to an inbound email** | A customer emails the business; the Brevo inbound webhook delivers it | The sender of that email | `src/server/routes/webhooks/brevo.ts`, `sendAgentEmailReply` |

Alongside the payment receipt email, the same receipt goes out in the
customer's chat as text and as a photo (`src/server/services/receiptImage.ts`,
`src/server/channels/media.ts`), and a copy is stored in the `receipts` table.

## Where the address comes from

An agent never invents an address and never sends to one typed into a
customer's message as an instruction.

1. The customer gives their email in the conversation.
2. The agent saves it with `save_customer_details`, which writes `leads.email`.
3. Every email above reads it from there.

No email on the lead means no email is sent. The chat message still goes out,
and the Payments page says the receipt was not emailed.

- **Orders:** the sales and orders skills ask for name, phone and email before
  recording an order, so the order email normally has an address.
- **Bookings:** only name and phone are required. The booking skill offers the
  email confirmation once; if the customer declines, the booking is confirmed
  in chat only.
- **A different address:** the customer says so, the agent saves the new one,
  then resends. `resend_receipt` takes no address of its own on a customer turn.

## Configuration

| Variable | Needed for | Notes |
|---|---|---|
| `BREVO_API_KEY` | Every email | Without it nothing is sent and `[brevo] BREVO_API_KEY is not configured` is logged. |
| `BREVO_SENDER_EMAIL` | Every email | Must be a sender (or domain) verified in Brevo, or Brevo rejects the send. |
| `BREVO_SENDER_NAME` | Every email | Display name. Defaults to "shwari agent". |
| `BREVO_WEBHOOK_SECRET` | Inbound email only | The inbound webhook refuses every call without it. |

All tenants currently send from the one sender above. A customer therefore sees
the platform's sender address with the business's name in the subject and body,
not an address at the business's own domain.

## Reliability

- Sends are awaited inside the action that triggers them. On a serverless
  function an email left running in the background can be cut off when the
  reply goes out.
- An email failure never fails the action: the order, booking or verification
  stands, and the failure is logged with a `[brevo]` prefix.
- The receipt email is sent once per payment (`payments.receipt_sent_at`);
  `resend_receipt` is the only path that sends it again.

## Checking that it works

1. Place a test order as a customer and give an email address. The order email
   should arrive within a minute.
2. Send a payment confirmation, then press **Verify** on the Payments page. The
   toast says how the receipt went out ("as a photo in the chat and by email").
3. `select order_ref, sent_in_chat, sent_by_email, recipient_email from receipts
   order by created_at desc limit 5;` shows what was sent.
4. If an email did not arrive, search the function logs for `[brevo]`. The
   usual causes are an unverified sender and a missing `BREVO_API_KEY`.

## When emails are "sent" but never arrive

The email service accepting a message is not the same as it reaching an inbox.
The receipts log showed emails as sent while customers received nothing. The
usual causes, in order:

1. **The sending address is a free mailbox** (`@gmail.com`, `@yahoo.com`,
   `@outlook.com`). Those providers reject or spam-folder mail that claims to
   be from them but was sent by another service. Use an address at a domain
   you own.
2. **The domain is not authenticated.** Add the domain in Brevo (Senders,
   Domains & Dedicated IPs > Domains) and add the DKIM, DMARC and Brevo-code
   DNS records it shows.
3. **The sender is not confirmed** in Brevo (Senders tab).
4. **The key is an SMTP key**, not an API key. The platform uses the API; the
   key must start with `xkeysib-`.
5. **The customer has no email on file.** No address, no email.

The platform admin's **Platform page > Email check** tests 1 to 4 against Brevo,
lists what Brevo did with recent messages (delivered, bounced, blocked) and can
send one real test email. Every attempt is also kept in the `email_log` table
with what the service answered.

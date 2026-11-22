# Getting the Meta app approved for real accounts

Until Meta approves the app, only accounts with a role on it (admins,
developers, testers) can connect Instagram, a Facebook Page or WhatsApp.
Everyone else is refused by Meta. This is the path to serving any business.

Nothing here is a code change. It is a submission to Meta, made in the Meta
dashboard, with the pieces the app now provides.

> Meta changes its review requirements from time to time. Treat the wording
> below as a starting point and follow what the dashboard asks for on the day.

## 1. What to enter in the Meta dashboard

**App settings > Basic**

| Field | Value |
|---|---|
| Privacy Policy URL | `https://shwariautomatedbot.vercel.app/privacy` |
| Terms of Service URL | `https://shwariautomatedbot.vercel.app/terms` |
| User data deletion | Choose **Data deletion callback URL**: `https://shwariautomatedbot.vercel.app/api/webhooks/meta/data-deletion` |
| App icon | 1024 x 1024, no Meta trademarks |
| Category | Business and pages |
| App domains | `shwariautomatedbot.vercel.app` (and `ai.tryavora.space` if you use it) |

**Facebook Login for Business > Settings**

| Field | Value |
|---|---|
| Deauthorize callback URL | `https://shwariautomatedbot.vercel.app/api/webhooks/meta/deauthorize` |
| Data deletion request URL | `https://shwariautomatedbot.vercel.app/api/webhooks/meta/data-deletion` |

**Instagram > API setup with Instagram login > Business login settings**

| Field | Value |
|---|---|
| Deauthorize callback URL | `https://shwariautomatedbot.vercel.app/api/webhooks/meta/deauthorize` |
| Data deletion request URL | `https://shwariautomatedbot.vercel.app/api/webhooks/meta/data-deletion` |

If you use your own domain as the main address, use it in place of
`shwariautomatedbot.vercel.app` everywhere above, consistently.

**On the server (Vercel > Environment variables), then redeploy**

| Variable | Value |
|---|---|
| `LEGAL_OPERATOR_NAME` | The legal name of the company or person operating the service |
| `LEGAL_CONTACT_EMAIL` | An address that is read, for privacy and deletion requests |

Neither is a secret. Without them the pages still work, but name no operator
and point people to the request form instead of an address.

## 2. Business verification

Meta Business settings > Security Centre > **Start verification**. You need
the business's legal name, address, phone and a document that shows them
(registration certificate, utility bill, tax document). Allow several days.
Advanced access is not granted to an unverified business.

## 3. Permissions to request

App Review > Permissions and features > **Request advanced access** for each.
For every permission Meta asks for a written description of how the app uses
it and a screen recording showing it in use, start to finish, in the app.

### Instagram (Instagram API with Instagram Login)

**`instagram_business_basic`**
> Shwari lets a business connect its Instagram professional account so that
> customer messages can be answered from one place. We use this permission to
> read the connected account's ID and username, to show the business which
> account is connected, and to match incoming messages to that business. We do
> not read the account's followers or media beyond what is needed to publish
> posts the business approves.

**`instagram_business_manage_messages`**
> When a customer sends a direct message to the business's Instagram account,
> Shwari receives it, shows it in the business's inbox, and replies on the
> business's behalf, either through an AI assistant configured by the business
> or by a member of its staff. Replies are only sent in response to a message
> from the customer, within Instagram's messaging window. The business can see
> every conversation and take over from the assistant at any time.

**`instagram_business_content_publish`**
> A business uploads its own photos and videos to Shwari and approves a
> calendar of posts. Shwari publishes each approved post to the business's own
> Instagram account at the scheduled time. Nothing is published without the
> business's approval, and only media the business uploaded is used.

### Facebook Pages

**`pages_show_list`**
> After the business owner signs in with Facebook, we list the Pages they
> manage so they can choose which one to connect.

**`pages_manage_metadata`**
> We subscribe the chosen Page to message webhooks so that customer messages
> reach the business's inbox in Shwari.

**`pages_messaging`**
> When a customer messages the business's Page in Messenger, Shwari shows the
> message in the business's inbox and replies on the business's behalf, by an
> AI assistant or by staff, within the standard messaging window.

**`pages_read_engagement`** and **`pages_manage_posts`**
> A business approves a calendar of posts made from its own photos and videos.
> Shwari publishes each approved post to the business's Page and reads back the
> published post's link to show the business that it went out.

### WhatsApp

**`whatsapp_business_management`**
> During sign-up the business chooses or creates its WhatsApp Business account
> and phone number. We use this permission to read that account and number, to
> register the number for the Cloud API, and to create the message templates
> used for receipts, invoices and staff alerts.

**`whatsapp_business_messaging`**
> When a customer messages the business's WhatsApp number, Shwari shows the
> message in the business's inbox and replies on the business's behalf, by an
> AI assistant or by staff. Receipts and invoices are sent to the customer as
> PDF documents. Outside the 24-hour window only approved templates are sent.

To let businesses bring their own WhatsApp numbers through Embedded Signup,
Meta also requires the app's owner to be a **Tech Provider** (WhatsApp >
Quickstart > Become a Tech Provider), which has its own short review.

## 4. The screen recordings

One recording per permission, two to three minutes, no sound needed but add
captions or on-screen notes where a step is not obvious. Meta's reviewers must
be able to see: signing in to Shwari, the Meta login and consent screen, and
the permission being used.

Use a **test business** in Shwari and an Instagram account, Page and number
that are testers on the app. Show no real customer's details.

| Recording | Show, in order |
|---|---|
| **Instagram connect and basic** | Sign in to Shwari > Integrations > Instagram > Connect > Instagram's login and consent screen > back in Shwari, the account shown as connected with its username |
| **Instagram messaging** | From a second Instagram account, send a DM to the connected account > the message appears in Shwari's Inbox > the reply is sent (assistant, then a staff reply) > the reply arriving in Instagram |
| **Instagram publishing** | Marketing > upload a photo > plan and approve a post > Publish now > the post on the Instagram profile |
| **Page connect** (`pages_show_list`, `pages_manage_metadata`) | Integrations > Facebook Page > Connect > Facebook login and Page selection > the Page shown as connected |
| **Messenger** (`pages_messaging`) | Message the Page from a second Facebook account > it appears in the Inbox > reply > the reply in Messenger |
| **Page publishing** (`pages_read_engagement`, `pages_manage_posts`) | Marketing > approve a post for the Page > Publish now > the post on the Page |
| **WhatsApp connect** (`whatsapp_business_management`) | Integrations > WhatsApp > Connect > Meta's sign-up, choosing the account and number > the number shown as connected |
| **WhatsApp messaging** (`whatsapp_business_messaging`) | Message the number from a phone > it appears in the Inbox > the reply arriving on the phone > verify a payment and show the PDF receipt arriving |

Each submission also asks for **test credentials**: a Shwari login the
reviewer can use, with a test business already set up and channels connected.
Create a dedicated account for this and put its details only in Meta's
submission form.

## 5. Before pressing Submit

- [ ] Business verification complete.
- [ ] Privacy, terms and data-deletion pages open without signing in, and name the operator and a contact address.
- [ ] Deauthorize and data-deletion URLs saved in both the Facebook Login and Instagram settings.
- [ ] Each permission has its description and its recording attached.
- [ ] The reviewer's test login works, and its business is approved (not "waiting for approval") so its agents answer.
- [ ] Data handling questions answered (App Review > Data handling). The privacy page lists who processes data: Supabase, Vercel, NVIDIA, Brevo.
- [ ] The app's webhooks are subscribed to `messages` for Instagram, Page and WhatsApp Business Account.

## 6. After approval

1. Switch the app's mode to **Live** (toggle at the top of the dashboard).
2. Connect a non-tester account to confirm it works.
3. Reviews are per permission: if one is sent back, fix what the reviewer
   asks and resubmit that one; the others stand.

## What the app does when Meta calls

- **Deauthorize** (someone removed the app): the request's signature is
  checked against the app secret; the matching connection is switched off and
  its stored access token deleted; the event is recorded.
- **Data deletion** (someone asked for deletion): the same, and Meta is
  answered with a confirmation code and a link to
  `/data-deletion?code=...`, where the person can see what was done.
- If no connected account matches the ID Meta sends, nothing is closed
  silently: the platform admin gets an alert to check by hand.
- Requests made on the website's own form are recorded and alerted the same
  way, for a person to confirm and carry out.

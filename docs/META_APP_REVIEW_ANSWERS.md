# App Review: what to request, what to write, what to record

Companion to `META_APP_REVIEW.md`. This is the text to paste into each
"Describe how your app uses this permission or feature" box, and the exact
recording each one needs.

## 1. Remove these from the submission first

Meta rejects a submission that asks for a permission the app does not use, and
one rejection holds up everything in the same submission. The list in the
dashboard currently includes permissions this product never calls. Remove
them (App Review > Permissions and features > the bin icon, or untick them in
the use case):

| Remove | Why |
|---|---|
| `instagram_business_manage_insights` | The product shows no Instagram insights. |
| `instagram_business_manage_comments` | The product does not read or reply to comments. |
| `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` | These belong to Instagram via Facebook Login. This product uses Instagram Login (`instagram_business_*`) instead. Asking for both sets is a common cause of rejection. |
| `pages_read_user_content` | The product does not read posts or comments by other people on a Page. |
| `pages_manage_engagement` | The product does not reply to, hide or delete comments. |
| `pages_manage_ads`, `ads_read`, Marketing API Access Tier | No advertising features. |
| `catalog_management` | No Meta catalogue. The product keeps its own catalogue. |
| `leads_retrieval` | No lead ads. |
| `threads_basic` | No Threads features. |
| Meta oEmbed Read | Nothing is embedded. |
| Human Agent | The product replies inside the standard 24-hour window only. Request this later if you want staff to reply up to 7 days after a customer's last message. |
| Business Asset User Profile Access | Not used. |

## 2. Request these

| Permission | Used for |
|---|---|
| `instagram_business_basic` | Identify the connected Instagram account |
| `instagram_business_manage_messages` | Receive and answer Instagram DMs |
| `instagram_business_content_publish` | Publish the business's approved posts |
| `pages_show_list` | Let the owner choose which Page to connect |
| `pages_manage_metadata` | Subscribe the Page to message webhooks |
| `pages_messaging` | Receive and answer Messenger messages |
| `pages_read_engagement` | Read back a published post to confirm it went out |
| `pages_manage_posts` | Publish the business's approved posts to its Page. **Not in the current list: add it**, or leave Page publishing out of the submission. |
| `whatsapp_business_management` | Read the WhatsApp account and number, register the number, manage templates |
| `whatsapp_business_messaging` | Receive and answer WhatsApp messages |
| `business_management` | During WhatsApp sign-up, find the WhatsApp Business account the owner chose |
| `public_profile`, `email` | Granted by default with Facebook Login; no recording needed |

**Business description (one line, asked on the WhatsApp permissions):**
> We provide a customer messaging platform that lets small businesses answer their customers on WhatsApp, Instagram and Messenger from one inbox, with an AI assistant and their own staff.

## 3. Text for each box

Each answer covers the three things Meta asks: how the app uses the
permission, how that helps the person using the app, and why the app cannot
work without it.

### instagram_business_basic
> Shwari is a customer messaging platform for small businesses. A business owner connects their Instagram professional account from the Integrations page by signing in with Instagram and approving access.
>
> We use instagram_business_basic to read the connected account's ID and username. The username is shown on the Integrations page so the owner can see which account is connected, and the account ID is how we match incoming message webhooks to the right business. We do not read followers, and we do not read media other than to publish posts the business itself approves.
>
> The value to the business is being able to see and confirm exactly which Instagram account Shwari is acting for, and to disconnect it at any time.
>
> It is necessary because without the account ID we cannot tell which business an incoming message belongs to, and every other Instagram feature depends on it.

### instagram_business_manage_messages
> When a customer sends a direct message to a business's Instagram account, Shwari receives it through the messaging webhook and shows it in that business's Inbox. A reply is then sent back to the customer on the business's behalf, either by an AI assistant that the business has configured with its own products, prices and policies, or by a member of the business's staff typing in the Inbox. Staff can take over any conversation from the assistant with one click.
>
> We only send messages in reply to a customer who has messaged the business first, within Instagram's standard messaging window. We do not send unsolicited or bulk messages.
>
> The value to the business is that customers get an answer in seconds at any hour, orders and bookings made in the conversation are recorded, and staff see every conversation in one place alongside their other channels.
>
> It is necessary because receiving and replying to direct messages is the core function of the product; without this permission the business's Instagram customers cannot be answered at all.

### instagram_business_content_publish
> A business uploads its own photos and videos to the Marketing page in Shwari and reviews a proposed calendar of posts for the coming week, each with a caption. Nothing is published until the business approves it. At the scheduled time, Shwari publishes each approved post to the business's own Instagram account. The business can also press "Publish now" on an approved post.
>
> We only publish media the business itself uploaded, only to the account the business connected, and only posts it approved.
>
> The value to the business is keeping its Instagram active without having to remember to post each day, while staying in control of exactly what is published.
>
> It is necessary because publishing to the account is the function itself; without this permission approved posts cannot be published.

### pages_show_list
> When a business owner chooses to connect a Facebook Page, they sign in with Facebook. We use pages_show_list to get the list of Pages that person manages, so that we can show their names and let the owner choose which one to connect. If they manage only one Page, it is connected directly.
>
> The value to the owner is choosing the correct Page from their own list instead of typing an ID.
>
> It is necessary because without it we cannot know which Pages the person manages or obtain the Page they choose.

### pages_manage_metadata
> After the owner chooses a Page, we use pages_manage_metadata to subscribe that Page to our webhook for message events. This is what makes Messenger messages sent to the Page arrive in the business's Inbox in Shwari. When the business disconnects the Page, messages stop arriving.
>
> The value to the business is that customer messages appear in its Inbox the moment they are sent, without the owner configuring anything.
>
> It is necessary because without subscribing the Page to webhooks we receive no messages, and the business's Messenger customers cannot be answered.

### pages_messaging
> When a customer sends a message to the business's Facebook Page in Messenger, Shwari receives it and shows it in the business's Inbox. A reply is sent back on the business's behalf, either by an AI assistant the business has configured with its own products, prices and policies, or by a member of staff typing in the Inbox. Staff can take over any conversation at any time.
>
> We reply only to customers who have messaged the Page first, using the standard RESPONSE messaging type within the 24-hour window. We do not send promotional or unsolicited messages.
>
> The value to the business is fast answers for its customers at any hour, with orders, bookings and payments recorded from the conversation and every channel in one inbox.
>
> It is necessary because sending and receiving Messenger messages for the Page is the core function; without it the business's Messenger customers cannot be answered.
>
> Steps to reproduce: sign in to Shwari with the test login provided. Open Integrations; the test Page is connected. From any Facebook account, send a message to the test Page in Messenger. Open Inbox in Shwari: the message appears and a reply is sent, which arrives in Messenger. Type a reply in the Inbox box and press Send to see a staff reply.

### pages_read_engagement
> After Shwari publishes a post the business approved to its Facebook Page, we use pages_read_engagement to read that post back, to obtain its link and confirm it was published. The link is shown to the business on the Marketing page next to the post, marked as published.
>
> The value to the business is proof that a scheduled post actually went out, with a link to view it.
>
> It is necessary because without it we cannot confirm publication or show the business the published post.

### pages_manage_posts
> A business uploads its own photos and videos to the Marketing page in Shwari and approves a calendar of posts with captions. At the scheduled time, or when the business presses "Publish now", we use pages_manage_posts to publish each approved post to the business's own Facebook Page.
>
> We publish only media the business uploaded, only posts it approved, and only to the Page it connected.
>
> The value to the business is keeping its Page active without posting by hand each day, while approving everything that is published.
>
> It is necessary because creating the post on the Page is the function itself.

### whatsapp_business_management
> A business connects its WhatsApp number from the Integrations page through Meta's Embedded Signup, where the owner chooses or creates a WhatsApp Business account and phone number. We use whatsapp_business_management to read the account and phone number the owner selected, to register that number for the Cloud API, to subscribe our app to its message webhooks, and to create and check the message templates used for receipts, invoices and alerts to the business's own staff.
>
> The value to the business is a WhatsApp number that is set up and ready to receive customer messages without the owner handling any technical configuration.
>
> It is necessary because without it we cannot identify the business's number, register it, receive its messages, or create the templates WhatsApp requires for messages sent outside the 24-hour window.

### whatsapp_business_messaging
> When a customer sends a WhatsApp message to the business's number, Shwari receives it and shows it in the business's Inbox. A reply is sent on the business's behalf, by an AI assistant the business has configured with its own products, prices and policies, or by a member of staff. When a member of staff verifies a customer's payment, the customer is sent a confirmation and their receipt as a PDF document; invoices are sent the same way.
>
> Free-form messages are sent only within 24 hours of the customer's last message. Outside that window only approved templates are used. We do not send marketing broadcasts.
>
> The value to the business is that customers are answered immediately on the channel they prefer, and receive proper receipts and invoices in the chat.
>
> It is necessary because sending and receiving WhatsApp messages for the business's number is the core function of the product.

### business_management
> During WhatsApp Embedded Signup the owner chooses which WhatsApp Business account to share with Shwari. In some cases Meta grants access without naming the account in the token. We use business_management only then, to list the businesses the owner shared and find the WhatsApp Business account under them, so that we connect the account the owner selected. We do not read or change any other business asset, user, ad account or setting.
>
> The value to the owner is that the WhatsApp connection completes correctly instead of failing with no account found.
>
> It is necessary because without it, when the token does not name the account, we cannot determine which WhatsApp Business account the owner chose.

## 4. The recordings

Meta wants a real screen recording per permission: a person using the app,
start to finish, **including Meta's own login and consent screen**. Name the
files as below. No sound is needed; add a short caption where a step is not
obvious. Use a test business and tester accounts, and show no real customer.

Windows: `Win + Alt + R` records the active window. Keep the browser at
1440 x 900 or larger.

| File | Covers | Show, in order |
|---|---|---|
| `01-instagram-connect.mp4` | `instagram_business_basic` | Sign in to Shwari > Integrations > Instagram > Connect > Instagram's login > the consent screen listing the permissions > Allow > back in Shwari with the account's username shown as Connected |
| `02-instagram-messages.mp4` | `instagram_business_manage_messages` | Start at Integrations showing Instagram connected (or repeat the connect) > from a second Instagram account on a phone or another window, send a DM to the connected account > Shwari Inbox: the message appears > the assistant's reply > type a staff reply and Send > both replies shown arriving in Instagram |
| `03-instagram-publish.mp4` | `instagram_business_content_publish` | The connect and consent screen > Marketing > Library > upload a photo > Calendar > approve a post > Publish now > the post on the Instagram profile |
| `04-page-connect.mp4` | `pages_show_list`, `pages_manage_metadata` | Integrations > Facebook Page > Connect > Facebook login > the Page selection screen > Allow > the Page shown as Connected > press Check to show it is receiving |
| `05-page-messages.mp4` | `pages_messaging` | The connect and consent screen > from a second Facebook account, message the Page > Shwari Inbox: the message, the reply, a staff reply > the replies arriving in Messenger |
| `06-page-publish.mp4` | `pages_manage_posts`, `pages_read_engagement` | The connect and consent screen > Marketing > approve a post for the Page > Publish now > the post marked Published with its link > the post on the Page |
| `07-whatsapp-connect.mp4` | `whatsapp_business_management`, `business_management` | Integrations > WhatsApp > Connect > Meta's sign-up: choose the business, the WhatsApp account and the number > Finish > the number shown as Connected > Settings > Notifications showing the alert template status |
| `08-whatsapp-messages.mp4` | `whatsapp_business_messaging` | From a phone, message the business number > Shwari Inbox: the message and reply > the reply on the phone > Payments > Verify a payment > the confirmation and PDF receipt arriving on the phone |

Meta also checks that the app has **made at least one real API call with each
permission** in the last 30 days ("Ensure that you have performed required API
test calls"). Doing each flow above once with a tester account satisfies it.

## 5. Order of work

1. Get Instagram connecting again with a tester account (it is currently refused).
2. Remove the unused permissions; add `pages_manage_posts`.
3. Create the reviewer's test login in Shwari, with a business that is approved and has each channel connected.
4. Do each flow once (this makes the required API calls), then record it.
5. Paste the text from section 3, attach each recording, answer the data-handling questions, submit.

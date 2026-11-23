# Android and iOS app plan

How the platform becomes an app in the Play Store and the App Store. Nothing
here is built yet; this is the plan and the decisions it needs.

## What the app is for

A business owner or their staff, away from a desk, who needs to:

1. **Know at once** that a payment needs checking, an order came in, or a
   customer is waiting for a person. This is the reason to have an app at all:
   a real push notification on a locked phone.
2. **Act in a few taps:** verify the payment, reply in the Inbox, mark an
   invoice paid, approve the week's posts.
3. **See how the day is going:** the Overview figures.

Setting up the business, connecting channels, designing receipts and managing
the team stay possible in the app, but they are desk work and the web
dashboard remains the best place for them.

## Recommended approach: wrap the existing app, add what a phone adds

Three ways to get into the stores:

| Approach | What it is | Time | Verdict |
|---|---|---|---|
| **Installable web app (PWA)** | The current site, installable from the browser, with web push | About a week | Do first: cheap, and useful by itself on Android |
| **Capacitor shell** | The current React app packaged as a real Android and iOS app, with native push, biometrics and file handling | 4 to 6 weeks to both stores | **Recommended** |
| **React Native rewrite** | Every screen rebuilt natively | 4 to 6 months, and two codebases to keep in step | Not now |

**Why Capacitor.** The dashboard is already a responsive React app that has
just been reviewed and fixed at phone size, with a bottom bar and touch-sized
controls. Capacitor runs that same code inside a native app and gives it
native abilities through plugins. One codebase keeps serving web, Android and
iOS, so a feature shipped once ships everywhere. A rewrite would freeze new
features for months to reproduce what already works.

**The honest limit.** It is a web view in a native frame. It will feel like a
very good mobile site, not like a hand-built native app: scrolling and
transitions are the browser's. For a business tool that is the right trade.
If the app later proves to be where most use happens, the two or three screens
used most (Inbox, Payments) can be rebuilt natively one at a time without
throwing the rest away.

## What gets built

### Phase 0: Installable web app (about 1 week)

Useful on its own, and the groundwork for everything after.

- App manifest, icons and splash screens; "Add to Home Screen" prompt.
- A service worker that caches the app shell, so it opens instantly and shows
  a clear offline screen instead of a browser error.
- Web push for notifications (works on Android and desktop; on iPhone only
  once installed to the Home Screen, which few people do, hence Phase 1).

### Phase 1: The apps (3 to 4 weeks)

- **Capacitor project** for Android and iOS around the existing build.
- **Push notifications** through Firebase Cloud Messaging (Android) and Apple
  Push Notification service (iOS):
  - a `device_tokens` table (user, business, platform, token, last seen);
  - the server sends a push wherever it writes a notification today, to the
    people whose role should see it;
  - tapping a push opens the right screen (the payment, the conversation);
  - per-person switches for which alerts reach their phone, beside the
    existing WhatsApp and Telegram alert settings.
- **Sign-in that survives:** the session kept in the device's secure storage,
  so people are not signed out by the system clearing web storage.
- **Unlock with fingerprint or face** (optional per person). The app shows
  customer data and can verify payments; a phone left on a counter should not
  be an open till.
- **Connecting Instagram, WhatsApp and Facebook from the app.** Meta's sign-in
  must open in the phone's own browser and return to the app through a
  registered link; it cannot run inside the app's web view. The existing
  return addresses stay, with an app link added.
- **Files:** open and share invoice and receipt PDFs with the phone's share
  sheet; pick photos and video from the gallery or camera for Marketing.
- **The app badge:** the count on the icon mirrors the dots in the menu.
- **Deep links:** `ai.tryavora.space/inbox/...` opens in the app when it is
  installed.

### Phase 2: Store release (1 to 2 weeks, plus review time)

- Store listings: name, description, screenshots (from the screen recordings
  already planned), privacy details.
- **Account deletion inside the app.** Both stores require that anyone who can
  create an account in an app can also delete it there. Today there is no
  delete-my-account or delete-my-business action; it has to be built.
- Privacy policy and terms pages on the website, linked from the listing.
- Test tracks: internal testing, then closed testing with a few real
  businesses, then public.
- Apple review typically takes one to three days per submission; expect at
  least one rejection and resubmission on a first app.

### Phase 3: Make it feel at home (ongoing, after launch)

- Offline reading of recent conversations and today's orders; replies written
  offline are queued and sent when the connection returns.
- Quick actions from the notification itself (Verify, Reply) without opening
  the app.
- Home-screen widgets (payments waiting, unread chats).
- A tablet layout.

## What changes on the server

- `device_tokens` table and a push sender, called from the same place that
  writes notifications and sends WhatsApp and Telegram alerts.
- Allow the app's origin (`capacitor://localhost`, `https://localhost`) in the
  API's allowed origins.
- Account deletion and data export endpoints.
- An "app version" check so an old app can be told to update.

Nothing else: the app uses the same API, the same roles and the same database
rules as the web dashboard.

## What you need to provide

| Item | Cost | Why |
|---|---|---|
| **Apple Developer Program** membership | US$99 a year | Required to publish on the App Store. Enrolling as a company needs a D-U-N-S number, which can take a couple of weeks; start early. |
| **Google Play Console** account | US$25 once | Required to publish on Google Play. New personal accounts must run a closed test with at least 12 testers for 14 days before going public; a company account avoids that. |
| **A Mac, or a cloud build service** | A Mac, or roughly US$0 to 50 a month | iOS apps can only be built and signed with Apple's tools. This computer runs Windows, so iOS builds need a borrowed or rented Mac, or a hosted build service (for example Codemagic or GitHub's macOS runners). Android builds work from Windows. |
| **Firebase project** | Free at this scale | Carries push notifications for Android. |
| **App name, icon and brand colours** | - | The name in the stores; whether it is "Shwari" or another name. |
| **Privacy policy and terms** | - | Required by both stores and by Meta's App Review. |

## Risks

| Risk | What we do about it |
|---|---|
| **Apple rejects it as "just a website"** (guideline 4.2) | Ship real native features from the first submission: push, biometrics, share sheet, deep links, badge. Apps that only wrap a site are the ones rejected. |
| **Meta sign-in inside an app** | Open it in the system browser and return by app link, as above. Tested on real phones before submission. |
| **Push not arriving** | Android phones from some makers kill background apps. Push through Firebase is the reliable route; in-app polling stays as the fallback when the app is open. |
| **Customer data on a lost phone** | Biometric lock, session expiry, and the owner's existing ability to remove a staff member, which ends that person's access on every device. |
| **Review delays before a launch date** | Submit two weeks before any date that matters; keep the web dashboard as the fallback. |
| **Subscriptions** | If the platform later charges businesses inside the app, Apple and Google take a share of in-app purchases. Selling subscriptions on the website and not in the app avoids that, within each store's rules. Decide before billing is built. |

## Order of work

1. Decisions below, and start the Apple and Google enrolments (they have the
   longest waits).
2. Phase 0: the installable web app.
3. Phase 1: Android first (it can be built and tested here), then iOS.
4. Account deletion, privacy pages, store listings.
5. Closed testing with two or three real businesses for a week.
6. Public release.

Realistically **six to eight weeks** from the decisions to both stores, with
the Android app usable by testers after about three.

## Decisions needed

1. **Approach:** Capacitor shell, as recommended?
2. **Name and icon** for the stores.
3. **Who publishes:** your company's developer accounts (recommended, and
   needed for the faster Google route) or personal ones?
4. **iOS builds:** a Mac you have access to, or a cloud build service?
5. **Who is the app for at launch:** owners and staff of a business only
   (recommended), or the platform admin console too?
6. **Fingerprint or face unlock:** on by default, or opt-in?

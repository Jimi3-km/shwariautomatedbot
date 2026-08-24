# Sign-up, sign-in, password reset

## What sends the emails

**Supabase Auth.** There is no SendGrid, Resend, or nodemailer anywhere in this
codebase, and there shouldn't be — signup confirmation and password-reset emails
are sent by Supabase's own SMTP when the app calls `auth.signUp` and
`auth.resetPasswordForEmail`. "Configuring email" therefore means configuring
**the Supabase project**, not this repo.

The three flows, all in `src/pages/AuthScreen.tsx` and `src/App.tsx`:

| Flow | Client call | Email Supabase sends |
|---|---|---|
| Sign up | `auth.signUp({ email, password, emailRedirectTo })` | Confirm your account |
| Sign in | `auth.signInWithPassword` | — |
| Reset password | `auth.resetPasswordForEmail(email, { redirectTo })` | Reset your password |
| Resend confirmation | `auth.resend({ type: 'signup' })` | Confirm your account |

Verified against the live project (`dmhqqfxlmvaeeyxdlthd`) on 2026-08-18: three
accounts exist, all three confirmed, three confirmation emails sent. So the
signup → confirm path already works. What was broken was the *second half* of
reset, fixed in this change — see below.

---

## The one thing that was actually broken: finishing a reset

`resetPasswordForEmail` was already sending the email. But the link it sends
lands the user back on the app with a one-time recovery token, and there was no
screen to set a new password — supabase-js turned the token into a session and
the user was dropped into the dashboard **still on their old password**, with no
way to change it. The reset email was a dead end.

Now:

- `App.tsx` reads `type=recovery` from the URL hash *before* supabase-js strips
  it, and also listens for the `PASSWORD_RECOVERY` event.
- Either signal routes to `SetNewPassword`, which calls `auth.updateUser`.
- Only after the new password is set does the user continue into the app.

No dashboard config is needed for this — it is pure client code.

---

## Supabase dashboard configuration (required for production)

All under **Authentication** in the Supabase dashboard for project
`dmhqqfxlmvaeeyxdlthd`.

### 1. URL Configuration — the redirect allowlist

Signup and reset both send the user back to `window.location.origin`. Supabase
only honours a redirect origin that is on the allowlist; anything else silently
falls back to the Site URL, which is the classic "the link took me to the wrong
place / to localhost" bug.

**Site URL:** `https://shwariautomatedbot.vercel.app`

**Redirect URLs** — add every origin the app is served from:

```
https://shwariautomatedbot.vercel.app/**
https://shwariautomatedbot-git-*-jimmies-projects-da19fb09.vercel.app/**
http://localhost:3000/**
```

The middle line is the Vercel **preview** pattern — without it, a confirmation
or reset link opened from a preview deploy bounces to production.

### 2. Email — confirmations

**Authentication → Providers → Email**: keep **Confirm email** ON. This is what
makes `signUp` send a confirmation and blocks sign-in until the address is
verified. It is currently on (the live users are all confirmed).

### 3. Email — SMTP (the real production gap)

Out of the box Supabase uses its **built-in SMTP**, which is deliberately
crippled for production:

- it only delivers to **members of your Supabase team**, so a real customer's
  signup email never arrives;
- it is rate-limited to a handful of messages per hour.

The three confirmed accounts got through only because they are team addresses.
**Before real users sign up, set custom SMTP:**

**Authentication → Emails → SMTP Settings → Enable custom SMTP**, then fill in a
transactional provider (Resend, SendGrid, Postmark, Amazon SES, or a Google
Workspace account). Typical fields:

```
Host:        smtp.resend.com          (example)
Port:        465
Username:    resend
Password:    <the provider's API key / SMTP password>
Sender email: no-reply@yourdomain.com  (must be a verified sender/domain)
Sender name:  Shwari
```

Verify the sender domain (SPF/DKIM) with whichever provider you pick, or the mail
lands in spam. Nothing about this touches the code — it is entirely dashboard.

### 4. Email templates (optional, recommended)

**Authentication → Emails → Templates.** The default "Confirm your signup" and
"Reset password" templates work as-is. If you rebrand them, keep the
`{{ .ConfirmationURL }}` token — that is the link the flows above depend on.

---

## How to test each flow end to end

Against the deployed app (localhost works too if `http://localhost:3000/**` is
in the redirect allowlist):

1. **Sign up** — create an account with a real inbox. Expect a "Confirm your
   account" email. If it does not arrive, that is SMTP (§3), not the app; the
   sign-up screen now shows **Resend confirmation email** as the recovery path.
2. **Confirm** — click the link. It returns to the app, the session is created,
   and you land in onboarding or the dashboard.
3. **Sign in** — sign out, sign back in with the password. Signing in before
   confirming shows "Please confirm your email first" and offers a resend.
4. **Reset** — from the sign-in screen choose **Forgot password?**, submit the
   email, click the link in the "Reset your password" email. You now get the
   **Choose a new password** screen; set it and you are signed in with the new
   password.

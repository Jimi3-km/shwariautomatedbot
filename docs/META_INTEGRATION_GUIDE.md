# Meta Embedded Onboarding Guide for Shwari

This guide explains how to allow your SaaS customers to connect their WhatsApp and Instagram accounts directly to Shwari in a single click, **without** them needing to create Meta Developer accounts or API keys.

This is achieved using **Meta's Embedded Signup** (for WhatsApp) and **Facebook Login for Business** (for Instagram). 

---

## The Architecture Overview

Instead of customers bringing their own API keys, **Shwari acts as a Meta Tech Provider**. 
You maintain a single Meta App centrally, and your customers grant Shwari permission to manage their messaging via a secure OAuth popup.

### 1. Prerequisites (Central Setup)
1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Create an App of type **Business**.
3. Add the **WhatsApp** and **Facebook Login for Business** products to this app.
4. Go through **Business Verification** for Shwari (required to take the app live).
5. Request **Advanced Access** via App Review for the following permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   - `instagram_manage_messages`
   - `instagram_basic`
   - `pages_manage_metadata`
   - `business_management`

---

## Part 1: WhatsApp Embedded Signup

Meta provides a pre-built JavaScript SDK popup that walks the user through creating a WhatsApp Business Account (WABA) and verifying their phone number.

### 1. Configure the Flow in Meta
- In your Meta App Dashboard, go to **Facebook Login for Business > Configurations**.
- Create a configuration using the "WhatsApp Embedded Signup" template.
- Copy the **Configuration ID**.

### 2. Frontend Implementation (React)
On your `/settings/channels` page, load the Facebook SDK and trigger the flow:

```javascript
// 1. Load the SDK
useEffect(() => {
  window.fbAsyncInit = function() {
    FB.init({
      appId      : 'YOUR_META_APP_ID',
      cookie     : true,
      xfbml      : true,
      version    : 'v20.0'
    });
  };
}, []);

// 2. Trigger the popup
function launchWhatsAppSignup() {
  FB.login((response) => {
    if (response.authResponse) {
      const code = response.authResponse.code;
      // Send this code to your backend: /api/channels/oauth/whatsapp
    }
  }, {
    config_id: 'YOUR_CONFIGURATION_ID',
    response_type: 'code',
    override_default_response_type: true
  });
}
```

### 3. Backend Implementation (Node/Express)
When the frontend sends the `code`, your backend exchanges it for a token and subscribes the number:

1. **Exchange Code:** Call `GET https://graph.facebook.com/v20.0/oauth/access_token` with `client_id`, `client_secret`, and the `code`. You receive a System User Access Token.
2. **Fetch WABA Details:** Use the token to fetch the `waba_id` and `phone_number_id` the user just created.
3. **Register Phone:** Call `POST https://graph.facebook.com/v20.0/{phone_number_id}/register` to link it to Shwari.
4. **Save to DB:** Save the `phone_number_id` and the `access_token` to the tenant's record in Supabase.

---

## Part 2: Instagram Messaging Onboarding

Instagram onboarding uses the same pop-up mechanism but requests different permissions so the user can link their Instagram Professional account.

### 1. Frontend Implementation
```javascript
function launchInstagramSignup() {
  FB.login((response) => {
    if (response.authResponse) {
      const accessToken = response.authResponse.accessToken;
      // Send this token to your backend: /api/channels/oauth/instagram
    }
  }, {
    scope: 'instagram_basic,instagram_manage_messages,pages_manage_metadata',
    return_scopes: true
  });
}
```

### 2. Backend Implementation
Once your backend receives the user's `accessToken`, you must find their linked Instagram account:

1. **Get User Pages:** Call `GET https://graph.facebook.com/v20.0/me/accounts?access_token={accessToken}`. This returns a list of Facebook Pages the user manages, along with a `Page Access Token` for each.
2. **Get Instagram ID:** For the selected page, call `GET https://graph.facebook.com/v20.0/{page_id}?fields=instagram_business_account&access_token={page_access_token}`.
3. **Save to DB:** Save the `instagram_business_account.id` and the `Page Access Token` to the tenant's record. This token never expires automatically, but you should handle re-auth if the user changes passwords.

---

## Part 3: Webhooks (Receiving Messages)

Instead of one webhook per customer, Meta will send **ALL** customer messages to a single webhook endpoint on Shwari (e.g., `https://shwariautomatedbot.vercel.app/api/webhooks/meta`).

1. Set this up in your Meta App Dashboard under the **Webhooks** product.
2. When a payload hits your endpoint, look at the `metadata.phone_number_id` (for WhatsApp) or `recipient.id` (for Instagram).
3. Query Supabase to find which Shwari `tenant_id` owns that number/account.
4. Route the message to that tenant's inbox and trigger the AI agent for that tenant.

> **💡 Best Practice:** For multi-tenant SaaS, you only need exactly *one* Meta App and *one* Webhook endpoint. The database routing layer handles assigning incoming messages to the correct Shwari business.

# Shwari iPhones Agent 

A complete AI-powered WhatsApp Agent system for a modern phone shop, integrated seamlessly with N8N and Supabase/Neon PostgreSQL.

## Features Let's Dive In!

- 📊 **Unified Dashboard**: Clean, dark-mode React Dashboard for store admins.
- 💬 **Lead Pipeline Management**: Track intent, urgency and sales stage of potential buyers.
- 📱 **Real-time Inventory Management**: Track and update Shwari iPhone pricelist models from a click.
- 🤖 **N8N Automation Sync**: Full workflow engine for capturing Meta WhatsApp webhooks, generating LangChain agent replies mapped securely back to the store dashboard.

## Setup Instructions

### 1. Database Configuration
1. Obtain your Supabase or Neon Postgres Connection String.
2. Clone `.env.example` to `.env` and assign `NEON_DATABASE_URL`.
3. The server will **auto-initialize** your tables (`iphone_pricelist` and `leads`) on its first run!

### 2. N8N Automation System
1. Open N8N (`http://localhost:5678`) locally or on the cloud.
2. Select **Import from File...** and upload the included `n8n-workflow.json` configuration file.
3. Once imported, you will have the fully designed AI Automation loop containing Intent Classifiers, Route Values, the Dashboard API, and WhatsApp triggers. 
4. Update the **WhatsApp Trigger** and **WhatsApp Target Reply** tokens inside N8N to point to your live Meta Business keys.
5. In your N8N Webhooks configuration within the automation, obtain the generic dashboard endpoint to paste inside your App Config on the Dashboard.

### 3. Server Startup
To boot up the unified Full Stack App (Express Backend Proxy + React FrontEnd locally):
```bash
npm install
npm run dev
```

Dashboard will instantly deploy on **http://localhost:3000**. Enjoy!

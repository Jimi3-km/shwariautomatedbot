# Shwari iPhones WhatsApp AI Agent

A full-stack WhatsApp AI agent system for Shwari iPhones, managing incoming customer requests via WhatsApp, using a Neon PostgreSQL database and Claude 3.5 Haiku via Anthropic to reply contextually.

## Features
- **Express Backend:** Webhooks for Meta WhatsApp API and REST endpoints for the dashboard.
- **Vite/React Dashboard:** Manage the phone pricelist, monitor conversation logs, and trigger n8n workflows.
- **Anthropic AI (Claude):** Powered by Claude 3.5 Haiku, the assistant uses retrieving-augmented generation (RAG) based on the Neon DB pricelist to answer user queries accurately.
- **Neon PostgreSQL DB:** Serverless database auto-seeding.
- **WhatsApp Cloud API Integration:** Send and receive messages instantly.

## Setup Instructions

### Environment Variables
Configure your credentials in the **Settings** panel of the dashboard or update your `.env` file with the following:
\`\`\`
NEON_DATABASE_URL=your_neon_db_url
ANTHROPIC_API_KEY=your_anthropic_api_key

# Meta WhatsApp Config
META_ACCESS_TOKEN=your_fb_access_token
META_PHONE_NUMBER_ID=your_phone_id
META_VERIFY_TOKEN=shwari_verify_2024

# n8n Automation
N8N_API_URL=https://your-n8n.com/webhook/{id}
N8N_WORKFLOW_ID=your_workflow_id
\`\`\`

### Local Webhook Setup (ngrok)
To allow Meta's WhatsApp Cloud API to communicate with your local development server:

1. Download and install [ngrok](https://ngrok.com/).
2. Run ngrok on port 3000:
   \`\`\`bash
   ngrok http 3000
   \`\`\`
3. Go to the [Meta for Developers Console](https://developers.facebook.com/).
4. Under "WhatsApp > Configuration" in your app, click **Edit** on your Webhook configuration:
   - **Callback URL:** `https://<YOUR_NGROK_URL>/webhook/whatsapp`
   - **Verify Token:** `shwari_verify_2024`
5. Click **Verify and Save**.

### Running the App
The full-stack app requires `tsx` to run the Express and Vite middleware.

\`\`\`bash
# Install dependencies
npm install

# Start the dev server
npm run dev
\`\`\`

Open your browser to `http://localhost:3000` to view the dashboard. Configure your credentials under the **Settings** tab. The database will automatically initialize and seed itself once you add a valid Neon DB URL and save.

# Shwari Agentic Architecture

The Shwari bot uses an entirely native AI agent architecture powered by NVIDIA NIM APIs and structured tool execution. This architecture eliminates the need for external workflow builders like n8n, directly handling multi-channel chat, real-time tool calling, and dynamic department routing inside the same Express.js backend.

## 1. High-Level Pipeline

When a message arrives from any channel (WhatsApp, Instagram, Telegram, Webchat):

1. **Ingestion (`channels/`)**: The webhook validates the signature, normalizes the event, and passes it to the generic `inbound.ts` layer.
2. **Persistence (`inbound.ts`)**: The message is stored securely in the `messages` table of the tenant's database to guarantee zero data loss.
3. **Dispatch (`dispatch.ts`)**: The message is handed to the AI router. It checks for special admin commands (like pairing codes) and then invokes the LLM.
4. **Agent Execution (`agent.ts`)**: The LLM analyzes the conversation history, decides if it needs to query the database or take an action via a tool, executes it, and generates a response.
5. **Reply (`providers/`)**: The final generated text is sent back through the respective channel's outbound API (e.g. Meta Graph API, Telegram Bot API).

---

## 2. Dynamic Department Routing

Shwari supports multi-role intelligence. Instead of one massive prompt, the agent decides its own persona based on the context of the user's message.

- The system currently supports three distinct departments/roles (defined in `roles.ts`):
  - **Support**: Handles general FAQs, order statuses, and customer inquiries.
  - **Sales**: Focuses on product discovery, recommendations, and closing deals.
  - **Admin**: An exclusive, authenticated role for the business owner to manage their store via chat (e.g., checking overall inventory, summarizing sales).
- In `dispatch.ts`, `chooseDepartment()` runs a fast, lightweight LLM classification to categorize the incoming user message into the correct department before running the full agent loop.

---

## 3. The Agent Loop (`agent.ts`)

The core of the architecture lives in `runAgentTurn()`. This is an autonomous loop that uses **ReAct (Reasoning and Acting)** principles.

1. **Context Gathering**: The agent retrieves the last 20 messages of the conversation from the Supabase database.
2. **System Prompt Construction**: The system prompt (`prompts.ts`) is dynamically built depending on the assigned department. It injects real-time tenant information (like store name, business context) and instructions.
3. **Tool Injection**: The backend provides the LLM with a schema of JSON functions (Tools) it is allowed to call.
4. **Execution Cycle**:
   - The LLM generates a response. If it realizes it needs data (e.g., a customer asks "what shirts do you have?"), it pauses its text generation and outputs a `tool_calls` JSON payload.
   - The backend catches this, executes the local TypeScript function (e.g., querying Supabase for products).
   - The backend appends the JSON result to the conversation array and prompts the LLM again.
   - The LLM reads the tool output and synthesizes a natural language answer.
5. **Audit Logging**: Every LLM step, including the thinking process, token usage, tool arguments, and tool results, is saved to the `audit_events` table for Quality Assurance (QA) and debugging.

---

## 4. Agentic Functions (Tools)

The tools are defined in `src/server/ai/tools/` and are strictly bound to specific departments to limit the AI's blast radius (e.g., a customer chatting with Support cannot accidentally trigger an Admin inventory wipe).

### Support & Sales Tools
- **`list_products`**: Queries the `products` table in Supabase. It supports fuzzy text search and status filtering (e.g., finding only 'active' products).
- **`get_product`**: Retrieves detailed information, pricing, and variants for a specific product ID.
- **`check_order_status`**: (Conceptual) Allows customers to check their order status.

### Admin Tools
- **`create_product` / `update_product`**: Allows the admin to modify their inventory via chat. The agent converts natural language ("Add a red shirt for $20") into structured database upserts.
- **`get_sales_summary`**: Aggregates revenue and order counts for the admin.

All tools enforce Tenant Isolation — the `tenantId` is injected by the backend during execution, ensuring the agent can never query or leak data from another business using the platform.

---

## 5. Model Fallbacks & Reliability (`llm.ts`)

Since AI APIs can experience latency or outages, Shwari's LLM engine includes robust fallback mechanisms:
- It relies on NVIDIA NIM (e.g., `meta/llama-3.2-11b-vision-instruct`).
- If a request times out or returns a `500 Internal Server Error`, `complete()` automatically catches the exception.
- It retries the request using a secondary fallback profile, ensuring the bot remains online and responsive even during minor upstream disruptions.

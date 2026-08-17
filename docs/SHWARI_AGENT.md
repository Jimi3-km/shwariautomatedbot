# Shwari Agent

The business owner talks to Shwari in plain English. Shwari learns the
business, writes what it learns into structured tables the other agents read,
and stays on afterwards as the owner's AI administrator.

This document covers what was built in milestone 1, where it sits in the
existing system, and how to run it.

---

## Where it sits

Nothing was replaced. One branch was added in front of the working pipeline.

```
Telegram ─┐
Web chat ─┼─► inbound.ts ──► dispatch.ts ──┬─► Shwari      (the owner)
Meta     ─┘   resolve                      └─► n8n         (customers)
              claim
              persist
```

`dispatch.ts` is the whole seam. Three outcomes:

1. the message is a pairing code → redeem it
2. the sender is a known administrator → Shwari answers, in this process
3. anyone else → `forwardToPipeline`, exactly as before

Case 3 is the default and is unchanged, so an existing tenant with a sales
workflow in n8n keeps working with no configuration at all.

### What moved

**Telegram now arrives here first.** It used to post straight to n8n, which had
two consequences: the customer's message was only recorded *after* the agent
answered — so a conversation staff had taken over recorded nothing — and no
Telegram message was ever visible to this application, which meant Shwari could
not be reached on the one channel every tenant already has.

Telegram now follows the same path web chat and Meta follow. n8n still answers
customers; it is called from the dispatcher rather than being the front door.

Bots connected before this change still point at n8n. The Integrations page
flags it ("delivering messages somewhere else"), and the fix is to reconnect.

### What stayed in n8n

The sales pipeline, scheduled follow-ups, notifications and every external
integration. n8n is the execution layer. What moved into the application is
tenant context, agent definitions, tools, permissions, memory and the audit —
none of which belongs in a workflow node.

---

## Configuration

One new required variable, one that changed meaning.

```bash
# The model Shwari reasons with. NVIDIA's hosted open-model API.
SHWARI_API_KEY=nvapi-...

# Optional. Defaults shown.
SHWARI_MODEL=meta/llama-3.3-70b-instruct
SHWARI_API_BASE=https://integrate.api.nvidia.com/v1

# Now also where Telegram delivers updates. Previously only used by Meta.
PUBLIC_API_URL=https://shwariautomatedbot.vercel.app
```

Get the key from [build.nvidia.com](https://build.nvidia.com) → any model →
**Get API Key**. The same key works for every model on that endpoint, so
changing `SHWARI_MODEL` needs no new credential.

`SHWARI_API_BASE` exists because nothing in the client is NVIDIA-specific
beyond the default: any OpenAI-compatible endpoint that supports tool calls
works, and switching is a configuration change rather than a code change.

`N8N_TELEGRAM_WEBHOOK_URL` is no longer read. Leave it or remove it.

Check it landed:

```bash
curl -s "$PUBLIC_API_URL/api/setup/status" \
  -H "authorization: Bearer <dashboard JWT>" | jq .shwari
```

---

## Agents are rows, not code

An agent is a row in `agents`: role, name, objective, instructions, tools,
permissions, escalation, status. The same engine (`src/server/ai/agent.ts`)
runs every one of them.

The split that matters is between the **blueprint** and the **instructions**.

- The blueprint (`src/server/ai/roles.ts`) is the floor: the universal rules,
  the role's own rules, and the tool set. The owner cannot reach it.
- `instructions` is what the owner shapes conversationally. It is *appended* to
  the floor and fenced, never substituted for it.

That is why "make the sales agent more proactive" is a safe request and "ignore
your pricing rules" is not.

Three roles exist now: `manager` (Shwari), `sales`, `support`. The manager is
created on first use; the other two the owner asks for.

### Shwari cannot modify itself

`configure_agent` and `activate_agent` refuse `role: 'manager'`, and neither
tool exposes a `tools`, `permissions` or `status` field for any agent. A
manager that could grant itself a capability is not a manager, so the guard
lives in the tool rather than in a prompt the model could be talked out of.

---

## The tool layer

Agents do not touch the database. Every call goes through `runTool`, which:

1. checks the tool is one **this agent** is configured for
2. validates the arguments before anything is written
3. **drops any `tenant_id` the model supplied** and uses the context's instead
4. records the call, its arguments and its outcome in `agent_tool_calls`

`runTool` never throws. A failure comes back as data so the agent can correct
itself or explain, and an internal error message is logged rather than narrated
to the model.

Current tools:

| Area | Tools |
|---|---|
| Profile | `get_business_profile`, `update_business_profile` |
| Services | `list_services`, `save_service`, `remove_service` |
| Hours | `get_opening_hours`, `set_opening_hours` |
| Knowledge | `search_business_knowledge`, `save_business_fact` |
| Learning | `record_knowledge_gap`, `list_knowledge_gaps` |
| Team | `list_team`, `recommend_team`, `add_agent`, `configure_agent`, `activate_agent` |
| Readiness | `setup_status` |

Adding a tool to the catalogue does not hand it to anyone: what an agent may
call is its `tools` column, enforced on every invocation.

---

## Memory

Three kinds, kept apart deliberately.

**Business memory** — `business_facts`, `services`, `business_hours`, and the
tenant profile. Durable, structured, tenant-scoped.

**Conversation memory** — the last dozen turns, read from
`conversation_messages` for a channel conversation, or from `shwari_messages`
for the owner's dashboard thread.

**Customer memory** — `leads` and `conversations`, already present, not yet
surfaced to agents. That is the next milestone's work.

Nothing dumps the business into the prompt. The system message carries a short
orientation block — who the business is, how far setup has got, what customers
keep asking that nobody has answered — and everything else is fetched through
tools, per question. The prompt is the same size for a business with four
services and one with four hundred.

### Why there is no pgvector yet

Retrieval today is a keyword match over a few dozen curated facts. An embedding
index would add an embedding provider, a migration and an index to maintain,
and would not improve recall on a set that small. It becomes the right answer
when tenants upload documents; the retrieval call sits behind one tool
(`search_business_knowledge`), so swapping the implementation is a local change.

---

## The learning loop

When an agent cannot answer something from business knowledge, it calls
`record_knowledge_gap` instead of guessing. Repeats increment a counter.

Shwari sees the top gaps in its orientation block on every turn, so it raises
them with the owner unprompted: *"three people have asked whether you open on
Sunday and I don't have an answer — what should I tell them?"* The owner
answers in plain English, Shwari calls `save_business_fact`, and the gap closes.

The AI never writes the policy itself. It identifies that one is missing and
asks. That is the whole control: knowledge grows from owner statements, not
from model confidence.

---

## Talking to Shwari

### In the dashboard

```
POST /api/shwari/chat        { "message": "..." }  → { reply, changed }
GET  /api/shwari/history                          → the thread
GET  /api/shwari/status                           → team, open questions
GET  /api/shwari/activity                         → the audit trail
```

Admin-only. This agent changes the business, so it needs the same bar as the
settings pages it replaces.

The thread lives in `shwari_messages`, not in `conversations`. The Inbox is for
customers: an owner asking to change their opening hours is not a lead and must
not be counted as one.

### On Telegram

A chat id is not a credential — anyone can message a bot. So administering a
business by chat is never inferred from a name or number:

```
POST /api/shwari/pairing-code   → { code: "K7M2PQR9", expires_at }
```

The owner sends that code once, from the account they want to use. Redeeming it
binds that chat identity to that user and tenant, and everything afterwards is
a lookup rather than a guess. Codes are single-use, expire in 15 minutes, and
are only valid on a channel their own business owns — otherwise an owner could
paste a code into someone else's bot and hand it administrative reach.

`GET /api/shwari/linked` lists bound identities; `DELETE` removes one.

---

## Trying it end to end

1. Set `SHWARI_API_KEY` and `PUBLIC_API_URL`, apply migration `0013`, restart.
2. Sign in as an admin. `GET /api/setup/status` → `shwari.ready: true`.
3. `POST /api/shwari/chat`:

   > I run a dental clinic in Nairobi. We do cleaning, whitening, braces and
   > implants. Cleaning and whitening can be booked directly, braces and
   > implants need a consultation first.

   Expect four services created with the right `booking_mode`, the timezone
   set, and a follow-up question — probably about opening hours or prices.

4. `GET /api/shwari/activity` — every tool call, with arguments and outcome.
5. Ask it to recommend a team, agree, then activate.
6. Reconnect Telegram so the webhook points here, mint a pairing code, send it
   to the bot, and carry on the same conversation from a phone.
7. Message the bot from a *different* Telegram account: that one goes to the
   n8n sales pipeline, unchanged.

Step 7 is the one worth doing. It is the proof that this was added in front of
the working system rather than on top of it.

---

## Tests

```bash
npx tsx src/server/ai/__tests__/tools.test.mjs           # 20
npx tsx src/server/ai/__tests__/business.test.mjs        # 21
npx tsx src/server/routes/webhooks/__tests__/telegram.test.mjs  # 18
```

The tool tests are the ones to keep honest: they assert against the real
`runTool` that an agent cannot call a tool it lacks, that a model-supplied
`tenant_id` is dropped before any query is built, that a thrown tool becomes
data rather than an exception, and that Shwari cannot reconfigure itself.

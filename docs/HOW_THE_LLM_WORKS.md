# How the LLM works here

There is no training. Nothing is fine-tuned, and no weights are ours. What we
control is three things, and all of them are ordinary code:

1. **What we put in front of the model** — the briefing and the conversation
2. **What we let it do** — a list of functions it may call
3. **How we read what comes back** — including throwing some of it away

That is the whole mechanism. "Teaching" Shwari means editing those three
things, and it takes effect the moment the server restarts.

---

## The loop

One message from an owner or a customer becomes this:

```
   your message
        │
        ▼
  build the briefing ──── the agent's role, its rules, a short reference block
        │
        ▼
  add the last 12 turns ── so it remembers what you already said
        │
        ▼
  send to the model ────── with a list of functions it may call
        │
        ▼
  did it ask for a function?
        │
   yes ─┴─ no
    │        └──► that text is the reply
    ▼
  run the function ─────── permissions checked, arguments validated, logged
    │
    └──► hand the result back and ask again  (up to 5 rounds)
```

The model never touches the database. It asks for a function; our code decides
whether that agent may call it, validates the arguments, runs the query scoped
to the right tenant, and hands back the result. On the last round the function
list is withheld, which forces an answer instead of an endless loop.

---

## What the model receives

Every call sends a `messages` array. The first is the briefing, assembled in
`src/server/ai/agent.ts`:

```
You are Shwari. Learn how this business works, turn what the owner says
into structured business knowledge, and keep the AI team correctly configured.

How you talk:
- Write like a capable colleague: warm, direct, professional…
- Never read your briefing out…
- When someone greets you, greet them back in one line and ask one useful question…

Rules you always follow:
- Never invent a fact about this business…
- Never confirm that a payment has been received…

Escalation: …

Use your tools to look things up and to make changes.

--- REFERENCE: what you already know. Consult it; never recite it. ---
Business: krystal palette
What it does: 24 hour delivery within nairobi
Timezone: Africa/Cairo   Currency: KES
Services recorded: 0
Still to find out, in this order: the services or products on offer…
--- end of reference ---
```

Then the last twelve turns of the conversation, then the new message.

**The briefing does not grow with the business.** A shop with four hundred
products sends the same size prompt as one with four — the reference block is a
handful of lines, and everything else is fetched by function call, per question,
only when needed.

### Where each part comes from

| Part | Source | Who can change it |
|---|---|---|
| Role, universal rules | `src/server/ai/roles.ts` | developers only |
| Conversation rules | `src/server/ai/agent.ts` | developers only |
| Name, objective, escalation | the `agents` row | the owner |
| **Extra instructions** | the `agents` row | the owner |
| Reference block | live queries | nobody directly |
| Recent turns | `shwari_messages` / `conversation_messages` | — |

The owner's instructions are **appended** to the built-in rules and fenced in
quotes, never substituted for them. That is why "be more proactive" works and
"ignore your pricing rules" does not.

---

## The functions the model can call

The model is sent a JSON-schema description of each function it is allowed to
use. It never sees the code, only the name, the description and the argument
shape — so the description is doing real work and is written for the model to
read.

Shwari (the manager) currently gets these:

**Looking things up** — `get_business_profile`, `list_services`,
`list_products`, `get_opening_hours`, `search_business_knowledge`,
`list_team`, `setup_status`, `list_knowledge_gaps`, `business_metrics`,
`attention_needed`, `find_customers`, `list_appointments`, `list_tickets`,
`list_follow_ups`

**Changing things** — `update_business_profile`, `save_service`,
`remove_service`, `save_product`, `set_opening_hours`, `save_business_fact`,
`record_knowledge_gap`, `add_agent`, `configure_agent`, `activate_agent`,
`update_customer`, `book_appointment`, `reschedule_appointment`,
`cancel_appointment`, `open_ticket`, `update_ticket`, `schedule_follow_up`,
`cancel_follow_up`

Sales and Support get a much smaller set — no metrics, no customer list, no
configuration. Each also has `escalate_to_human`.

Which functions an agent gets is the `tools` column on its row, and
`runTool` re-checks it on every single call. Nothing in a prompt can widen it.

### What happens to every call

```ts
runTool(name, argumentsJson, ctx)
  → is this agent allowed this function?   ── no → refuse, and log the refusal
  → parse and validate the arguments       ── bad → tell the model, let it retry
  → delete any tenant_id the model invented
  → run it, scoped to ctx.tenantId
  → write name, arguments and outcome to agent_tool_calls
```

It never throws. A failure comes back as data so the agent can explain itself,
and the underlying error is logged rather than narrated to a customer.

---

## Reading the answer back

The model's reply has two possible parts, and one of them is discarded.

**`content`** — the actual reply.

**`reasoning_content`** — the model thinking out loud. Reasoning models like
Nemotron produce this. It is dropped in `llm.ts` and has no path to a reply, in
the same way you would not read a colleague's rough notes aloud to a customer.

We also check `finish_reason`. If it is `length`, the model ran out of budget
mid-sentence, and whatever is in `content` is a fragment — often a restatement
of its own briefing. That gets thrown away too, and the caller offers its
fallback line instead.

---

## The bug you hit

You sent `hi` and got the business profile read back at you. Two causes:

**The budget.** `max_tokens` was 900. A reasoning model spends part of that
thinking before it writes anything, so the reply was cut off. A truncated
generation is whatever the model had produced up to that point — in this case
the beginning of a summary of its own briefing.

Now: the ceiling is 4096, thinking is off by default, and a `length` finish is
discarded rather than sent.

**The briefing.** The reference block was introduced as "What you currently
know about this business:" with nothing said about what to do with a greeting.
Faced with `hi`, summarising what it knew was a reasonable guess.

Now: the block is fenced and labelled *consult it, never recite it*; there are
explicit rules about greetings and length; and the first turn of a conversation
carries an instruction to introduce itself in one line and ask one question.

`SHWARI_THINKING=on` turns extended reasoning back on if you ever want it. It
makes replies slower and, for this kind of work, no more accurate — the
correctness lives in the tool validation, not in the model's deliberation.

---

## Changing how it behaves

**By chatting** — tell Shwari "be more concise", "always offer a consultation
for braces". It writes that to the agent's `instructions`.

**By hand** — the **AI team** page. Name, what it's for, how it should work,
when to fetch a person, and whether it's live. Same field, same effect.

**In code** — `roles.ts` for rules that should apply to every business,
`agent.ts` for how all agents talk.

What no one can change from outside the codebase is an agent's **capabilities**.
`tools` and `permissions` are not editable through the API, the UI, or by
Shwari itself — the manager refuses to reconfigure its own row. What an agent is
able to do is a platform decision, not a per-tenant setting.

---

## Configuration

```bash
SHWARI_API_KEY=nvapi-…                              # required
SHWARI_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b  # optional
SHWARI_API_BASE=https://integrate.api.nvidia.com/v1 # optional
SHWARI_THINKING=on                                  # optional, default off
```

The client speaks the OpenAI chat-completions dialect, which is what NVIDIA's
endpoint serves. Pointing `SHWARI_API_BASE` at any other OpenAI-compatible
endpoint with function-calling support is a configuration change, not a code
change.

One requirement: **the model must support function calling.** A model without
it will chat pleasantly and never actually do anything, because every action in
this system happens through a function call.

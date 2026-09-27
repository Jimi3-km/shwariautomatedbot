
# Shwari Agent QA & Evaluation Guide

This guide describes how to use the Agent QA & Evaluation foundation to monitor live LLM agent interactions, label quality benchmarks, diagnose errors or hallucinations, and export datasets for automated regression testing.

---

## 1. Overview

Every conversation turn processed by the Shwari Agent Workforce (including Shwari Manager and customer specialists: Sales, Support, Booking, Orders) streams structured telemetry to the `audit_events` log. 

The **Agent QA** portal provides workspace owners and administrators with full observability into:
- User/customer inputs vs. agent responses.
- Which specific tools were called during the turn (e.g. `list_services`, `book_appointment`, `record_payment_claim`).
- Model profile used (`primary`, `fast`, or `fallback`) and execution duration in milliseconds.
- Execution status (`success`, `fallback`, or `error`).
- Quality triage and labeling (`ok`, `needs_improvement`, `bug`) with tags and notes.

---

## 2. Accessing the QA Interface

1. Sign in to your Shwari dashboard with an **Owner** or **Administrator** account.
2. In the left navigation sidebar, click on **Agent QA** (or navigate directly to `/admin/agent-qa`).
3. If signed in as a standard member or viewer, access to this view is restricted.

---

## 3. Filtering & Triaging Turns

The filter toolbar at the top of the QA screen allows multi-dimensional searching:

| Filter | Description | Options |
| :--- | :--- | :--- |
| **Role** | Filter by agent workforce role | `manager`, `sales`, `support`, `booking`, `orders` |
| **Channel** | Filter by the communication surface | `dashboard` (/shwari), `whatsapp`, `telegram`, `instagram`, `webchat`, `email` |
| **Model Profile** | Filter by NVIDIA NIM profile | `primary` (Kimi/Llama-70B), `fast` (Nemotron-3.5), `fallback` |
| **Status** | Filter by execution outcome | `success`, `fallback` (transient retry), `error` |
| **QA Label** | Filter by evaluation state | `unlabeled`, `ok` (Pass), `needs_improvement`, `bug` |
| **Tool Search** | Filter turns that invoked a given tool | Substring match (e.g. `save_product`, `list_appointments`) |

---

## 4. How to Label and Annotate Turns

Click the **Review** button on any row in the table to open the Turn Review Modal:

1. **Inspect Dialogue & Traces**:
   - Compare the verbatim **User Input** against the **Agent Reply**.
   - Check the **Tools Invoked** pill list. Verify whether the agent followed the *strict zero-hallucination policy* (e.g. querying prices before quoting).
   - Review latency (`duration_ms`) and model profile.
2. **Select Quality Label**:
   - **Pass (OK)**: The agent answered accurately, used tools properly, followed audience/cultural guidelines (e.g. polite Swahili/Sheng acknowledgement), and did not invent facts.
   - **Needs Improvement**: The response was safe and functional, but suboptimal (e.g., awkward phrasing, unnecessarily verbose, slightly slow, or missing a minor detail).
   - **Bug**: The agent experienced a failure, hallucinated a price/service not returned by tools, attempted an unauthorized action, failed to escalate, or threw an unhandled error.
3. **Attach Tags**:
   - Select one or more tags: `hallucination`, `swahili_fluency`, `sheng_attunement`, `wrong_tool`, `unnecessary_tool`, `slow_latency`, `formatting_issue`, `unverified_payment_claim`, `escalation_accuracy`.
   - Add custom tags as needed.
4. **Add Evaluation Notes**:
   - Add concise notes explaining the failure mode or coaching instruction for system prompts.
5. Click **Save QA Label**. The turn status updates instantly.

---

## 5. Exporting Evaluation Datasets

Labeled turns serve as gold-standard benchmark datasets for automated LLM regression tests and prompt engineering evaluations.

### Option A: From the Browser UI
Click the **Export Dataset (JSONL)** button in the top right corner of `/admin/agent-qa`. The browser will download a `.jsonl` file matching your current filter criteria.

### Option B: Via HTTP API
```bash
curl -H "Authorization: Bearer <ADMIN_JWT>" \
  "https://your-shwari-domain.com/api/admin/agent-turns/export?labeled_only=true" \
  -o benchmark-dataset.jsonl
```

### Option C: Via CLI Exporter
Run the standalone TypeScript exporter directly:
```bash
# Export all labeled turns into eval-dataset.jsonl
npx tsx scripts/export-eval-dataset.ts --out eval-dataset.jsonl

# Export turns for a specific tenant
npx tsx scripts/export-eval-dataset.ts --tenant <TENANT_UUID> --out tenant-dataset.jsonl

# Export all turns (both labeled and unlabeled)
npx tsx scripts/export-eval-dataset.ts --all --out all-turns.jsonl
```

### Dataset JSONL Schema:
```json
{
  "id": 142,
  "tenant_id": "90e2fc1a-...",
  "role": "sales",
  "channel": "whatsapp",
  "language_hint": "sw",
  "input": "Habari, bei ya Deluxe Car Wash ni ngapi?",
  "reply": "Habari! Deluxe Car Wash ni KES 1,500 na inachukua dakika 45. Je, ungependa kupanga miadi leo?",
  "actual_tools": ["list_services"],
  "expected_tools": ["list_services"],
  "label": "ok",
  "tags": ["swahili_fluency"],
  "notes": "Accurate tool call and fluent Swahili response without price hallucination.",
  "model_profile": "primary",
  "duration_ms": 420,
  "created_at": "2026-09-26T14:32:00Z"
}
```

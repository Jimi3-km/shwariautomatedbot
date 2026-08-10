# Shwari WhatsApp AI Sales Agent

**AI-powered WhatsApp sales automation and CRM dashboard built for Shwari iPhones, a Kenyan phone retailer.**

Shwari WhatsApp Agent connects WhatsApp, an AI sales agent, workflow automation, a PostgreSQL database, and an operational dashboard into a single sales system.

The system was built to automate customer conversations while giving the business team visibility and control over leads, products, payments, and conversations.

> **Project type:** AI Sales Automation / CRM
> **Built with:** React · TypeScript · Node.js · Express · PostgreSQL · Supabase · n8n · Meta WhatsApp Cloud API
> **Status:** Original production-oriented implementation; currently being evolved into a multi-tenant platform

---

## What I Built

The system replaces a large portion of the manual work involved in selling products through WhatsApp.

A typical customer interaction flows through:

```text
Customer
   │
   ▼
WhatsApp
   │
   ▼
Meta WhatsApp Cloud API
   │
   ▼
n8n Workflow
   │
   ├── Customer / Intent Detection
   ├── AI Sales Agent
   ├── Product Lookup
   ├── Lead Management
   ├── Conversation Logging
   └── Human Escalation
   │
   ▼
Express API
   │
   ▼
Supabase / PostgreSQL
   │
   ▼
Admin Dashboard
```

The result is a system where WhatsApp conversations become structured sales activity instead of remaining isolated messages.

---

## Core Features

### AI Sales Agent

The n8n workflow receives incoming WhatsApp messages and uses an LLM-powered agent to:

* Understand customer intent
* Answer product questions
* Retrieve product information
* Provide pricing
* Explain payment options
* Identify purchase intent
* Route important leads
* Continue conversations using conversation context
* Escalate customers to human staff when required

The agent is connected to structured business data rather than relying entirely on hardcoded responses.

---

### Dual WhatsApp Inbox

The original implementation supported two separate WhatsApp Cloud API numbers:

* **Students / iPhone Sales**
* **Accessories**

The dashboard could distinguish activity between the two sales channels.

---

### Lead Pipeline

Customer interactions are converted into structured leads.

The dashboard provides visibility into:

```text
New → Engaged → Hot → Closed
```

Leads can be monitored by:

* Stage
* Intent
* Urgency
* Customer
* Inbox
* Conversation activity

This gives the business a basic CRM layer on top of WhatsApp.

---

### Human Handoff

The system was designed for a hybrid AI + human workflow.

When an AI conversation requires human intervention, an operator can take over from the dashboard and communicate with the customer directly.

The dashboard supports sending:

* Text
* Images / product photos

This allows AI to handle repetitive conversations while human agents handle high-value or complex interactions.

---

### Inventory & Pricing

The dashboard includes product management for:

* iPhones
* Accessories
* General pricing
* Lipa Mdogo Mdogo payment plans
* Product availability

The AI agent can use this information when responding to customers.

---

### Payment Tracking

The system includes payment management for sales activity.

Supported payment workflows include:

* M-Pesa
* Paystack
* Payment recording
* Receipt generation
* Revenue tracking
* Payment status management

Payment activity can be associated with the relevant sales inbox.

---

### Authentication

The dashboard uses Supabase Authentication with JWT-based API authentication.

Protected API requests use:

```text
Authorization: Bearer <JWT>
```

Administrative operations are restricted to authenticated users with the appropriate access.

---

# Architecture

```text
                 ┌──────────────────────┐
                 │      Customer        │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ WhatsApp Cloud API   │
                 │       (Meta)         │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │     n8n Workflows    │
                 │                      │
                 │ • AI Agent           │
                 │ • Intent Detection   │
                 │ • Product Lookup     │
                 │ • Lead Routing       │
                 │ • Notifications      │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │    Express API       │
                 │     TypeScript       │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ Supabase PostgreSQL  │
                 │                      │
                 │ • Products           │
                 │ • Leads              │
                 │ • Conversations      │
                 │ • Payments           │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   React Dashboard    │
                 │                      │
                 │ Overview             │
                 │ Inbox                │
                 │ Leads                │
                 │ Products             │
                 │ Payments             │
                 │ Settings             │
                 └──────────────────────┘
```

---

# Technology Stack

| Layer          | Technology                        |
| -------------- | --------------------------------- |
| Frontend       | React 19 · Vite · Tailwind CSS v4 |
| Backend        | Node.js · Express · TypeScript    |
| Database       | Supabase · PostgreSQL             |
| Authentication | Supabase Auth · JWT               |
| Automation     | n8n                               |
| AI             | LLM-powered sales agent           |
| Messaging      | Meta WhatsApp Cloud API           |
| Payments       | Paystack · M-Pesa workflows       |
| Deployment     | Vercel                            |

---

# Key Engineering Highlights

### Workflow orchestration

Rather than putting all application logic inside the frontend, n8n acts as the orchestration layer for incoming customer conversations.

This makes it possible to separate:

* Messaging
* AI reasoning
* Business logic
* Database operations
* Notifications
* Human escalation

---

### AI + deterministic business logic

The AI handles conversational reasoning, while structured application logic handles business-critical operations.

For example:

```text
Customer asks for iPhone price
          ↓
AI understands request
          ↓
Product data retrieved
          ↓
Business data supplied to agent
          ↓
AI generates response
          ↓
Response sent through WhatsApp
```

This approach reduces reliance on hardcoded AI responses.

---

### Real-time operational dashboard

The dashboard is not simply an analytics interface.

It is an operational control layer where staff can:

* View conversations
* Manage leads
* Update products
* Track payments
* Take over AI conversations
* Monitor sales activity

---

### Database migrations

Database changes are maintained as incremental SQL migrations rather than being treated as undocumented changes.

```text
database/
├── schema/
│   ├── supabase_schema.sql
│   └── payments_schema.sql
│
└── migrations/
    ├── migration_*.sql
    └── ...
```

This makes the database easier to evolve and reproduce.

---

# Repository Structure

```text
shwariautomatedbot/
│
├── api/
│   └── index.ts
│
├── database/
│   ├── schema/
│   │   ├── supabase_schema.sql
│   │   └── payments_schema.sql
│   │
│   └── migrations/
│       └── migration_*.sql
│
├── docs/
│   └── dashboard-standalone.html
│
├── scripts/
│   ├── init-db-script.ts
│   ├── run-migration-script.ts
│   └── test-accessories-api.ts
│
├── src/
│   ├── App.tsx
│   ├── config.ts
│   ├── db.ts
│   ├── index.css
│   └── main.tsx
│
├── workflows/
│   └── n8n/
│       ├── n8n-workflow-main.json
│       └── n8n-workflow-dashboard-api.json
│
├── server.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vercel.json
```

---

# Running Locally

### Requirements

* Node.js 20+
* Supabase project
* Meta WhatsApp Business / Cloud API
* n8n instance

### Install

```bash
git clone <repo-url>
cd shwariautomatedbot
npm install
```

### Environment

```bash
cp .env.example .env
```

Configure the required credentials in `.env`.

### Start

```bash
npm run dev
```

The dashboard runs locally at:

```text
http://localhost:3000
```

---

# Security

The application keeps sensitive credentials outside the repository.

Examples include:

* Supabase service-role credentials
* Database connection strings
* WhatsApp access tokens
* Paystack secret keys
* Administrative credentials

These are provided through environment variables and are excluded from version control.

---

# Project Evolution

This repository represents the **original Shwari-specific implementation**.

After building the first version, I began redesigning the architecture around a more general problem:

> How can the same AI sales infrastructure support multiple businesses instead of being hardcoded around one company?

The next version is therefore being developed as a **multi-tenant AI sales platform**.

The new architecture introduces:

* Tenant isolation
* Business-specific configuration
* Multiple channel connections
* Tenant-scoped products
* Tenant-scoped conversations
* Tenant-scoped leads
* Tenant-scoped payments
* Role-based access
* Database-level Row Level Security
* A unified dashboard for connected channels

The Shwari implementation serves as the foundation and real-world test case for that architecture.

---

# Why I Built It

The project started from a real business workflow rather than a purely academic exercise.

The goal was to take a common business process — selling through WhatsApp — and connect:

**AI + automation + database + CRM + payments + human operations**

into one system.

The current work focuses on taking what worked in the Shwari implementation and turning it into a reusable SaaS architecture.

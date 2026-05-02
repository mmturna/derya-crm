# Derya Freight OS

Automated freight forwarding & procurement platform. Captures customer RFQs, parses them with AI, sources rates from carriers/agents, builds quotes, tracks jobs from booking through delivery — with a CRM sub-module for customer relationships.

## Project context

- Vision & status: [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)
- Roadmap to automated forwarding office: [`docs/PRODUCTIZATION_ROADMAP.md`](docs/PRODUCTIZATION_ROADMAP.md)

## Tech

- Web: Next.js 15 (App Router) + TypeScript, Server Components + Server Actions
- DB: SQLite (local demo) / Postgres-ready
- ORM: Prisma
- Auth: Cookie-based credentials
- AI: Anthropic Claude (Haiku for RFQ parsing, Opus for drafts)

## Prereqs

- Node.js 20+

## Getting started

1) Create `.env` from `.env.example` (set `ANTHROPIC_API_KEY` for AI parsing)
2) Install deps:

```bash
npm install
```

3) Push schema + seed:

```bash
npm run db:push
npm run db:seed
npx tsx prisma/seed-jobs.ts   # seeds demo jobs, RFQs, carrier quotes, milestones
```

4) Start dev server:

```bash
npm run dev
```

## Demo logins

- `admin@demo.local / admin1234`
- `sales1@demo.local / sales1234`

## Key routes

- `/dashboard` — overview (pipeline + RFQ feed)
- `/dashboard/activity` — Operations Command (RFQs to process, overdue jobs, milestones, procurement queue)
- `/dashboard/rfq` — RFQ inbox · `/dashboard/rfq/[id]` (with AI parse) · `/dashboard/rfq/new` (manual)
- `/dashboard/jobs` — Kanban · `/dashboard/jobs/[id]` (6-tab detail) · `/dashboard/jobs/new` (manual)
- `/dashboard/reports` — Forwarding KPIs (pipeline, RFQ funnel, mode mix, lanes, carriers, OTD, margin)
- `/dashboard/settings/email` — Gmail/Outlook/IMAP setup
- `/dashboard/customers` — CRM sub-module
- `/api/jobs/[id]/quote-pdf` — printable customer quote

# Derya CRM (Demo)

Multi-office (tenant-isolated) CRM demo focused on customer pool segmentation, activities, assignments, and quote history.

## Project context

- Product/requirements context: `docs/PROJECT_CONTEXT.md`

## Tech (simple local dev)

- Web: Next.js (App Router) + TypeScript
- DB: SQLite (local demo default)
- ORM: Prisma
- Auth: Credentials (email + password)

## Prereqs

- Node.js 20+
- Node.js only (SQLite file DB is embedded for local demo)

## Getting started

1) Create `.env` from `.env.example`
2) Install deps:

```bash
npm install
```

3) Push schema + seed:

```bash
npm run db:push
npm run db:seed
```

4) Start dev server:

```bash
npm run dev
```

## Accounts (seed)

See `prisma/seed.ts`.

## Demo logins

- `admin@demo.local / admin1234`
- `sales1@demo.local / sales1234`


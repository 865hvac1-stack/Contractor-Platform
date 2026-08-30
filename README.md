# Contractor OS

Multi-tenant SaaS foundation for home-service contractors (HVAC first template, trade-agnostic core).

**Product principle:** less office work, more visibility, better follow-up, better margins.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- PostgreSQL + Prisma ORM
- Session cookies (HTTP-only) + bcrypt password hashing
- Zod validation
- Vitest
- Railway-ready (`railway.json`)

## Architecture

- **Multi-tenant:** every business record is scoped by `companyId`. Server actions resolve the active company from the signed-in user's membership — never from a raw browser `companyId`.
- **Auth:** email/password, DB-backed sessions, password reset tokens, protected routes via middleware + server checks.
- **RBAC:** centralized `can(role, permission)` in `src/lib/permissions.ts`. Pages/actions call `requirePermission`.
- **Money:** integer cents only (`src/lib/money.ts`).
- **Needs Attention:** pluggable detectors in `src/lib/attention.ts` (dashboard consumes them).
- **Audit log:** `writeAudit()` for create/status/security events.
- **Receipts:** upload + storage + processing status fields; no fake AI extraction.

## Local setup

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 14+

### 2. Install

```bash
cp .env.example .env
npm install
```

### 3. Configure `.env`

Minimum:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/contractor_platform?schema=public"
SESSION_SECRET="a-long-random-string-at-least-32-characters"
APP_URL="http://127.0.0.1:43123"
UPLOAD_DIR="./uploads"
ALLOW_SEED="true"
SEED_OWNER_EMAIL="owner@865hvac.local"
SEED_OWNER_PASSWORD="ChangeMe-DevOnly-865!"
SEED_PLATFORM_ADMIN_EMAIL="admin@platform.local"
SEED_PLATFORM_ADMIN_PASSWORD="ChangeMe-DevOnly-Admin!"
```

### 4. Database

```bash
npx prisma migrate dev
npm run db:seed
```

Seed creates **only**:

- Platform admin user
- Demo company **865 HVAC**
- Company owner membership

It does **not** create fake customers, jobs, or financial data.

### 5. Run

```bash
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server on port 43123 |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest (includes tenant isolation) |
| `npm run db:migrate` | Dev migrations |
| `npm run db:migrate:deploy` | Production migrations |
| `npm run db:seed` | Dev seed (requires `ALLOW_SEED=true`) |

## First user journey

1. Register → onboarding (company + industry) → Command Center  
2. Create customer → add property  
3. Create job → schedule  
4. Create estimate → approve  
5. Complete job → create invoice → record payment  
6. Log expense + upload receipt  
7. Dashboard / reports update from **real** data only  

## Security notes

- Tenant isolation is enforced in server actions / queries.
- Passwords hashed with bcrypt (cost 12).
- Sessions stored hashed; cookies HTTP-only, `SameSite=Lax`, `Secure` in production.
- Uploaded receipts are served only after membership checks.
- Never commit secrets. Never set `ALLOW_SEED=true` in production.

## Railway deployment

1. Create a Railway project and connect this GitHub repo.
2. Add a **PostgreSQL** plugin and link it to the web service.
3. Set environment variables (below).
4. Deploy. Nixpacks installs dependencies (do **not** set the build command to `npm ci` — that fails on Railway with `EBUSY`). `railway.json` runs `prisma generate && npm run build`, then `prisma migrate deploy` on start, and health-checks `/api/health`.
5. If the Railway dashboard still shows build command `npm ci && …`, change it to `npx prisma generate && npm run build` and set Node to 20.
5. Attach a volume for `UPLOAD_DIR` if you need persistent receipts.

### Railway environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Provided by Railway Postgres when linked |
| `SESSION_SECRET` | Yes | 32+ random characters. Account create/login will fail without this. |
| `APP_URL` | Yes | Public HTTPS URL of the service |
| `UPLOAD_DIR` | Yes | e.g. `/data/uploads` with a volume |
| `NODE_ENV` | Yes | `production` |
| `ALLOW_SEED` | No | Must be `false` or unset in production |
| `SEED_*` | No | Leave empty in production |

Generate a session secret:

```bash
openssl rand -base64 48
```

## Testing

```bash
npm test
```

Critical coverage includes:

- Money math (integer cents)
- Role permissions
- **Company A cannot read or mutate Company B records**
- Estimate/invoice cent math
- Expense tenant scope
- Audit log writes
- Empty dashboard aggregates = `$0`

## Project layout

```
prisma/             schema + migrations + seed
src/app/            App Router pages (auth, app shell, platform)
src/components/     UI shell + shared components
src/lib/            auth, tenant, permissions, money, attention, dashboard
src/server/actions/ server mutations
tests/              vitest suites
```

## Phase 2 (intentionally deferred)

AI receptionist, SMS/email inbox, automations, memberships, pricebook, inventory, payroll, QuickBooks, Stripe live payments, GPS/routing, native/PWA apps, customer portal, OCR receipt extraction.

## License

Private — all rights reserved.

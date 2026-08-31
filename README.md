# ContractorYou

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
- **Marketing Hub:** tenant-scoped leads, channels, attribution, and Intelligence. Website forms, landing pages, and UTM capture are live. OAuth for Google / Meta / TikTok / LinkedIn is implemented; connections stay disconnected until real credentials and provider approval exist. Metrics use recorded leads, expenses, and imported spend only.
- **Playbooks:** company-owned job workflows (Settings → Playbooks). Each playbook is versioned. Assigning a playbook to a job freezes a snapshot so later edits do not change historical jobs. Jobs without a playbook keep working. Message preview never sends. SMS/email delivery stays off until a provider is connected.
- **Intelligence:** Deterministic metrics and attention first. Ask ContractorYou retrieves tenant-scoped tools, then optionally explains with OpenAI (`gpt-4o-mini`). Never invents numbers. Set `OPENAI_API_KEY` on Railway for language-model wording.
- **Import Data:** Settings → Import Data. Universal CSV/XLSX/XLS customer import with source-agnostic mapping, preview, duplicate detection, and batch write. Vendor names are presets, not separate importers. Direct vendor sync is not claimed.
- **Integrations:** AES-256-GCM credential storage (`src/lib/integrations/crypto.ts`). Tokens never go to the browser.
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
3. Create job → choose a playbook (optional) → schedule  
4. Create estimate → approve  
5. Complete job → create invoice → record payment  
6. Log expense + upload receipt  
7. Dashboard / reports update from **real** data only  
8. Marketing Hub → record a lead → pipeline. Channel cards stay disconnected until OAuth is configured.
9. Settings → Import Data → upload a customer export → match columns → preview → confirm.

## Security notes

- Tenant isolation is enforced in server actions / queries.
- Passwords hashed with bcrypt (cost 12).
- Sessions stored hashed; cookies HTTP-only, `SameSite=Lax`, `Secure` in production.
- Uploaded receipts are served only after membership checks.
- Never commit secrets. Never set `ALLOW_SEED=true` in production.

## Marketing integrations

Channels are real OAuth and ContractorYou-hosted products. ContractorYou will not fake a successful connection or invent marketing numbers.

**Live now (no provider approval):** Website forms, landing pages, UTM first/last touch, tracking-number mapping.

**Code ready — needs Railway credentials:** Google, Meta, TikTok, LinkedIn, Twilio, Resend.

**Code ready — needs provider approval:** Google Business Profile API access, Google Ads developer token / LSA, Meta App Review, TikTok Content Posting / Ads, LinkedIn Marketing APIs.

### OAuth callback URIs

Set `APP_URL` to the public Railway URL (no trailing slash). Paste these into each developer console:

| Provider | Callback URI |
|----------|----------------|
| Google (shared) | `{APP_URL}/api/integrations/google/callback` |
| Meta | `{APP_URL}/api/integrations/meta/callback` |
| TikTok | `{APP_URL}/api/integrations/tiktok/callback` |
| LinkedIn | `{APP_URL}/api/integrations/linkedin/callback` |

Example production: `https://YOUR-RAILWAY-HOST/api/integrations/google/callback`

### Railway variables for integrations

| Variable | Used by |
|----------|---------|
| `APP_URL` | OAuth redirect URIs and hosted form links |
| `INTEGRATION_ENCRYPTION_KEY` | AES-256-GCM for provider tokens (32+ chars). Falls back to `INTEGRATION_SECRET` then `SESSION_SECRET`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | All Google products |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads and Local Services Ads |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Optional manager (MCC) account |
| `META_APP_ID` / `META_APP_SECRET` | Facebook, Instagram, Meta Ads |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhook handshake |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok Login Kit |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Phone / SMS (no fake ringing without these) |
| `RESEND_API_KEY` | Transactional email |
| `INTEGRATION_WEBHOOK_SECRET` | Optional HMAC for `/api/webhooks/[provider]` |

Never commit real values. Platform Admin → Integrations shows **presence only**.

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
| `OPENAI_API_KEY` | No | Server-side Intelligence wording. Without it, Ask still answers from records. Never expose to the browser. |
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
- Playbook tenant isolation (Company A cannot read or mutate Company B playbooks, versions, snapshots, or form templates)
- Playbook snapshots stay frozen when the live playbook is edited
- Integration tenant isolation (connections, forms, leads)
- OAuth state is single-use
- Import engine maps generic, Housecall Pro-style, Jobber-style, ServiceTitan-style, and unknown headers
- Duplicate detection and tenant isolation for import sessions
- Website form submissions create real leads with UTMs
- External lead sync is idempotent
- Jobs without a playbook continue to function
- Message merge fields never execute code

## Project layout

```
prisma/             schema + migrations + seed
src/app/            App Router pages (auth, app shell, platform)
src/components/     UI shell + shared components
src/lib/            auth, tenant, permissions, money, attention, dashboard
src/server/actions/ server mutations
tests/              vitest suites
```

## Import data

Settings → Import Data. Owners, admins, managers, and office can import. Technicians and installers cannot.

The Import Center is one source-agnostic engine. Live types: customers, properties, jobs, estimates, invoices, payments, equipment, expenses, notes, tags, and lead sources. Memberships and pricebook items stay foundation-ready until those models exist.

Supported files: CSV, XLSX, XLS (20 MB / 25,000 rows). Vendor names are optional presets, not separate importers. A file import is not a live connection. Historical imports do not send messages or take payments. Nothing is written until you confirm.

## Playbooks

Settings → Playbooks. Starters (Residential Service, Residential Maintenance, Commercial Maintenance, Residential Changeout, Estimate / Sales Call) are examples you can rename, duplicate, or ignore.

**Your process. Your business. Your way.**

Changing a playbook creates a new version. Jobs already started keep the snapshot they were assigned.

## Phase 2 (intentionally deferred)

AI receptionist, live SMS/email send, connected automation execution, memberships, pricebook, inventory, payroll, QuickBooks, Stripe live payments, GPS/routing, native/PWA apps, customer portal, OCR receipt extraction, full custom form builder, photo library uploads.

## License

Private — all rights reserved.

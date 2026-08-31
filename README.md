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
- **Pricebook:** Operations → Pricebook. Categories, items, member pricing, and office-only internal cost.
- **Memberships:** Operations → Memberships. Service-agreement records with attribution. Recurring billing is not configured.
- **Compensation:** Team → Compensation. Configurable incentives. Not payroll. Pending is never paid.
- **Scorecards:** My Performance and Team scorecards from verified jobs, invoices, estimates, and memberships.
- **Playbooks:** company-owned job workflows (Settings → Playbooks). Each playbook is versioned. Assigning a playbook to a job freezes a snapshot so later edits do not change historical jobs. Jobs without a playbook keep working. Message preview never sends. SMS/email delivery stays off until a provider is connected.
- **Intelligence:** Deterministic metrics and attention first. Ask ContractorYou retrieves tenant-scoped tools, then optionally explains with OpenAI (`gpt-4o-mini`). Never invents numbers. Set `OPENAI_API_KEY` on Railway for language-model wording.
- **Import Data:** Settings → Import Data. Universal CSV/XLSX/XLS customer import with source-agnostic mapping, preview, duplicate detection, and batch write. Vendor names are presets, not separate importers. Direct vendor sync is not claimed.
- **Integrations:** AES-256-GCM credential storage (`src/lib/integrations/crypto.ts`). Tokens never go to the browser.
- **Audit log:** `writeAudit()` for create/status/security events.
- **Receipts:** Money → Receipts inbox. Photo/PDF upload, optional AI suggestions, confirm before creating an expense or job cost.
- **Job costing:** Confirmed costs and verified invoice revenue only. Technicians cannot see company profit.
- **QuickBooks Online:** Settings → QuickBooks. Real Intuit OAuth. Tokens encrypted at rest. Default invoice push is manual only. Historical imports never auto-sync.

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
4. Job → Build options → Pricebook → present estimate → customer approval  
5. Complete job → create invoice → record payment or send payment link  
6. Log expense or snap a receipt in Receipts  
7. Confirm the receipt, then see job profit on the job  
8. Dashboard / reports update from **real** data only  
9. Marketing Hub → record a lead → pipeline. Channel cards stay disconnected until OAuth is configured.
10. Settings → Import Data → upload a customer export → match columns → preview → confirm.
11. Settings → QuickBooks → Connect (after Intuit credentials) → optionally Sync to QuickBooks on an invoice.

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
| QuickBooks Online | `{APP_URL}/api/integrations/quickbooks/callback` |

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
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | Intuit app credentials |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` until Intuit approves production |
| `QUICKBOOKS_REDIRECT_URI` | Optional override; defaults to `{APP_URL}/api/integrations/quickbooks/callback` |

Never commit real values. Platform Admin → Integrations shows **presence only**.

## Railway deployment

1. Create a Railway project and connect this GitHub repo.
2. Add a **PostgreSQL** plugin and link it to the web service.
3. Set environment variables (below).
4. Deploy. Nixpacks installs dependencies (do **not** set the build command to `npm ci` — that fails on Railway with `EBUSY`). Do **not** `rm -rf .next` in the build command — Railway mounts `.next/cache` and that fails with `Device or resource busy`. `railway.json` runs `prisma generate && npm run build` (Webpack, so a stale Turbopack cache is not restored), then `prisma migrate deploy` on start, and health-checks `/api/health`.
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
| `OPENAI_API_KEY` | No | Server-side Intelligence wording and receipt suggestions. Receipts still work without it. Never expose to the browser. |
| `QUICKBOOKS_CLIENT_ID` | No | Required to connect QuickBooks. Without it the card stays Not connected. |
| `QUICKBOOKS_CLIENT_SECRET` | No | Intuit client secret |
| `QUICKBOOKS_ENVIRONMENT` | No | `sandbox` or `production`. Default `sandbox`. |
| `QUICKBOOKS_REDIRECT_URI` | No | Defaults from `APP_URL` |
| `STRIPE_SECRET_KEY` | No | Required for card checkout. Manual recorded payments work without it. |
| `STRIPE_WEBHOOK_SECRET` | No | Required to confirm Stripe Checkout |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Optional publishable key |
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

The Import Center is one source-agnostic engine. Live types: customers, properties, jobs, estimates, invoices, payments, equipment, expenses, notes, tags, and lead sources. Pricebook and memberships are managed in-app. Historical import of those types does not generate compensation, send payment links, or start billing.

Supported files: CSV, XLSX, XLS (20 MB / 25,000 rows). Vendor names are optional presets, not separate importers. A file import is not a live connection. Historical imports do not send messages or take payments. Nothing is written until you confirm.

## Playbooks

Settings → Playbooks. Starters (Residential Service, Residential Maintenance, Commercial Maintenance, Residential Changeout, Estimate / Sales Call) are examples you can rename, duplicate, or ignore.

**Your process. Your business. Your way.**

Changing a playbook creates a new version. Jobs already started keep the snapshot they were assigned.

## Phase 2 (intentionally deferred)

AI receptionist, live SMS/email send, connected automation execution, inventory, payroll, GPS/routing, native/PWA apps, full custom form builder. Stripe card checkout and QuickBooks live sync wait on credentials and provider approval. Recurring membership billing and tiered/threshold compensation are foundation-ready.

## License

Private — all rights reserved.

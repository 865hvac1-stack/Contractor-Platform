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
- **Role workspaces:** One platform, one database. After login, users land on the experience they can use: Owner/Admin/Manager → Command Center (`/dashboard`), Dispatcher → Dispatch Center (`/dispatch`), Office/CSR → Customer Hub (`/office`), Technician/Installer → Field (`/tech`). Users with more than one authorized workspace switch without signing out. Technicians cannot open owner, dispatch, or CSR workspaces. Marketing stays a module inside the Owner Hub — there is no separate Marketing dashboard.
- **Dispatch Center:** Technician lanes, unassigned queue, drag-and-drop assignment, job lock, and **Optimize Route**. Route math comes from Google Directions when `GOOGLE_MAPS_API_KEY` (or `GOOGLE_ROUTES_API_KEY`) is set on the server. Missing credentials show “Route optimization is not configured.” Preview never applies until the dispatcher clicks Apply.
- **Customer Hub:** Fast customer search, quick customer/job create, Customer 360, and send-to-Dispatch on the same Job record.
- **Technician Portal:** `/tech` is a mobile-first field experience for TECHNICIAN and INSTALLER roles. Same jobs, playbooks, pricebook, estimates, invoices, payments, memberships, receipts, and scorecards — not a second system. Bottom nav: Home, Jobs, Performance, Inbox, More. Job workspace uses progressive sections + Next Step. Photos support camera capture and photo-library upload. Sign out clears the session cookie. Office customer search is server-side (not a client-only filter). Team invites send through Resend when `RESEND_API_KEY` is set.
- **Playbooks:** company-owned job workflows (Settings → Playbooks). Each playbook is versioned. Assigning a playbook to a job freezes a snapshot so later edits do not change historical jobs. Jobs without a playbook keep working. Message preview never sends. SMS/email delivery stays off until a provider is connected.
- **Intelligence:** Deterministic metrics and attention first. Ask ContractorYou retrieves tenant-scoped tools, then optionally explains with OpenAI (`gpt-4o-mini`). Never invents numbers. Set `OPENAI_API_KEY` on Railway for language-model wording.
- **Import Data:** Settings → Import Data. Universal CSV/XLSX/XLS customer import with source-agnostic mapping, preview, duplicate detection, and batch write. Vendor names are presets, not separate importers. Direct vendor sync is not claimed.
- **Integrations:** AES-256-GCM credential storage (`src/lib/integrations/crypto.ts`). Tokens never go to the browser.
- **Audit log:** `writeAudit()` for create/status/security events.
- **Receipts:** Money → Receipts inbox. Photo/PDF upload, optional AI suggestions, confirm before creating an expense or job cost.
- **Job costing:** Confirmed costs and verified invoice revenue only. Technicians cannot see company profit.
- **QuickBooks Online:** Settings → QuickBooks. Real Intuit OAuth. Tokens encrypted at rest. Default invoice push is manual only. Historical imports never auto-sync.
- **ContractorYou Payments:** Settings → Payments. Each company gets its own Stripe Connect **Accounts v2** merchant account (`POST /v2/core/accounts`, full Stripe Dashboard, Stripe-owned fees and losses). Stripe handles KYC, cards, bank payments, and payouts. ContractorYou never stores card numbers, CVV, or bank credentials. Customer payment page is `/i/{publicToken}`. Webhook: `{APP_URL}/api/webhooks/stripe`. Missing Stripe keys show **Payments not configured** — the app does not crash. Recurring Stripe subscriptions are not implemented.

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
SEED_TECH_EMAIL="tech@865hvac.local"
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

1. Register → onboarding (company + industry) → Command Center (owners/office). Technicians and installers land on `/tech`.  
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
| `RESEND_API_KEY` | Transactional email (team / technician invites) |
| `EMAIL_FROM` or `RESEND_FROM` | Verified from-address for Resend |
| `TWILIO_FROM_NUMBER` | Optional From number for On My Way SMS |
| `GOOGLE_MAPS_API_KEY` or `GOOGLE_ROUTES_API_KEY` | Dispatch route optimization (Google Directions). Server-side only. Without it, Dispatch never invents savings. |
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
| `STRIPE_SECRET_KEY` | No | Server-only Stripe secret. Required for ContractorYou Payments. App still deploys without it. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Publishable key for Payment Element. Safe for the browser. |
| `STRIPE_WEBHOOK_SECRET` | No | Webhook signing secret for `{APP_URL}/api/webhooks/stripe` |
| `STRIPE_CONNECT_CLIENT_ID` | No | Optional. Express Account Links do not require it. |
| `STRIPE_PLATFORM_FEE_BPS` | No | Future platform fee in basis points. Default `0`. Do not invent fees. |
| `RESEND_API_KEY` | No | Required to send team / technician invite emails. Without it, Team shows “Email is not configured.” |
| `EMAIL_FROM` or `RESEND_FROM` | No | Verified Resend from-address |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | No | Required to send On My Way SMS. Job status still updates without them. |
| `GOOGLE_MAPS_API_KEY` or `GOOGLE_ROUTES_API_KEY` | No | Dispatch route optimization. Without it, Dispatch shows not configured and never invents savings. |
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
- Technician logout / session invalidation
- Technician invite tokens (single-use, expiry, tenant isolation)
- Server-side customer search (office + assigned-only technician)
- Job photo categories and assignment-scoped file access
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
- Stripe Connect status is never CONNECTED unless Stripe reports charges + payouts + details submitted
- Payment amount is taken from the invoice, never the browser
- Webhook signature verification and event idempotency
- Historical invoices cannot be charged
- Cash/check overpayment is rejected
- Technician cannot refund

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

AI receptionist, live SMS/email send, connected automation execution, inventory, payroll, GPS/routing, native/PWA apps, full custom form builder. Recurring Stripe subscriptions for memberships are foundation-ready, not live.

## ContractorYou Payments (Stripe Connect)

ContractorYou owns the contractor and customer experience. Stripe is the payment processor.

**Architecture:** Stripe Connect **Accounts v2** (`POST /v2/core/accounts`) as a **SaaS / direct-charge** platform: `dashboard=full`, `defaults.responsibilities.fees_collector=stripe`, `defaults.responsibilities.losses_collector=stripe`, and `configuration.merchant.capabilities.card_payments`. Charges are **direct charges** (`stripeAccount` on PaymentIntents). Each ContractorYou company has its own connected merchant account and payout bank. Funds are never mixed across tenants. A contractor does not need a Stripe account before clicking Set Up Payments.

Stripe does **not** allow `dashboard=express` with Stripe-owned fees/losses (`account_controller_express_dash_without_application_losses_or_fees`). Express is the marketplace combo (`fees_collector` and `losses_collector` both `application`). ContractorYou is SaaS, not a marketplace, so it uses the full Stripe Dashboard for each contractor.

New Connect platforms must use Accounts v2. ContractorYou does **not** call legacy `POST /v1/accounts` and does not require enabling Accounts v1 compatibility in Stripe.

**Onboarding:** Stripe-hosted Account Links via `POST /v2/core/account_links` (`use_case.type = account_onboarding`). ContractorYou never collects KYC or bank credentials.

**Status:** `CONNECTED` only when Accounts v2 reports card payments **active**, payouts **active**, and no user-due requirements. An account ID alone is not Connected.

**Test vs live:** Use `sk_test_` / `pk_test_` first (Stripe sandbox). Switch to live keys only after a controlled test-mode pass. Mode is inferred from the secret key prefix.

**Required Dashboard setup**

1. Enable Stripe Connect on the ContractorYou platform (sandbox first).
2. Add the webhook endpoint `{APP_URL}/api/webhooks/stripe` (legacy alias: `{APP_URL}/api/payments/stripe`). ContractorYou verifies Stripe signatures and accepts both snapshot events (`object: event`) and Accounts v2 thin events (`object: v2.core.event`).
3. Subscribe to payment events: `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`, `checkout.session.completed`, `charge.refunded`, `refund.updated`, `charge.dispute.created`.
4. Subscribe to Accounts v2 events: `v2.core.account.updated`, `v2.core.account[requirements].updated`, `v2.core.account[configuration.merchant].updated`, `v2.core.account[configuration.merchant].capability_status_updated`, `v2.core.account.closed`, `v2.core.account_link.returned`. Also keep `account.updated` if Stripe still emits it.
5. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` on Railway. Never commit keys. `STRIPE_CONNECT_CLIENT_ID` is optional and not required for Account Links.

**Verify a connected contractor:** Settings → Payments must show **Payments Active** only after Stripe confirms charges and payouts. Retry Set Up Payments always resumes the same stored account (idempotency key `cy-connect-v2-saas-{companyId}`).

**Troubleshoot onboarding:** If setup fails, contractors see a generic message. Owners can expand the administrator reference (never a secret). Check Railway logs for the Stripe request id, not card or bank data.

**Routing:** The server loads the invoice by id or public token, then charges that invoice's company connected account. The browser cannot choose company, destination, or amount.

**Receipts:** ContractorYou sends a receipt through Resend when email is configured. Stripe `receipt_email` is not set, so Stripe and ContractorYou do not both email a receipt.

**Safe testing:** Use Stripe test cards (`4242…`) and test bank accounts. Do not charge production customers to verify a deploy. Historical/imported invoices never create Stripe charges.

## License

Private — all rights reserved.

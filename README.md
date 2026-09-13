# Matrimony EventHub

A matrimony and wedding event management platform. Families find a match, then
book everything the wedding needs — venue, caterer, pandit, photographer — from
the same account.

**Full architecture:** [`docs/architecture.html`](docs/architecture.html) — nine
modules with business requirements, user stories, screens, component and routing
design, MongoDB collections, REST specs, security, AWS deployment, CI/CD and
roadmaps.

---

## Status

| Part | State |
|------|-------|
| `apps/api` — NestJS 12 | **Working.** 198 tests pass (177 e2e + 21 unit) |
| `apps/web` — Angular 22 | **Working.** Public marketplace, auth, customer, vendor, matrimony and admin portals |
| `packages/contracts` | **Working.** Consumed by both apps |
| Public browsing and guest enquiry | **Working.** A visitor reaches a real enquiry with no account |
| Booking slot lock | **Working.** Double-booking proven impossible under concurrency |
| Payments | **Working.** Fake gateway, signed webhook, double-entry ledger |
| Reviews and ratings | **Working.** Only from completed bookings; vendors can reply |
| Photos — vendor portfolio, profile | **Working.** Local disk or S3, with an admin moderation queue |
| Matrimony plans and chat | **Working.** Entitlements gate contact and conversations |
| Notifications | **In-app working.** SMS, email and push are logged, not delivered |
| `infrastructure/docker` | Compose file ready (needs Docker installed) |
| Reporting | Specified in the architecture doc, not yet built |

The nine e2e suites run against a real MongoDB replica set and cover auth, the
enquiry-to-booking funnel, booking concurrency, payments, reviews, subscriptions,
vendor portfolios, profile photos and matrimony matching. The auth slice is the
most thorough of them: registration, OTP verification, an httpOnly refresh
cookie, an authenticated `/auth/me`, session restore from the cookie alone and
refresh token rotation — reuse detection included, where replaying a rotated
token revokes the whole token family.

## Prerequisites

- **Node `^22.22.3 || ^24.15.0 || >=26`** — Angular 22 will not run on anything older
- npm 10+
- Docker Desktop, but only if you would rather not use the in-memory Mongo

### Switching Node

Node 24.20.0 is already installed under nvm-windows. `nvm use` needs elevation:

```powershell
# in an Administrator PowerShell
nvm use 24.20.0
```

Then reopen your terminal. The API also runs on Node 20, but the web app will not.

## Getting started

```powershell
# 1. Shared types (both apps import these)
cd packages/contracts; npm install; npm run build; cd ../..

# 2. Both apps, and the root itself. `npm run dev` and `npm run typecheck` are
#    root scripts with their own dependencies, so the root install is not
#    optional.
npm install
npm run setup

# 3. API environment
copy apps\api\.env.example apps\api\.env

# 4. A database — in its own terminal, and leave it running
cd apps/api; npm run dev:mongo     # in-memory replica set on port 27077
# ...or with Docker: npm run infra:up

# 5. Demo data — accounts, verified vendors, matrimony profiles
npm run db:seed

# 6. Run both apps
npm run dev
```

The Mongo port is fixed at 27077 and `.env.example` already points at it, so
there is nothing to paste between terminals. A replica set is required rather
than a standalone: the booking slot lock uses multi-document transactions.

- Web: <http://localhost:4200>
- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>

Uploaded photos are written under `apps/api/var/uploads` and served from there,
which needs no AWS account and no Docker — but read the last section below
before running a second API process.

### Demo accounts

`npm run db:seed` creates these. The password is **`EventHub@2026`** for all of
them; sign in at <http://localhost:4200/auth/login>.

| Mobile | Who | Where they land |
|--------|-----|-----------------|
| `9876543210` | Customer, also a matrimony seeker | `/customer` and `/matrimony` |
| `7702252727` | Sunrise Banquets (venue) | `/vendor` |
| `9876543211` | Pearl Gardens (venue) | `/vendor` |
| `9876543212` | Annapurna Caterers | `/vendor` |
| `9876543213` | Lens & Light Studio | `/vendor` |
| `8008052727` | Admin | KYC queue, photo moderation, booking ledger |

Outside production the API returns the OTP in the response body and every screen
that asks for a code prints it above the field, so no SMS is involved anywhere in
this walkthrough.

The seed deliberately stops at the inputs — vendors, packages, portfolios,
profiles, one wedding, one completed booking awaiting its review. Bookings,
quotes and payments are what you walk through in the app, and fabricating them
here would produce records the real code paths never created. If you want the
comparison screens populated without doing the clicking:

```powershell
cd apps/api; npm run seed -- --funnel
```

That adds two enquiries, one with both venues quoting. The `--` matters: npm
swallows an unknown flag passed to `npm run db:seed` from the root instead of
forwarding it to the script.

### A ten-minute walkthrough

**As a visitor, signed out.** Open <http://localhost:4200>. The front door is a
public page, not a login form. **Wedding vendors** lists every category with a
live count of who is actually in it; pick one and the listing has a filter rail whose every setting lives in the URL,
so a shortlist pasted into a family WhatsApp group arrives showing what the
sender was looking at. Open a vendor for their packages, portfolio and reviews —
the rating breaks down into quality, professionalism, value and flexibility, and
a vendor's replies sit under the reviews they answer. Now follow **Get quotes**:
`/enquire` takes a category, a date, a guest count and up to five vendors from
someone who has never signed up, and only asks for identity at the end, as a code
sent to the number a vendor would reply to anyway. That code creates the account
and the enquiry together.

**The wedding side.** Sign in as `9876543210`. Under **Find vendors** the search
is date-aware — only vendors free that day are listed — and one enquiry goes to
up to five of them. Now sign in as a vendor (`7702252727`) in a private window:
the enquiry is in their inbox with an SLA clock, and the quote builder totals the
lines while the server recomputes every figure on submit. Back as the customer,
**Enquiries** compares the quotes; accepting one locks that vendor's date against
everyone else and creates the booking. Pay the advance from the booking page —
the fake gateway has no hosted checkout, so the Pay button completes through a
signed webhook down the same verification and double-entry path a real payment
takes. The seeded completed booking is there so **Write a review** has something
to attach to: reviews come only from bookings that actually happened.

**The matrimony side.** Still as `9876543210`, open **Matrimony**. Search covers
a bride and a groom in every community the platform knows, each with a 36-guna
score against your profile; open one for the full Ashtakoota breakdown and the
Mangal Dosha verdict. Four profiles are hand-built to make the filters legible:
Divya shares a nadi with the demo profile, so that koota scores 0/8; Priya shares
its gotra, so adding `Kashyap` to the gotra exclusions removes her; Sneha is
manglik and the demo profile is not, which the panel flags; Anita has already
sent an interest. Accepting it under **Interests** unblurs the photos on both
sides. The phone number needs one thing more — a plan, under **Plans**, bought
through the same fake gateway. That split is deliberate: mutual interest is
consent and no amount of money substitutes for it, while a plan is what turns
seeing into speaking. **Conversations** opens on the same two gates.

**As the admin.** Sign in as `8008052727` for the KYC queue, the photo moderation
queue — the seed leaves a few profile photos pending on purpose — and the booking
ledger.

## Layout

```
apps/api            NestJS 12 modular monolith - nine bounded contexts
apps/web            Angular 22 SPA - feature-based, standalone, lazy-loaded
packages/contracts  Shared DTOs, enums and constants for both apps
infrastructure/     docker-compose, setup scripts, terraform
docs/               Architecture document
```

`packages/contracts` is consumed as an ordinary npm `file:` dependency. That is
plain npm, not monorepo tooling — there is no Nx, Lerna or workspace here, in
line with the project's architecture constraints. It is a build artifact both
apps import, so **rebuild it after changing a shared type** or the app you are
running will keep compiling against the old one.

The seed's portrait photographs live in
[`apps/api/scripts/lib/faces/`](apps/api/scripts/lib/faces/) and are of people
who do not exist. That folder's own README explains why a matrimony seed must
never use a real person's photograph, and how to swap the set — which is worth
doing, since the current portraits are mostly European and this is a Telugu
product.

## Commands

| Command | Does |
|---------|------|
| `npm run dev` | Both apps in watch mode |
| `npm run dev:api` | API only |
| `npm run build` | Production build of both |
| `npm run test:api` | Unit tests — guna scoring and commission maths |
| `npm run test:api:e2e` | Nine suites against an in-memory Mongo replica set |
| `npm run lint` | ESLint over both apps, zero warnings tolerated |
| `npm run typecheck` | Strict typecheck across both apps |
| `npm run db:seed` | Demo data |
| `npm run infra:up` / `:down` | Local Mongo, Redis, LocalStack |

CI runs contracts, then the API (typecheck, unit, e2e) and the web build, on
every push and every pull request. The e2e suite starts its own MongoDB, so the
pipeline exercises the same database topology you run locally.

## Four things worth knowing before you build on this

**NestJS 12 is ESM-only.** It ships `"type": "module"` with no CommonJS build,
so `apps/api` is ESM throughout: `module: nodenext`, and every relative import
carries an explicit `.js` extension (`./auth.service.js`, even from a `.ts`
file). Type-only imports from CommonJS packages like Mongoose must use
`import type`, or Node fails at load time with "Named export not found". Jest
runs under `--experimental-vm-modules`, and the `jest` global is not injected —
use `testTimeout` in config instead of `jest.setTimeout()`.

**Both apps are on TypeScript 6.** The root `typescript` devDependency is only
what `npm run typecheck` drives the app configs with; the versions that matter
are the ones in `apps/api` and `apps/web`. `packages/contracts` is still on 5.9
and emits the declarations both apps consume.

**`@nestjs/throttler` has no NestJS 12 release.** Its latest (6.5.0) is CommonJS
and peers at Nest 11. `src/core/throttle/throttle.guard.ts` is a small stand-in
with the same `@Throttle({ limit, ttlMs })` ergonomics. Its default store is
in-memory and therefore **per-process** — set `THROTTLE_STORE=redis` before
running more than one API task, or each task will enforce its own separate quota.

**Photos go to disk until there is more than one process.**
`MEDIA_DRIVER=local` writes uploads under `apps/api/var/uploads`, which is what
makes a fresh clone work with no AWS account. It does not survive a second
instance: the process serving a photo is rarely the one that stored it. Set
`MEDIA_DRIVER=s3` with `MEDIA_S3_BUCKET` and `MEDIA_S3_REGION` for anything
beyond one process. Credentials are never read from `.env` there — on AWS they
come from the task or instance role.

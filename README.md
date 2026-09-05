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
| `apps/api` — NestJS 12 | **Working.** 123 tests pass (102 e2e + 21 unit) |
| `apps/web` — Angular 22 | **Working.** Auth, customer, vendor and matrimony portals |
| `packages/contracts` | **Working.** Consumed by both apps |
| `infrastructure/docker` | Compose file ready (needs Docker installed) |
| Booking slot lock | **Working.** Double-booking proven impossible under concurrency |
| Notifications, reporting, chat | Specified in the architecture doc, not yet built |

The auth vertical slice is verified end to end through the Angular dev-server
proxy: registration, OTP verification, an httpOnly refresh cookie, an
authenticated `/auth/me`, session restore from the cookie alone, and refresh
token rotation — including reuse detection, where replaying a rotated token
revokes the whole token family.

## Prerequisites

- **Node `^22.22.3 || ^24.15.0 || >=26`** — Angular 22 will not run on anything older
- npm 10+
- Docker Desktop (for the local Mongo replica set, Redis and LocalStack)

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

# 2. Install both apps
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

### Demo accounts

`npm run db:seed` creates these. The password is **`EventHub@2026`** for all of
them; sign in at <http://localhost:4200/auth/login>.

| Mobile | Who | Where they land |
|--------|-----|-----------------|
| `9876500001` | Customer, also a matrimony seeker | `/customer` and `/matrimony` |
| `9876500010` | Sunrise Banquets (venue) | `/vendor` |
| `9876500011` | Pearl Gardens (venue) | `/vendor` |
| `9876500012` | Annapurna Caterers | `/vendor` |
| `9876500013` | Lens & Light Studio | `/vendor` |
| `9876500002` | Admin | KYC queue, booking ledger |

The seed deliberately stops at the inputs — vendors, profiles, one wedding, one
waiting interest. Bookings, quotes and payments are what you walk through in the
app, and fabricating them here would produce records the real code paths never
created.

### A five-minute walkthrough

**The wedding side.** Sign in as `9876500001`. Under **Find vendors**, pick a
category and a date and note that only vendors free that day are listed. Select
up to five and send one enquiry to all of them. Now sign in as a vendor
(`9876500010`) in a private window: the enquiry is in their inbox with an SLA
clock, and the quote builder totals the lines while the server recomputes every
figure on submit. Back as the customer, **Enquiries** compares the quotes;
accepting one locks that vendor's date against everyone else and creates the
booking. Pay the advance from the booking page — the fake gateway has no hosted
checkout, so the Pay button completes through a signed webhook down the same
verification and double-entry path a real payment takes.

**The matrimony side.** Still as `9876500001`, open **Matrimony**. Search shows
four published profiles with their 36-guna score; open one for the full
Ashtakoota breakdown and the Mangal Dosha verdict. Divya shares a nadi with the
demo profile, so that koota scores 0/8. Priya shares its gotra, so adding
`Kashyap` to the gotra exclusions removes her entirely. Sneha is manglik and the
demo profile is not, which the panel flags. Anita has already sent an interest —
accepting it under **Interests** is what reveals the phone number, on both sides.

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
line with the project's architecture constraints.

## Commands

| Command | Does |
|---------|------|
| `npm run dev` | Both apps in watch mode |
| `npm run dev:api` | API only |
| `npm run build` | Production build of both |
| `npm run test:api:e2e` | Auth flow against an in-memory Mongo replica set |
| `npm run infra:up` / `:down` | Local Mongo, Redis, LocalStack |
| `npm run typecheck` | Strict typecheck across both apps |

## Two things worth knowing before you build on this

**NestJS 12 is ESM-only.** It ships `"type": "module"` with no CommonJS build,
so `apps/api` is ESM throughout: `module: nodenext`, and every relative import
carries an explicit `.js` extension (`./auth.service.js`, even from a `.ts`
file). Type-only imports from CommonJS packages like Mongoose must use
`import type`, or Node fails at load time with "Named export not found". Jest
runs under `--experimental-vm-modules`, and the `jest` global is not injected —
use `testTimeout` in config instead of `jest.setTimeout()`.

**`@nestjs/throttler` has no NestJS 12 release.** Its latest (6.5.0) is CommonJS
and peers at Nest 11. `src/core/throttle/throttle.guard.ts` is a small stand-in
with the same `@Throttle({ limit, ttlMs })` ergonomics. Its store is in-memory
and therefore **per-process** — swap in the Redis store before running more than
one API task, or each task will enforce its own separate quota.

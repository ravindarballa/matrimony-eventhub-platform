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
| `apps/api` — NestJS 12 | **Working.** Boots, serves, 12/12 auth e2e tests pass |
| `packages/contracts` | **Working.** Builds, consumed by the API |
| `infrastructure/docker` | Compose file ready (needs Docker installed) |
| `apps/web` — Angular 22 | **Not yet scaffolded** — blocked on Node 24, see below |

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

# 2. API
cd apps/api; npm install; copy .env.example .env; cd ../..

# 3. Web - only after switching to Node 24
./infrastructure/scripts/setup-web.ps1

# 4. Local infrastructure
npm run infra:up

# 5. Run both apps
npm run dev
```

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>
- Web: <http://localhost:4200>

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

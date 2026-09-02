# LMS v2 — Learning Management System

A production-grade Arabic-first Learning Management System with role-based
portals for **students**, **instructors**, and **administrators**. Built on
a modern TypeScript stack end-to-end:

| Tier       | Stack                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Backend    | NestJS 10 · Prisma 5 · PostgreSQL 16 · Argon2id · JWT (rotating refresh) · Swagger     |
| Frontend   | React 18 · Vite 5 · TypeScript 5 (strict) · Tailwind CSS 3 (RTL) · TanStack Query 5  |
| Database   | PostgreSQL 16 (numeric money, append-only ledger, pessimistic row locks)              |
| Infra      | Docker Compose (local Postgres), Nginx reverse proxy (production)                     |

> The platform supports per-lecture purchases, atomic wallet transactions,
> subscription activation codes, exam attempts with essay auto-grading
> deferred to teachers, and an admin review queue for manual wallet
> top-ups — all wired through the same financial-correctness guarantees
> described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Repository layout

```
.
├── backend/            # NestJS API (port 3000)
│   ├── prisma/         # schema.prisma + migrations + seed.ts
│   ├── src/
│   │   ├── main.ts                 # bootstrap (helmet, CORS, Swagger, validation)
│   │   ├── app.module.ts           # root module — global guards + Throttler
│   │   ├── common/                 # Prisma service, decorators, guards, filters
│   │   ├── config/                 # env-driven typed config
│   │   └── modules/                # auth, users, academic, courses, exams,
│   │                               #   wallet, wallet-topup, purchases,
│   │                               #   subscriptions, notifications, health
│   ├── test/           # Jest e2e + unit (embedded-postgres for concurrency tests)
│   └── docker-compose.yml          # local Postgres 16
├── frontend/           # React SPA (port 5173 dev / static dist in prod)
│   ├── src/
│   │   ├── App.tsx                # role-based routing (student/instructor/admin)
│   │   ├── api/                   # axios client + per-resource modules
│   │   ├── components/            # layout (DashboardShell, RequireAuth) + UI
│   │   ├── features/              # auth, student, instructor, admin pages
│   │   ├── stores/authStore.ts    # Zustand auth state
│   │   └── types/domain.ts        # mirrors backend Prisma types
│   └── vite.config.ts             # /api/v2 proxy → http://localhost:3000
├── docs/               # supplemental documentation (this folder)
├── legacy/             # v1 reference (PHP-era frontend + admin SPAs)
├── .env.example        # documented root env vars (see docs/LOCAL_DEV.md)
├── DEPLOYMENT.md       # production install (systemd + Nginx + SSL)
├── SECURITY_REVIEW.md  # security review across all domains
├── SCHEMA.md           # Prisma schema narrative
└── ANALYSIS.md         # full system analysis
```

---

## Quick start

```bash
# 1) PostgreSQL via Docker Compose
cd backend && docker compose up -d

# 2) Backend
cd backend
npm install
cp .env.example .env          # adjust SESSION_SECRET + DATABASE_URL
npx prisma migrate deploy
npm run prisma:seed            # creates admin + sample academic tree
npm run start:dev              # http://localhost:3000

# 3) Frontend (in a new shell)
cd frontend
npm install
cp .env.example .env          # defaults are fine for local dev
npm run dev                    # http://localhost:5173
```

Then open <http://localhost:5173> and sign in with one of the
[seed credentials](docs/SEED_CREDENTIALS.md).

> The Vite dev server proxies `/api/v2/*` to the backend, so the frontend
> never has to know the API host during development.

---

## Scripts

### Backend (`/backend`)

| Command                       | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `npm run build`               | Compile TypeScript → `dist/` (Nest CLI, no emit on error) |
| `npm run start:dev`           | Watch-mode dev server (port 3000)                        |
| `npm run start:prod`          | Run compiled `dist/main.js`                              |
| `npm run lint`                | ESLint with auto-fix                                     |
| `npm run format`              | Prettier write                                           |
| `npm run prisma:generate`     | Regenerate Prisma client                                 |
| `npm run prisma:migrate`      | `prisma migrate dev` (interactive)                       |
| `npm run prisma:deploy`       | `prisma migrate deploy` (CI / production)               |
| `npm run prisma:studio`       | Prisma Studio at <http://localhost:5555>                 |
| `npm run prisma:seed`         | Run `prisma/seed.ts` (admin + sample hierarchy)          |
| `npm test`                    | Jest unit + e2e (embedded PostgreSQL)                    |
| `npm run test:cov`            | Coverage report → `coverage/`                            |
| `npm run test:e2e`            | E2E against `DATABASE_URL_TEST`                          |

### Frontend (`/frontend`)

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `npm run dev`         | Vite dev server (HMR) on port 5173                 |
| `npm run build`       | `tsc -b` strict type-check + Vite production build |
| `npm run preview`     | Preview the production bundle locally              |
| `npm run lint`        | ESLint                                             |
| `npm run typecheck`   | `tsc --noEmit`                                     |

---

## Documentation

- [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) — Local development setup (step-by-step)
- [docs/DOCKER.md](docs/DOCKER.md) — Docker Compose setup for Postgres + future images
- [docs/SEED_CREDENTIALS.md](docs/SEED_CREDENTIALS.md) — Default users created by `prisma:seed`
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Module map, financial guarantees, RBAC
- [docs/API.md](docs/API.md) — REST endpoints (versioned under `/api/v2`)
- [docs/DEPLOYMENT_OPERATIONS.md](docs/DEPLOYMENT_OPERATIONS.md) — Production checklist
- [DEPLOYMENT.md](../DEPLOYMENT.md) — Arabic install + systemd + Nginx + SSL
- [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) — Domain-by-domain security review
- [SCHEMA.md](../SCHEMA.md) — Prisma schema narrative
- [ANALYSIS.md](../ANALYSIS.md) — Full system analysis

The interactive Swagger UI is also available at
<http://localhost:3000/docs> whenever the backend is running.

---

## Production highlights

- **Argon2id** password hashing (configurable cost params, defaults
  pinned to OWASP 2024 guidance).
- **JWT access tokens** (15 min) + **rotating refresh tokens** with
  reuse-detection family revocation.
- **Numeric money** (`NUMERIC(12,2)`), append-only ledger,
  `SELECT … FOR UPDATE` row locks inside `Serializable` transactions.
- **Idempotency keys** on every wallet transaction — replays resolve
  to the original ledger row instead of double-charging.
- **Helmet** security headers (HSTS in production), CORS allow-list,
  global throttler (120 req/min/IP), and global `ValidationPipe`
  with `forbidNonWhitelisted`.
- **Per-role routing** on the frontend with `<RequireAuth roles={…}>`
  guards redirecting wrong-role users back to their role's home.
- **RTL Arabic UI** out of the box (`<html dir="rtl">`, Cairo /
  Tajawal fonts), all domain data stored in Arabic + English.

See [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) for the full review and
[DEPLOYMENT.md](../DEPLOYMENT.md) for the production install runbook.

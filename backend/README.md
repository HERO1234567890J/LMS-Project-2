# Law LMS — Backend

Express + PostgreSQL backend for the law-college LMS. Session-based auth (no JWT), raw SQL (no ORM), single admin role (no independent instructor accounts), no wallet backend.

## Stack

- **Node.js 20+ / Express 4**
- **PostgreSQL** via the `pg` driver — plain SQL, no Prisma/Knex migrations layer
- **express-session** + `connect-pg-simple` (sessions stored in Postgres) — no JWT anywhere in this codebase
- **bcryptjs** for password hashing
- **multer** for uploads, with a magic-byte content check (`fileKind`) before a file is accepted
- **helmet** + **express-rate-limit** on the login and code-redemption endpoints

## Layout

```
backend/
├── src/
│   ├── server.js     # the entire Express app: middleware, all routes, startup
│   ├── db.js         # pg Pool + query()/tx() helpers
│   └── schema.js      # raw CREATE TABLE SQL + seed rows for levels/terms
├── scripts/
│   ├── migrate.js     # runs schema.js against DATABASE_URL
│   ├── seed.js        # upserts the single admin account
│   └── check.js       # smoke-loads the server module
└── uploads/            # local file storage for lecture videos/files/covers (gitignored)
```

There is no `backend/prisma`, no `backend/dist`, and no NestJS module tree — the whole API lives in `src/server.js`.

## Data model

One `users` table with `role IN ('admin','student')` — there is no separate instructor/teacher table. Admin-authored fields like a course's presenter are just a free-text `doctor_name` column on `subjects`, not a foreign key to another account. Students get an optional `students` row (level, guardian info, etc.) joined 1:1 on `user_id`.

Academic hierarchy: `levels` → `terms` → `subjects` → `lectures` (+ `lecture_files`). Access control: `activation_codes` (single-use, tied to one subject) redeemed into `subscriptions`. Exams: `exams` → `exam_questions` → `exam_attempts` → `exam_answers`, with `mcq`/`true_false` auto-graded on submit and `essay` questions left for manual grading via the essay queue.

There is intentionally **no wallet or payment-ledger table** — any wallet UI in the frontend is disabled/"coming soon" by design, not backed by an API here.

## Auth

- `POST /api/auth/login` and `POST /api/auth/register` set `req.session.userId` / `req.session.role` — that's the entire auth model. No access/refresh tokens, no `Authorization` header.
- `requireAuth` / `requireAdmin` / `requireStudent` middleware just check `req.session`.
- Sessions are persisted in Postgres by `connect-pg-simple` (table auto-created on first run) and signed with `SESSION_SECRET`.

## Setup

```bash
# 1. Install deps
npm install

# 2. Point at a Postgres database (create one first, e.g. `createdb law_lms`)
cp .env.example .env
# edit .env: at minimum set DATABASE_URL and SESSION_SECRET

# 3. Create the schema (idempotent — safe to re-run)
npm run migrate

# 4. Seed the single admin account
npm run seed
#   optional: ADMIN_PHONE=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed

# 5. Run
npm start
```

`npm run migrate` and app startup both call the same `schemaSql` (all `CREATE TABLE IF NOT EXISTS`), so there is no separate migrations directory to track — schema changes are made directly in `src/schema.js`.

## Endpoints (by router)

All routes are mounted directly on the Express app in `src/server.js`; there's no versioned `/api/v2` prefix.

| Prefix | Auth | Covers |
|---|---|---|
| `POST /api/auth/login`, `/register` | public | session login / student self-registration |
| `GET /api/auth/me` | any session | current user |
| `/api/teacher/*` | `requireAdmin` | courses, lessons, exams/questions, students, activation codes, attempts, essay grading, notifications, dashboard stats |
| `/api/student/*` | `requireStudent` | profile, course catalog, code redemption, subscriptions, lessons, exam attempts, notifications |
| `GET /api/health` | public | liveness check |

The frontend (`/`, `/admin.html`, `/client.html`, `/login-teacher.html`) is served straight from the `frontend/` folder via `express.static` — no build step, no bundler.

## Database

- PostgreSQL, single database, no schema-per-tenant.
- Schema lives entirely in `src/schema.js` as raw SQL — apply it with `npm run migrate`.
- Seed: `scripts/seed.js` (admin account only; sample subjects/courses are created through the admin UI, not the seed script).

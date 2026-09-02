# Seed Credentials

`backend/scripts/seed.js` provisions the database with exactly one account: a single admin. This document lists the default credentials it creates so you can sign in immediately after a fresh database.

> **⚠️ These credentials are for local development only.** The defaults are hard-coded in `seed.js` and this file, and are committed to the repo. Always override them (or change the password immediately) before any non-development deployment — see [DEPLOYMENT_OPERATIONS.md](DEPLOYMENT_OPERATIONS.md#5-first-admin).

---

## How to run

```bash
cd backend
npm run migrate       # apply schema first (idempotent)
npm run seed           # idempotent — safe to re-run
```

The seed does `INSERT ... ON CONFLICT (email) DO UPDATE`, so running it twice does not create duplicates — it refreshes the name/phone/password hash on the existing row instead.

---

## Default account

| Field | Default | Override env var |
|---|---|---|
| Name | `Platform Admin` | — |
| Phone | `01000000000` | `ADMIN_PHONE` |
| Email | `admin@law-lms.local` | `ADMIN_EMAIL` |
| Password | `Admin@12345` | `ADMIN_PASSWORD` |
| Role | `admin` | — |

```bash
ADMIN_PHONE=01000000000 \
ADMIN_EMAIL=admin@your-domain.com \
ADMIN_PASSWORD='STRONG_PASSWORD_HERE' \
npm run seed
```

> The seed creates **only** the admin. There is no separate teacher/instructor role in this app — `users.role` is `admin` or `student` only, and a subject's presenter is just the free-text `doctor_name` column, not another account.
>
> Student accounts come from:
> - **Self-registration**: `POST /api/auth/register` → role `student`.
> - There is no admin-facing "create student" endpoint — accounts are always self-registered, then managed (banned/unbanned/deleted) by the admin via `/api/teacher/students/*`.

---

## What else does the seed create?

Nothing. Unlike the old Prisma seed this replaced, `scripts/seed.js` does **not** build a sample academic tree (levels/terms/subjects/lectures/exams) — only `levels` and `terms` get their fixed rows, and those come from `schema.js`'s own `INSERT ... ON CONFLICT DO NOTHING`, not from the seed script. Sample subjects, lectures, and exams for testing are created through the admin UI after logging in, not via seeding.

---

## Rotating the admin password

### Option 1 — re-run the seed (any environment)

```bash
cd backend
ADMIN_EMAIL=admin@your-domain.com ADMIN_PASSWORD='NEW_PASSWORD' npm run seed
```

This is safe in production — it only touches the row matching that email.

### Option 2 — via the admin UI

Sign in, then use the change-password screen. Endpoint: `POST /api/teacher/auth/change-password` (`{ current_password, new_password, confirm_new_password }`).

### Option 3 — directly in the database

```sql
-- Generate a fresh bcrypt hash from a Node REPL:
--   node -e "require('bcryptjs').hash('NEW_PASSWORD', 12).then(console.log)"
UPDATE users
   SET password_hash = '<paste bcrypt hash here>'
 WHERE email = 'admin@your-domain.com';
```

---

## Disabling the seed in production

`npm run seed` is safe to leave available — it's not a fixture loader that populates fake data, just an idempotent upsert of one admin row keyed on the email you give it. If you'd still rather remove the option entirely:

1. Remove `backend/scripts/seed.js` and its `seed` entry in `package.json` (the command then fails loudly instead of silently doing nothing).
2. Create the first admin directly via SQL instead, with a freshly generated bcrypt hash (same pattern as Option 3 above).

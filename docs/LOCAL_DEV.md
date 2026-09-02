# Local Development Guide

Running the LMS stack on your laptop from a clean checkout. There is **no build step and no bundler anywhere in this project** — the frontend is static HTML/CSS/JS served directly by the backend, and the backend is plain Node.js. You need Node.js and a PostgreSQL instance; nothing else.

---

## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20 | `node -v` |
| npm | ≥ 10 | `npm -v` |
| PostgreSQL | 14+ | `psql --version` |

There is no `docker-compose.yml` or `Dockerfile` in this repo (see [DOCKER.md](DOCKER.md)) — install Postgres however you normally would, or run an ad-hoc container yourself.

---

## 1. Clone

```bash
git clone <your-fork-or-origin> LMS-Project
cd LMS-Project
```

---

## 2. Create a database

```bash
createdb law_lms
# or, with an existing Postgres role/password setup:
sudo -u postgres psql -c "CREATE DATABASE law_lms;"
```

---

## 3. Backend — install, configure, migrate, seed

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and at minimum set:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/law_lms
SESSION_SECRET=any-random-string-for-local-dev
```

Create the schema (idempotent `CREATE TABLE IF NOT EXISTS` — safe to re-run):

```bash
npm run migrate
```

Seed the single admin account:

```bash
npm run seed
# optional overrides:
ADMIN_PHONE=01000000000 ADMIN_EMAIL=admin@law-lms.local ADMIN_PASSWORD='Admin@12345' npm run seed
```

Run the server:

```bash
npm start
```

You should see:

```
Law LMS server listening on http://localhost:3000
```

There's no separate watch/reload script — restart `npm start` after backend code changes (`nodemon src/server.js` works fine if you want auto-reload; it isn't a project dependency).

Sanity check:

```bash
curl http://localhost:3000/api/health
```

---

## 4. Frontend — nothing to install

The backend serves `frontend/` directly via `express.static` once it's running — there's no separate frontend process, dev server, or `npm run dev`. Open:

- <http://localhost:3000/> — login page
- <http://localhost:3000/admin.html> — admin dashboard (`teacher-script.js`)
- <http://localhost:3000/client.html> — student dashboard (`script.js`)

Editing any HTML/CSS/JS file under `frontend/` takes effect on the next browser refresh — no build/watch step.

---

## 5. Sign in

Use the [seed credentials](SEED_CREDENTIALS.md) (the phone/email/password you seeded in step 3, or the script's defaults if you ran it with no overrides).

> Change the seeded admin password before using this anywhere other than a local machine. See [DEPLOYMENT.md](../DEPLOYMENT.md) for the production hardening checklist.

---

## 6. Useful dev loops

### Reset the database (drops all data, keeps the schema definitions in `src/schema.js`)

```bash
cd backend
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run migrate
npm run seed
```

### Smoke-check the server module loads

```bash
npm run check
```

### No test suite

There is currently no automated test suite (no Jest, no `npm test` script) — verify changes manually against the endpoints in [API.md](API.md).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED` connecting to Postgres | Postgres not running, or wrong host/port | Confirm with `psql "$DATABASE_URL"`, check `DATABASE_URL` |
| `password authentication failed` | Wrong credentials in `DATABASE_URL` | Fix the connection string in `.env` |
| `401` on every `/api/teacher/*` or `/api/student/*` call | No session cookie sent, or session table missing | Log in first via `/api/auth/login`; confirm cookies aren't blocked (same-origin only, no CORS configured) |
| Uploads fail with 400 "Rejected file content type" | File content doesn't match an allowed magic number for that upload type | Check the allowed list per route in `server.js` (`validateUpload` calls) |
| `EADDRINUSE :::3000` | Another process already on port 3000 | `lsof -i:3000`, kill it, or set a different `PORT` in `.env` |

If you're still stuck, check the backend's console output — every server error is logged there before the generic JSON error is returned to the browser.

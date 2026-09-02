# Docker Setup

**There is no Docker anything in this repository right now** — no `docker-compose.yml`, no `Dockerfile`, at the root or under `backend/`. This document previously described a two-service Compose stack (Postgres + a Vite-built frontend behind Nginx) for the old NestJS/Prisma backend; none of that applies to the current Express + static-HTML stack, so it's been replaced with what's actually true today plus an optional, accurate reference if you want to containerise this version.

For local development without Docker at all, see [LOCAL_DEV.md](LOCAL_DEV.md) — Postgres installed natively plus `node src/server.js` is all you need.

---

## 1. Local Postgres via Docker (optional, ad-hoc)

If you'd rather not install Postgres natively, a single throwaway container works fine — there's no bundled Compose file to manage it for you:

```bash
docker run --name law_lms_pg -d \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=law_lms \
  -p 5432:5432 \
  -v law_lms_pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

Matches the default in `backend/.env.example`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/law_lms
```

Wipe it: `docker rm -f law_lms_pg && docker volume rm law_lms_pgdata`.

---

## 2. Containerising the app (reference only, not shipped)

The whole app — API and static frontend together — is one Express process with no build step, so a single-stage image covers it. This is a reference you'd need to add as `backend/Dockerfile` yourself; nothing in the repo assumes it exists.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm --prefix backend ci --omit=dev
COPY backend ./backend
COPY frontend ./frontend
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
```

(The backend resolves `frontend/` two directories up from `src/server.js` — see `rootDir`/`frontendDir` in `server.js` — so both folders need to land in the image at the same relative layout shown above.)

```bash
docker build -t law-lms:dev .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/law_lms" \
  -e SESSION_SECRET="change-me" \
  -e NODE_ENV=production \
  law-lms:dev
```

Run the schema migration as a one-shot before first boot:

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/law_lms" \
  law-lms:dev \
  node backend/scripts/migrate.js
```

> `host.docker.internal` reaches Postgres running on the host from inside the container. On Linux, add `--add-host=host.docker.internal:host-gateway` to the `docker run` command.

There is no separate frontend image or Nginx config to build — the same Express process serves `frontend/` via `express.static`, so a second container would just be redundant.

---

## 3. If you actually want a maintained Compose file

None of the above is committed. If you add `docker-compose.yml` for real, keep it to two services (`postgres`, `app`) matching the Dockerfile above — resist re-introducing a separate frontend build/Nginx service, since this stack deliberately has no frontend build step to containerise.

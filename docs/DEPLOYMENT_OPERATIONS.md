# Deployment & Operations

The reference production install is documented in [DEPLOYMENT.md](../DEPLOYMENT.md) (Arabic) and covers the systemd + Nginx + Let's Encrypt path for this Express + PostgreSQL app. This document is the **operational** checklist: what to verify before going live, and how to keep the system healthy afterwards.

> For local development, see [LOCAL_DEV.md](LOCAL_DEV.md). For an optional container image, see [DOCKER.md](DOCKER.md) — nothing here assumes Docker.

---

## 1. Pre-deployment checklist

### Secrets

- [ ] `SESSION_SECRET` is freshly generated (≥ 32 bytes of randomness) — this is the only auth secret; there is no JWT signing key.
- [ ] `DATABASE_URL` points to a reachable Postgres instance, ideally with TLS (`?sslmode=require`) if it's not on localhost.
- [ ] No `.env` file is shipped to the server. Values are injected via systemd `EnvironmentFile=` (chmod 600) or your process manager's equivalent.

### Configuration

- [ ] `NODE_ENV=production` is exported **before** the process starts — this is what makes the session cookie `secure`. Without it, cookies are sent over plain HTTP, which is fine for local dev but wrong in production.
- [ ] `PORT` matches the systemd unit / reverse proxy upstream.
- [ ] `MAX_UPLOAD_BYTES` matches your expected lecture-video sizes (default 100MB) and your reverse proxy's own body-size limit (e.g. Nginx `client_max_body_size`).

### Database

- [ ] `npm run migrate` has been run against the production DB (applies `src/schema.js`, idempotent).
- [ ] A backup of the DB exists **before** running migrations against a non-empty database.
- [ ] The DB role used by the app has only the privileges it needs — no `SUPERUSER`.

### TLS

- [ ] Certificate is valid and auto-renewing (Let's Encrypt via certbot / Caddy / Traefik).
- [ ] HTTP → HTTPS redirect is in place at the reverse proxy.
- [ ] Helmet's default security headers are present (verify with `curl -I https://your-domain`); this app runs Helmet with `contentSecurityPolicy: false`, so CSP is **not** set by the app — add it at the reverse proxy if you want one.

### Observability

- [ ] Logs ship to a central aggregator (journald → your log tool of choice) — the app only logs to stdout/stderr via `console.error` in `sendError()`.
- [ ] `GET /api/health` is wired into the load balancer / uptime check. There is no separate readiness endpoint that checks DB connectivity.
- [ ] DB CPU / RAM / connection count are monitored.

---

## 2. systemd unit (reference)

`/etc/systemd/system/law-lms.service`:

```ini
[Unit]
Description=Law LMS backend (Express)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lms
Group=lms
WorkingDirectory=/opt/law-lms/backend
EnvironmentFile=/etc/law-lms/backend.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/law-lms/backend/uploads
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now law-lms
sudo systemctl status law-lms
sudo journalctl -u law-lms -f
```

---

## 3. Nginx (reference)

`/etc/nginx/sites-available/law-lms.conf`:

```nginx
server {
    listen 80;
    server_name lms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name lms.example.com;

    ssl_certificate     /etc/letsencrypt/live/lms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lms.example.com/privkey.pem;

    add_header X-Content-Type-Options nosniff          always;
    add_header X-Frame-Options          SAMEORIGIN     always;
    add_header Referrer-Policy          "no-referrer"  always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 100m;  # keep in sync with backend MAX_UPLOAD_BYTES

    # The Node process serves both the API and the static frontend —
    # there is no separate frontend origin/build to route around.
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. Database migrations in production

`npm run migrate` runs the same `CREATE TABLE IF NOT EXISTS ...` script the app itself runs on startup — it's idempotent and safe to re-run, but is still best run as a deliberate step before restarting the app, not silently on every boot:

```bash
cd /opt/law-lms/backend
sudo -u lms DATABASE_URL="$DATABASE_URL" npm run migrate
sudo systemctl restart law-lms
```

There is no migration history table and no down-migrations — schema changes are made directly in `src/schema.js` and are additive (`CREATE TABLE IF NOT EXISTS`, no `DROP`/`ALTER` scripting). Destructive schema changes need to be written and reviewed as raw SQL by hand.

---

## 5. First admin

`npm run seed` works in production too — it's a plain `INSERT ... ON CONFLICT (email) DO UPDATE`, not a dev-only fixture loader:

```bash
cd /opt/law-lms/backend
ADMIN_PHONE=01000000000 \
ADMIN_EMAIL=admin@your-domain.com \
ADMIN_PASSWORD='STRONG_PASSWORD_HERE' \
DATABASE_URL="$DATABASE_URL" \
npm run seed
```

Verify login, then **change the password** via the admin UI immediately — see [SEED_CREDENTIALS.md](SEED_CREDENTIALS.md).

---

## 6. Backups

- **Postgres**: nightly `pg_dump` to object storage (S3 / GCS / Azure Blob). Verify restore quarterly.
- **Uploads**: `backend/uploads/` holds every lecture video, attachment, and cover image on local disk — back it up (or move it to object storage) with the same rigor as the database; losing it loses the files, not just metadata.
- **Config**: keep `backend.env` and the systemd unit in a private secrets store.

---

## 7. Incident playbook

| Symptom | First check |
|---|---|
| 5xx spike | `journalctl -u law-lms -n 200` for stack traces (every error is logged via `console.error` before the JSON response) |
| Everyone suddenly logged out | `SESSION_SECRET` changed, or the `session` table (managed by `connect-pg-simple`) was dropped/truncated |
| DB connection errors | `SELECT * FROM pg_stat_activity;` — kill idle-in-transaction sessions |
| Upload requests failing with 400 | Content doesn't match the expected magic bytes for that upload type (`validateUpload` in `server.js`) — not a size or auth issue |
| Disk full | Check `backend/uploads/` growth first — it's local disk, not object storage, and has no automatic pruning |

---

## 8. See also

- [DEPLOYMENT.md](../DEPLOYMENT.md) — full Arabic install runbook
- [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) — security review
- [ARCHITECTURE.md](ARCHITECTURE.md) — request flow and data model
- [LOCAL_DEV.md](LOCAL_DEV.md) — local development
- [DOCKER.md](DOCKER.md) — optional containerisation

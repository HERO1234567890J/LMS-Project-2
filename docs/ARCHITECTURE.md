# Architecture

A high-level map of the LMS codebase as it actually exists: a static, hand-written frontend served by a single-file Express backend over raw SQL.

---

## 1. Layered overview

```
┌──────────────────────── Browser (plain HTML/CSS/JS, no build step, RTL Arabic) ───────────────────────┐
│  /login.html · /admin.html (admin/teacher-script.js) · /client.html (client/script.js)                 │
│  fetch() with credentials:'same-origin' — no token storage, the session cookie does the work            │
└────────────────────────────────────────────┬────────────────────────────────────────────────────────────┘
                                              │  HTTPS + JSON (+ multipart for uploads)  — cookie: law_lms.sid
                                              ▼
┌──────────────────────────────── Express app — backend/src/server.js (port 3000) ────────────────────────┐
│ helmet · express.json · express.static('/uploads') · express-session (store: connect-pg-simple)          │
│ rate limiters on /auth/login and /student/redeem                                                          │
│                                                                                                             │
│ app.post('/api/auth/login' | '/register')     — sets req.session.userId/role                              │
│ teacher = express.Router()  mounted at /api/teacher   — requireAdmin on every route                        │
│ student = express.Router()  mounted at /api/student   — requireStudent on every route                      │
│ app.get('/api/auth/me')                                                                                     │
│ app.use(express.static(frontendDir))  — serves frontend/ directly, plus the 4 HTML entrypoints              │
└────────────────────────────────────────────┬────────────────────────────────────────────────────────────┘
                                              │  raw SQL via pg (no ORM)
                                              ▼
┌───────────────────────────────────── PostgreSQL 16 (backend/src/schema.js) ───────────────────────────────┐
│ users · students · levels · terms · subjects · lectures · lecture_files                                     │
│ activation_codes · subscriptions                                                                             │
│ exams · exam_questions · exam_attempts · exam_answers                                                        │
│ lesson_progress · notifications · notification_reads · session (auto-created by connect-pg-simple)          │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

There is no separate `modules/` tree, no DI container, no ORM layer — `backend/src/server.js` is the whole application: middleware setup, both routers, and every handler, top to bottom.

---

## 2. What was deliberately left out

This backend replaced an earlier NestJS + Prisma implementation that assumed a multi-instructor platform with a real money wallet. Those assumptions are cancelled:

- **No instructor/teacher accounts.** `users.role` is only `admin` or `student`. A subject's presenter is a free-text `doctor_name` column, not a foreign key to another user — there is nothing in the schema a "select the teacher" dropdown could correctly point at.
- **No wallet or ledger tables.** No `WalletTransaction`, no top-up requests, no idempotency keys, no row-locked balance transaction. Any wallet UI in the client frontend is intentionally inert ("coming soon"), not backed by an endpoint.
- **No JWT, no refresh tokens.** Auth is a signed session cookie (`express-session` + `connect-pg-simple`), full stop.
- **No Prisma migrations directory.** The schema is one `CREATE TABLE IF NOT EXISTS` script (`src/schema.js`), applied idempotently by `npm run migrate`.

---

## 3. Backend routes (by router)

| Router | Mount | Guard | Covers |
|---|---|---|---|
| — | `/api/auth` | — | login, register, `/me` |
| `teacher` | `/api/teacher` | `requireAdmin` | courses (subjects), lessons (lectures + uploads), exams/questions, students, activation codes, attempts, essay grading, notifications, dashboard stats |
| `student` | `/api/student` | `requireStudent` | profile, catalog, code redemption, subscriptions, lesson/exam consumption, own attempts, notifications |

See `docs/API.md` for the full endpoint table.

---

## 4. Authentication

- `POST /api/auth/login` looks up `users` by phone or email, verifies with `bcrypt.compare`, and calls `signIn()`, which sets `req.session.userId` / `req.session.role` and updates `last_login_at`.
- `requireAuth` / `requireAdmin` / `requireStudent` are plain middleware functions that check `req.session.userId` and `req.session.role` — no token parsing anywhere.
- Sessions live in Postgres (`connect-pg-simple`, table auto-created), signed with `SESSION_SECRET`, cookie name `law_lms.sid`, 14-day `maxAge`, `secure` only when `NODE_ENV=production`.
- Passwords: `bcryptjs`, cost factor 12 (`bcrypt.hash(password, 12)`).

---

## 5. Exams

`exams` → `exam_questions` (`mcq` | `true_false` | `essay`) → `exam_attempts` → `exam_answers`.

- Starting an attempt (`POST /api/student/exams/:id/attempts`) checks the student is subscribed to the subject and that the lecture is unlocked (all earlier lectures in the same subject completed), then strips answer keys from the returned `options`.
- `mcq` and `true_false` are auto-graded on submit by direct comparison (`selected_option_id === correct_index`, 0-based). `essay` answers are left with `points_awarded = NULL` until an admin grades them via the essay queue.
- `finalizeAttempt()` only marks the attempt `graded` once no essay answers are still pending; passing (`score / total >= pass_percent`) marks the lecture complete in `lesson_progress`.
- The admin exam-builder's correct-answer selector must emit 0-based indices matching `options[]` — see the note in `docs/API.md`.

---

## 6. File uploads

`multer` writes to `backend/uploads/`, filenames randomized (`Date.now()-<16 hex chars><ext>`). Before accepting a file, `fileKind()` reads the first 16 bytes and matches known magic numbers (JPEG/PNG/GIF/PDF/ZIP/video containers) — extension and declared MIME type are not trusted on their own; a mismatched file is deleted and rejected with 400.

---

## 7. Frontend

Three static entry points served straight from `frontend/` with no build step, no bundler, no framework:

| File | Served at | Script |
|---|---|---|
| `frontend/login.html` | `/`, `/login-teacher.html` | inline |
| `frontend/admin/index.html` | `/admin.html` | `teacher-script.js` |
| `frontend/client/index.html` | `/client.html` | `script.js` |

Both scripts talk to the backend through a thin `fetch()` wrapper (`api()` in each file) with `credentials: 'same-origin'`, so the session cookie is all that's needed — there's no client-side auth state beyond what `/api/*/auth/me` returns on load.

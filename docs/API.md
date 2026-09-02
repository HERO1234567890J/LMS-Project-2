# API Reference

All endpoints are mounted directly on the Express app — there is **no `/api/v2` prefix** and **no JWT**. Authentication is a signed `express-session` cookie (`law_lms.sid`), set on `POST /api/auth/login` or `POST /api/auth/register` and sent automatically by the browser on every subsequent request (`credentials: 'same-origin'` from the frontend's `fetch` wrapper).

There is no Swagger/OpenAPI UI — this document is the source of truth, taken from `backend/src/server.js`.

---

## Conventions

| Item | Convention |
|---|---|
| Path prefix | none for auth/health; `/api/teacher/*` (admin) and `/api/student/*` (student) for everything else |
| Content type | `application/json` (routes accepting files use `multipart/form-data` via multer) |
| Auth | `express-session` cookie only — no `Authorization` header, no tokens |
| Currency | `NUMERIC(10,2)` columns, returned as numeric/string values from `pg` — no wallet or payment endpoints exist |
| Pagination | `?page=1&page_size=20` on the list endpoints that support it (students, attempts) |
| Errors | `{ "message": "..." }` with an HTTP status code; unexpected errors are logged server-side and return 500 |

---

## Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public, rate-limited | `{ phone or email, password }` → sets session cookie |
| POST | `/api/auth/register` | public | Self-register as a student: `{ name, phone, password, password_confirmation, grade/stage/level, ... }` |
| GET | `/api/auth/me` | any session | Current user |

## Teacher / admin routes (`/api/teacher/*`, requires an admin session)

| Method | Path | Description |
|---|---|---|
| GET/POST | `/auth/me`, `/auth/logout`, `/auth/change-password` | Admin session management |
| GET | `/stats` | Dashboard counters + 8 most recent students |
| GET/POST | `/courses` | List / create subjects (called "courses" in the API and UI) |
| PATCH/DELETE | `/courses/:id` | Update / delete a subject |
| POST | `/courses/:id/cover` | Upload a cover image (multipart, validated by file content, not extension) |
| GET/POST | `/lessons` | List / create lectures |
| PATCH/DELETE | `/lessons/:id` | Update / delete a lecture |
| POST | `/lessons/:id/video` | Upload a lecture video |
| POST | `/lessons/:id/files` | Upload up to 10 lecture attachments (PDF/ZIP) |
| GET/POST | `/exams` | List / create exams (tied to one lecture) |
| POST | `/exams/:id/questions` | Add a question (`mcq` \| `true_false` \| `essay`) |
| GET | `/students`, `/students/:id` | List (paginated, searchable) / detail with subscriptions + attempts |
| PATCH | `/students/:id/status` | Ban/unban |
| DELETE | `/students/:id` | Delete a student account |
| POST | `/subscriptions/manual` | Manually activate a subject for a student (no code) |
| POST | `/activation-codes` | Generate 1–500 codes for a subject |
| GET | `/attempts` | List exam attempts (paginated, filterable by course/exam/status/passed) |
| GET | `/exams/essay-queue` | Essay answers awaiting manual grading |
| POST | `/exam-answers/:id/grade` | Award points for an essay answer (triggers re-finalization of the attempt) |
| POST | `/notifications` | Broadcast a notification (`scope`: all/level/user) |

## Student routes (`/api/student/*`, requires a student session)

| Method | Path | Description |
|---|---|---|
| GET/POST | `/auth/me`, `/auth/logout`, `/auth/change-password` | Student session management |
| GET/PATCH | `/profile` | Own profile + student fields (guardian, governorate, birth date) |
| GET | `/courses` | Published subjects for the student's own level (+ optional `?term=`) |
| POST | `/redeem` | Redeem a 12-character activation code (rate-limited) |
| GET | `/subscriptions` | Own active subscriptions |
| GET | `/courses/:id` | Subject detail + lecture list + progress (only if subscribed) |
| GET | `/courses/:courseId/lessons/:lessonId` | Lecture detail: video(s), files, exams (locked unless prior lectures are completed) |
| POST | `/courses/:courseId/lessons/:lessonId/complete` | Mark a lecture complete (blocked if it has an exam — the exam must be passed instead) |
| POST | `/exams/:id/attempts` | Start an attempt — returns questions with 0-indexed, answer-key-stripped options |
| POST | `/attempts/:id/submit` | Submit answers; `mcq`/`true_false` auto-graded, `essay` left pending |
| GET | `/attempts`, `/attempts/:id` | List / review own attempts (review includes `is_correct`/`is_selected` per option) |
| GET | `/notifications` | Own notifications (broadcast + level + personal) |
| POST | `/notifications/:id/read` | Mark one as read |

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` liveness check — no readiness/DB check endpoint exists |

---

## MCQ option indexing

`exam_questions.correct_index` and every `selected_option_id` sent to `/attempts/:id/submit` are **0-based**, matching the array index of `options` as stored and as returned to students (`options[0]` → id `0`, first option). The admin exam-builder UI's "correct answer" dropdown must emit `0`–`3` for a 4-option MCQ, not `1`–`4` — a 1-based value there silently grades the wrong option.

## Error format

```json
{ "message": "Invalid credentials" }
```

No request ID, no structured `details` array, no Prisma error codes — messages come straight from `sendError()` in `server.js`, which logs the full error server-side and returns `err.publicMessage || err.message`.

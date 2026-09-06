const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool, query, tx } = require('./db');
const { schemaSql } = require('./schema');
const { isBunnyConfigured, uploadLectureVideo, deleteLectureVideo, bunnyEmbedUrl } = require('./lib/bunnyStream');
const { isR2Configured, buildDocumentKey, ensureStorageCap, uploadPdfBuffer, getSignedDownloadUrl } = require('./lib/r2');

const app = express();
app.set('trust proxy', 1);
const rootDir = path.join(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const uploadDir = path.join(__dirname, '..', 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  name: 'law_lms.sid',
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const redeemLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
// يحدّ عدد مرات طلب رابط PDF مؤقت لكل مستخدم عشان يمنع إساءة استخدام إعادة
// الطلب المتكرر (كل رابط صالح لمدة قصيرة، فمن الطبيعي إن الفرونت يطلب واحد
// جديد بين كل شوية، لكن نمنع أي محاولة تلقائية مفرطة).
const documentAccessLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.session.userId || 'anon'}`,
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024) },
});

// رفع فيديوهات المحاضرات في الذاكرة (buffer) بدل الديسك — مطلوب لإرساله لـ Bunny Stream.
// لو Bunny مش متظبط، بنستخدم نفس الـ buffer ونكتبه على الديسك زي الطريقة القديمة (fallback).
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024) }, // 2GB افتراضيًا
});

function normalizeLevel(code) {
  const map = {
    law1: 'year1',
    law2: 'year2',
    law3: 'year3',
    law4: 'year4',
    'الاولى': 'year1',
    'الأولى': 'year1',
    'الثانيه': 'year2',
    'الثانية': 'year2',
    'الثالثه': 'year3',
    'الثالثة': 'year3',
    'الرابعه': 'year4',
    'الرابعة': 'year4',
  };
  return map[code] || code || 'year1';
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    stage: row.level_code,
    level_id: row.level_id,
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ message: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') return res.status(401).json({ message: 'Admin session required' });
  next();
}

function requireStudent(req, res, next) {
  if (!req.session.userId || req.session.role !== 'student') return res.status(401).json({ message: 'Student session required' });
  next();
}

async function currentUser(id) {
  const { rows } = await query(
    `SELECT u.*, s.level_id, l.code AS level_code
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN levels l ON l.id = s.level_id
     WHERE u.id = $1`,
    [id],
  );
  return rows[0];
}

async function signIn(req, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
}

function sendError(res, err) {
  console.error(err);
  res.status(err.status || 500).json({ message: err.publicMessage || err.message || 'Server error' });
}

async function fileKind(filePath) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    await fd.read(buffer, 0, 16, 0);
    const hex = buffer.toString('hex');
    const ascii = buffer.toString('ascii');
    if (hex.startsWith('ffd8ff')) return 'image/jpeg';
    if (hex.startsWith('89504e47')) return 'image/png';
    if (hex.startsWith('47494638')) return 'image/gif';
    if (hex.startsWith('25504446')) return 'application/pdf';
    if (hex.startsWith('504b0304')) return 'application/zip';
    if (ascii.includes('ftyp') || hex.startsWith('1a45dfa3')) return 'video';
    return 'unknown';
  } finally {
    await fd.close();
  }
}

function bufferKind(buffer) {
  const head = buffer.subarray(0, 16);
  const hex = head.toString('hex');
  const ascii = head.toString('ascii');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('504b0304')) return 'application/zip';
  if (ascii.includes('ftyp') || hex.startsWith('1a45dfa3')) return 'video';
  return 'unknown';
}

async function validateUpload(file, allowed) {
  const kind = await fileKind(file.path);
  const ok = allowed.some((rule) => kind === rule || (rule === 'video' && kind === 'video'));
  if (!ok) {
    await fs.promises.rm(file.path, { force: true });
    const err = new Error('Rejected file content type');
    err.status = 400;
    throw err;
  }
  return `/uploads/${path.basename(file.path)}`;
}

function codeValue() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

async function subjectRows(where = '', params = []) {
  const { rows } = await query(
    `SELECT s.*, l.code AS stage, l.name_ar AS stage_name_ar, t.code AS term_code, t.name_ar AS term_name_ar,
            s.doctor_name AS doctor_name, s.name_ar AS course_name_ar, s.price_egp AS price,
            COALESCE((SELECT count(*)::int FROM lectures le WHERE le.subject_id = s.id), 0) AS lessons_count
     FROM subjects s
     JOIN levels l ON l.id = s.level_id
     JOIN terms t ON t.id = s.term_id
     ${where}
     ORDER BY l.sort_order, t.sort_order, s.id DESC`,
    params,
  );
  return rows;
}

async function progressFor(studentId, subjectId) {
  const { rows } = await query(
    `SELECT
       count(le.id)::int AS total_lessons,
       count(lp.lecture_id)::int AS passed_lessons
     FROM lectures le
     LEFT JOIN lesson_progress lp ON lp.lecture_id = le.id AND lp.student_id = $1
     WHERE le.subject_id = $2 AND le.status = 'published'`,
    [studentId, subjectId],
  );
  const p = rows[0] || { total_lessons: 0, passed_lessons: 0 };
  const total = Number(p.total_lessons);
  const passed = Number(p.passed_lessons);
  return { total_lessons: total, passed_lessons: passed, completed_percent: total ? Math.round((passed / total) * 100) : 0 };
}

async function lectureOpen(studentId, lecture) {
  const { rows: previous } = await query(
    `SELECT id FROM lectures WHERE subject_id = $1 AND position < $2 AND status = 'published' ORDER BY position`,
    [lecture.subject_id, lecture.position],
  );
  for (const prev of previous) {
    const { rows: done } = await query('SELECT 1 FROM lesson_progress WHERE student_id = $1 AND lecture_id = $2', [studentId, prev.id]);
    if (!done.length) return false;
  }
  return true;
}

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const login = req.body.phone || req.body.email;
    const { password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE phone = $1 OR email = $1 LIMIT 1', [login]);
    const user = rows[0];
    if (!user || user.status === 'banned' || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    await signIn(req, user);
    res.json({ user: publicUser(user), role: user.role === 'admin' ? 'Admin' : 'User' });
  } catch (err) { sendError(res, err); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const body = req.body;
    if (!body.name || !body.phone || !body.password) return res.status(400).json({ message: 'Name, phone, and password are required' });
    if (!/^01\d{9}$/.test(String(body.phone).trim())) return res.status(400).json({ message: 'رقم الموبايل يجب أن يتكون من 11 رقم ويبدأ بـ 01' });
    if (body.password !== (body.password_confirmation || body.password)) return res.status(400).json({ message: 'Password confirmation does not match' });
    if (String(body.password).length < 8) return res.status(400).json({ message: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });
    const __nameParts = String(body.name || '').trim().split(/\s+/).filter(Boolean);
    if (__nameParts.length < 4) return res.status(400).json({ message: 'يجب إدخال الاسم رباعيًا (4 أسماء على الأقل)' });
    const levelCode = normalizeLevel(body.grade || body.stage || body.level);
    const { rows: levels } = await query('SELECT id, code FROM levels WHERE code = $1', [levelCode]);
    const level = levels[0] || (await query('SELECT id, code FROM levels ORDER BY sort_order LIMIT 1')).rows[0];
    const hash = await bcrypt.hash(body.password, 12);
    const user = await tx(async (client) => {
      const created = await client.query(
        `INSERT INTO users (name, phone, email, password_hash, role)
         VALUES ($1,$2,$3,$4,'student')
         RETURNING *`,
        [body.name, body.phone, body.email || null, hash],
      );
      const generatedStudentNumber = String(created.rows[0].id).padStart(6, '0');
      await client.query(
        `INSERT INTO students (user_id, level_id, student_number, guardian_name, guardian_phone, governorate, birth_date)
         VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,'')::date)`,
        [created.rows[0].id, level.id, generatedStudentNumber, body.parent_name || body.guardian_name || null, body.parent_phone || body.guardian_phone || null, body.governorate || null, body.birthdate || body.birth_date || null],
      );
      return { ...created.rows[0], level_code: level.code, level_id: level.id };
    });
    await signIn(req, user);
    res.status(201).json({ user: publicUser(user), role: 'User' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Phone or email already exists' });
    sendError(res, err);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const teacher = express.Router();
teacher.use(requireAdmin);

teacher.get('/auth/me', async (req, res) => {
  const user = await currentUser(req.session.userId);
  res.json({ user: publicUser(user) });
});

teacher.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

teacher.post('/auth/change-password', async (req, res) => {
  try {
    const user = await currentUser(req.session.userId);
    const current = req.body.current_password || '';
    const next = req.body.new_password || '';
    if (next.length < 8 || next !== req.body.confirm_new_password) return res.status(400).json({ message: 'Invalid new password' });
    if (!(await bcrypt.compare(current, user.password_hash))) return res.status(400).json({ message: 'Current password is incorrect' });
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(next, 12), user.id]);
    res.json({ ok: true });
  } catch (err) { sendError(res, err); }
});

teacher.get('/stats', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT count(*)::int FROM users WHERE role = 'student') AS students_total,
        (SELECT count(DISTINCT student_id)::int FROM subscriptions WHERE status = 'active') AS subscribed_students,
        (SELECT count(*)::int FROM subjects WHERE status = 'published') AS published_courses,
        (SELECT count(*)::int FROM lectures WHERE status = 'published') AS published_lessons,
        (SELECT count(*)::int FROM exams) AS published_exams,
        (SELECT count(*)::int FROM activation_codes WHERE used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS available_codes,
        (SELECT count(*)::int FROM activation_codes WHERE used_at IS NOT NULL) AS used_codes,
        (SELECT count(*)::int FROM exam_answers ea JOIN exam_questions q ON q.id = ea.question_id WHERE q.question_type = 'essay' AND ea.points_awarded IS NULL) AS pending_essay_grades
    `);
    const recent = await query(
      `SELECT u.id, u.name, u.phone, u.status, u.created_at, l.name_ar AS stage_name
       FROM users u LEFT JOIN students s ON s.user_id = u.id LEFT JOIN levels l ON l.id = s.level_id
       WHERE u.role = 'student' ORDER BY u.created_at DESC LIMIT 8`,
    );
    res.json({ stats: rows[0], recent_students: recent.rows });
  } catch (err) { sendError(res, err); }
});

teacher.get('/courses', async (req, res) => {
  try {
    const clauses = [];
    const params = [];
    if (req.query.stage) { params.push(normalizeLevel(req.query.stage)); clauses.push(`l.code = $${params.length}`); }
    if (req.query.term) { params.push(req.query.term); clauses.push(`t.code = $${params.length}`); }
    if (req.query.doctor_name) { params.push(`%${req.query.doctor_name}%`); clauses.push(`s.doctor_name ILIKE $${params.length}`); }
    const items = await subjectRows(clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params);
    res.json({ items });
  } catch (err) { sendError(res, err); }
});

teacher.post('/courses', async (req, res) => {
  try {
    const b = req.body;
    const levelCode = normalizeLevel(b.stage);
    const level = (await query('SELECT id FROM levels WHERE code = $1', [levelCode])).rows[0];
    const term = (await query('SELECT id FROM terms WHERE code = $1', [b.term || 'term1'])).rows[0];
    if (!level || !term || !b.name_ar) return res.status(400).json({ message: 'Missing course fields' });
    const { rows } = await query(
      `INSERT INTO subjects (level_id, term_id, name_ar, doctor_name, price_egp, description, badge, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published') RETURNING *`,
      [level.id, term.id, b.name_ar, b.doctor_name || 'دكتور المادة', Number(b.price || b.price_egp || 0), b.description || null, b.badge || 'normal'],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.patch('/courses/:id', async (req, res) => {
  try {
    const b = req.body;
    const level = b.stage ? (await query('SELECT id FROM levels WHERE code = $1', [normalizeLevel(b.stage)])).rows[0] : null;
    const term = b.term ? (await query('SELECT id FROM terms WHERE code = $1', [b.term])).rows[0] : null;
    const fields = [];
    const params = [];
    for (const [col, val] of [['name_ar', b.name_ar], ['doctor_name', b.doctor_name], ['description', b.description], ['badge', b.badge], ['status', b.status]]) {
      if (val !== undefined) { params.push(val); fields.push(`${col} = $${params.length}`); }
    }
    if (b.price !== undefined) { params.push(Number(b.price)); fields.push(`price_egp = $${params.length}`); }
    if (level) { params.push(level.id); fields.push(`level_id = $${params.length}`); }
    if (term) { params.push(term.id); fields.push(`term_id = $${params.length}`); }
    if (!fields.length) return res.json({ ok: true });
    params.push(req.params.id);
    const { rows } = await query(`UPDATE subjects SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
    res.json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.delete('/courses/:id', async (req, res) => {
  await query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

teacher.post('/courses/:id/cover', upload.single('cover'), async (req, res) => {
  try {
    const url = await validateUpload(req.file, ['image/jpeg', 'image/png', 'image/gif']);
    await query('UPDATE subjects SET cover_url = $1 WHERE id = $2', [url, req.params.id]);
    res.json({ url });
  } catch (err) { sendError(res, err); }
});

teacher.get('/lessons', async (_req, res) => {
  const { rows } = await query(
    `SELECT le.*, le.subject_id AS course_id, le.title AS name_ar,
            (SELECT count(*)::int FROM exams e WHERE e.lecture_id = le.id) AS exams_count
     FROM lectures le ORDER BY le.subject_id, le.position`,
  );
  res.json({ items: rows });
});

teacher.post('/lessons', async (req, res) => {
  try {
    const b = req.body;
    const pos = await query('SELECT COALESCE(max(position),0)+1 AS n FROM lectures WHERE subject_id = $1', [b.course_id]);
    const { rows } = await query(
      `INSERT INTO lectures (subject_id, title, description, youtube_url, publish_at, position, status)
       VALUES ($1,$2,$3,$4,NULLIF($5,'')::timestamptz,$6,'published') RETURNING *, subject_id AS course_id, title AS name_ar`,
      [b.course_id, b.name_ar, b.description || null, b.youtube_url || null, b.publish_at || null, pos.rows[0].n],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.patch('/lessons/:id', async (req, res) => {
  try {
    const b = req.body;
    const fields = [];
    const params = [];
    for (const [col, val] of [['title', b.name_ar], ['description', b.description], ['youtube_url', b.youtube_url], ['status', b.status]]) {
      if (val !== undefined) { params.push(val); fields.push(`${col} = $${params.length}`); }
    }
    if (b.publish_at !== undefined) { params.push(b.publish_at || null); fields.push(`publish_at = $${params.length}`); }
    if (!fields.length) return res.json({ ok: true });
    params.push(req.params.id);
    const { rows } = await query(`UPDATE lectures SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *, subject_id AS course_id, title AS name_ar`, params);
    res.json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.delete('/lessons/:id', async (req, res) => {
  const existing = (await query('SELECT bunny_video_id FROM lectures WHERE id = $1', [req.params.id])).rows[0];
  await query('DELETE FROM lectures WHERE id = $1', [req.params.id]);
  if (existing?.bunny_video_id) deleteLectureVideo(existing.bunny_video_id).catch(() => {});
  res.json({ ok: true });
});

teacher.post('/lessons/:id/video', videoUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) { const err = new Error('لم يتم إرفاق ملف فيديو'); err.status = 400; throw err; }
    if (bufferKind(req.file.buffer) !== 'video') {
      const err = new Error('Rejected file content type');
      err.status = 400;
      throw err;
    }

    const lecture = (await query('SELECT id, title, bunny_video_id FROM lectures WHERE id = $1', [req.params.id])).rows[0];
    if (!lecture) { const err = new Error('Lecture not found'); err.status = 404; throw err; }

    if (isBunnyConfigured()) {
      // لو فيه فيديو قديم مرفوع على Bunny، امسحه الأول
      if (lecture.bunny_video_id) await deleteLectureVideo(lecture.bunny_video_id);

      const videoId = await uploadLectureVideo(lecture.title || `lesson-${lecture.id}`, req.file.buffer);
      await query('UPDATE lectures SET bunny_video_id = $1, video_url = NULL WHERE id = $2', [videoId, lecture.id]);
      return res.json({ bunny_video_id: videoId, embed_url: bunnyEmbedUrl(videoId) });
    }

    // Fallback: مفيش مفاتيح Bunny لسه — استخدم التخزين المحلي القديم زي ما هو.
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp4`;
    await fs.promises.writeFile(path.join(uploadDir, filename), req.file.buffer);
    const url = `/uploads/${filename}`;
    await query('UPDATE lectures SET video_url = $1 WHERE id = $2', [url, lecture.id]);
    res.json({ url });
  } catch (err) { sendError(res, err); }
});

// رفع مرفقات الدرس في الذاكرة (buffer) بدل الديسك - مطلوب عشان نتحقق من نوع
// الملف الحقيقي ونرفع ملفات الـ PDF على Cloudflare R2. ملفات الـ ZIP تتخزن
// محليًا زي الأسلوب القديم بالظبط.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024) },
});

teacher.post('/lessons/:id/files', documentUpload.array('attachments', 10), async (req, res) => {
  try {
    const lecture = (await query('SELECT id, subject_id FROM lectures WHERE id = $1', [req.params.id])).rows[0];
    if (!lecture) { const err = new Error('Lecture not found'); err.status = 404; throw err; }

    const items = [];
    for (const file of req.files || []) {
      const kind = bufferKind(file.buffer);

      if (kind === 'application/pdf') {
        if (!isR2Configured()) {
          const err = new Error('Cloudflare R2 غير مُعدّ على السيرفر. تواصل مع المطوّر.');
          err.status = 500;
          throw err;
        }
        await ensureStorageCap(file.buffer.length);
        const { key } = buildDocumentKey(lecture.subject_id, lecture.id);
        await uploadPdfBuffer(file.buffer, key);
        const row = await query(
          'INSERT INTO lecture_files (lecture_id, title, url, mime_type, file_size, storage, r2_object_key) VALUES ($1,$2,NULL,$3,$4,$5,$6) RETURNING *',
          [req.params.id, file.originalname, file.mimetype, file.size, 'r2', key],
        );
        items.push(row.rows[0]);
      } else if (kind === 'application/zip') {
        const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.zip`;
        await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
        const url = `/uploads/${filename}`;
        const row = await query(
          'INSERT INTO lecture_files (lecture_id, title, url, mime_type, file_size, storage) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
          [req.params.id, file.originalname, url, file.mimetype, file.size, 'local'],
        );
        items.push(row.rows[0]);
      } else {
        const err = new Error('Rejected file content type');
        err.status = 400;
        throw err;
      }
    }
    res.json({ items });
  } catch (err) { sendError(res, err); }
});

teacher.post('/exams', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO exams (lecture_id, title, description, duration_minutes, pass_percent, allow_retry, max_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.lesson_id, b.title, b.description || null, b.duration_minutes || null, b.pass_percent || 60, b.allow_retry !== false, b.max_attempts || null],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.get('/exams', async (_req, res) => {
  const { rows } = await query(
    `SELECT e.*, e.lecture_id AS lesson_id, le.subject_id AS course_id
     FROM exams e JOIN lectures le ON le.id = e.lecture_id ORDER BY e.id DESC`,
  );
  res.json({ items: rows });
});

teacher.post('/exams/:id/questions', async (req, res) => {
  try {
    const b = req.body;
    const pos = await query('SELECT COALESCE(max(position),0)+1 AS n FROM exam_questions WHERE exam_id = $1', [req.params.id]);
    const { rows } = await query(
      `INSERT INTO exam_questions (exam_id, question_type, question_text, points, options, correct_index, correct_answer, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, b.question_type, b.question_text, b.points || 1, b.options ? JSON.stringify(b.options) : null, b.correct_index ?? null, b.correct_answer ?? null, pos.rows[0].n],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.get('/students', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(1, Number(req.query.page_size || 20)));
    const params = [];
    const clauses = ["u.role = 'student'"];
    if (req.query.q) { params.push(`%${req.query.q}%`); clauses.push(`(u.name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`); }
    if (req.query.status) { params.push(req.query.status); clauses.push(`u.status = $${params.length}`); }
    if (req.query.stage_id) { params.push(normalizeLevel(req.query.stage_id)); clauses.push(`l.code = $${params.length}`); }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = await query(`SELECT count(*)::int AS n FROM users u JOIN students s ON s.user_id = u.id LEFT JOIN levels l ON l.id = s.level_id ${where}`, params);
    params.push(size, (page - 1) * size);
    const { rows } = await query(
      `SELECT u.id, u.name, u.phone, u.email, u.status, u.created_at, u.last_login_at,
              s.student_number, s.guardian_name, s.guardian_phone, s.governorate, l.code AS stage, l.name_ar AS stage_name
       FROM users u JOIN students s ON s.user_id = u.id LEFT JOIN levels l ON l.id = s.level_id
       ${where} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const count = total.rows[0].n;
    res.json({ items: rows, total: count, page, total_pages: Math.max(1, Math.ceil(count / size)) });
  } catch (err) { sendError(res, err); }
});

teacher.get('/students/:id', async (req, res) => {
  try {
    const user = (await query(
      `SELECT u.*, s.student_number, s.guardian_name, s.guardian_phone, s.governorate, l.code AS stage
       FROM users u JOIN students s ON s.user_id = u.id LEFT JOIN levels l ON l.id = s.level_id WHERE u.id = $1`,
      [req.params.id],
    )).rows[0];
    const subs = await query(
      `SELECT su.*, sub.name_ar AS course_name_ar FROM subscriptions su JOIN subjects sub ON sub.id = su.subject_id WHERE su.student_id = $1 ORDER BY su.activated_at DESC`,
      [req.params.id],
    );
    const attempts = await query(
      `SELECT ea.*, e.title AS exam_title FROM exam_attempts ea JOIN exams e ON e.id = ea.exam_id WHERE ea.student_id = $1 ORDER BY ea.started_at DESC`,
      [req.params.id],
    );
    const passedLessons = await query(
      `SELECT count(*)::int AS c FROM lesson_progress WHERE student_id = $1`,
      [req.params.id],
    );
    const stats = {
      active_courses: subs.rows.filter((s) => s.status === 'active').length,
      total_attempts: attempts.rows.length,
      passed_attempts: attempts.rows.filter((a) => a.passed).length,
      passed_lessons: passedLessons.rows[0]?.c || 0,
    };
    res.json({ student: user, subscriptions: subs.rows, attempts: attempts.rows, stats });
  } catch (err) { sendError(res, err); }
});

teacher.patch('/students/:id/status', async (req, res) => {
  const { rows } = await query('UPDATE users SET status = $1 WHERE id = $2 AND role = $3 RETURNING *', [req.body.status || 'active', req.params.id, 'student']);
  res.json({ item: rows[0] });
});

teacher.delete('/students/:id', async (req, res) => {
  await query('DELETE FROM users WHERE id = $1 AND role = $2', [req.params.id, 'student']);
  res.json({ ok: true });
});

teacher.post('/subscriptions/manual', async (req, res) => {
  await query(
    `INSERT INTO subscriptions (student_id, subject_id, status) VALUES ($1,$2,'active')
     ON CONFLICT (student_id, subject_id) DO UPDATE SET status = 'active', activated_at = now()`,
    [req.body.student_id, req.body.course_id],
  );
  res.json({ ok: true });
});

teacher.post('/activation-codes', async (req, res) => {
  try {
    const count = Math.min(500, Math.max(1, Number(req.body.count || 1)));
    const subjectId = req.body.course_id || req.body.subject_id;
    const subject = (await query('SELECT price_egp FROM subjects WHERE id = $1', [subjectId])).rows[0];
    if (!subject) return res.status(400).json({ message: 'Subject not found' });
    const codes = [];
    for (let i = 0; i < count; i += 1) {
      let code = codeValue();
      let inserted = false;
      while (!inserted) {
        try {
          await query('INSERT INTO activation_codes (code, subject_id, price_egp, expires_at) VALUES ($1,$2,$3,NULLIF($4, \'\')::timestamptz)', [code, subjectId, subject.price_egp, req.body.expires_at || null]);
          inserted = true;
          codes.push(code);
        } catch (err) {
          if (err.code !== '23505') throw err;
          code = codeValue();
        }
      }
    }
    res.status(201).json({ codes });
  } catch (err) { sendError(res, err); }
});

teacher.get('/attempts', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = 20;
    const params = [];
    const clauses = [];
    if (req.query.course_id) { params.push(req.query.course_id); clauses.push(`le.subject_id = $${params.length}`); }
    if (req.query.exam_id) { params.push(req.query.exam_id); clauses.push(`a.exam_id = $${params.length}`); }
    if (req.query.status) { params.push(req.query.status); clauses.push(`a.status = $${params.length}`); }
    if (req.query.passed !== undefined && req.query.passed !== '') { params.push(req.query.passed === '1'); clauses.push(`a.passed = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = await query(`SELECT count(*)::int AS n FROM exam_attempts a JOIN exams e ON e.id = a.exam_id JOIN lectures le ON le.id = e.lecture_id ${where}`, params);
    params.push(size, (page - 1) * size);
    const { rows } = await query(
      `SELECT a.*, u.name AS student_name, e.title AS exam_title, e.duration_minutes, sub.name_ar AS course_name_ar, le.title AS lesson_name_ar
       FROM exam_attempts a JOIN users u ON u.id = a.student_id JOIN exams e ON e.id = a.exam_id
       JOIN lectures le ON le.id = e.lecture_id JOIN subjects sub ON sub.id = le.subject_id
       ${where} ORDER BY a.started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const count = total.rows[0].n;
    res.json({ items: rows, total: count, page, total_pages: Math.max(1, Math.ceil(count / size)) });
  } catch (err) { sendError(res, err); }
});

teacher.get('/exams/essay-queue', async (_req, res) => {
  const { rows } = await query(
    `SELECT ea.id AS answer_id, ea.answer_text, q.question_text, q.points, u.name AS student_name, e.title AS exam_title
     FROM exam_answers ea JOIN exam_questions q ON q.id = ea.question_id JOIN exam_attempts at ON at.id = ea.attempt_id
     JOIN users u ON u.id = at.student_id JOIN exams e ON e.id = at.exam_id
     WHERE q.question_type = 'essay' AND ea.points_awarded IS NULL ORDER BY at.submitted_at NULLS LAST`,
  );
  res.json({ items: rows });
});

teacher.post('/exam-answers/:id/grade', async (req, res) => {
  try {
    await tx(async (client) => {
      await client.query('UPDATE exam_answers SET points_awarded = $1, scoring_method = $2, graded_at = now() WHERE id = $3', [Number(req.body.points), 'manual', req.params.id]);
      const attempt = await client.query('SELECT attempt_id FROM exam_answers WHERE id = $1', [req.params.id]);
      if (attempt.rows[0]) await finalizeAttempt(client, attempt.rows[0].attempt_id);
    });
    res.json({ ok: true });
  } catch (err) { sendError(res, err); }
});

teacher.post('/notifications', async (req, res) => {
  try {
    const b = req.body;
    const levelId = b.stage_id ? (await query('SELECT id FROM levels WHERE code = $1', [normalizeLevel(b.stage_id)])).rows[0]?.id : null;
    const { rows } = await query(
      'INSERT INTO notifications (scope, level_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [b.scope || 'all', levelId, b.user_id || null, b.title, b.body, b.link || null],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { sendError(res, err); }
});

teacher.get('/sales', async (req, res) => {
  try {
    const params = [];
    const clauses = [];
    if (req.query.doctor) { params.push(`%${req.query.doctor}%`); clauses.push(`s.doctor_name ILIKE $${params.length}`); }
    if (req.query.date_from) { params.push(req.query.date_from); clauses.push(`su.activated_at::date >= $${params.length}`); }
    if (req.query.date_to) { params.push(req.query.date_to); clauses.push(`su.activated_at::date <= $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT su.id, u.name AS student_name, s.name_ar AS course_name_ar, s.doctor_name, s.price_egp,
              su.activated_at, (su.activation_code_id IS NOT NULL) AS via_code
       FROM subscriptions su
       JOIN users u ON u.id = su.student_id
       JOIN subjects s ON s.id = su.subject_id
       ${where}
       ORDER BY su.activated_at DESC LIMIT 500`,
      params,
    );
    const totalRevenue = rows.reduce((sum, r) => sum + Number(r.price_egp), 0);
    res.json({ items: rows, total_revenue: totalRevenue });
  } catch (err) { sendError(res, err); }
});

app.use('/api/teacher', teacher);

async function finalizeAttempt(client, attemptId) {
  const pending = await client.query(
    `SELECT count(*)::int AS n
     FROM exam_answers ea JOIN exam_questions q ON q.id = ea.question_id
     WHERE ea.attempt_id = $1 AND q.question_type = 'essay' AND ea.points_awarded IS NULL`,
    [attemptId],
  );
  if (pending.rows[0].n > 0) return;
  const totals = await client.query(
    'SELECT COALESCE(sum(points_awarded),0) AS score FROM exam_answers WHERE attempt_id = $1',
    [attemptId],
  );
  const meta = await client.query(
    `SELECT e.pass_percent, COALESCE(sum(q.points),0) AS total
     FROM exam_attempts a JOIN exams e ON e.id = a.exam_id JOIN exam_questions q ON q.exam_id = e.id
     WHERE a.id = $1 GROUP BY e.pass_percent`,
    [attemptId],
  );
  const score = Number(totals.rows[0].score);
  const total = Number(meta.rows[0]?.total || 0);
  const passed = total ? (score / total) * 100 >= Number(meta.rows[0].pass_percent) : true;
  await client.query(
    `UPDATE exam_attempts SET status = 'graded', score = $1, total_points = $2, passed = $3, submitted_at = COALESCE(submitted_at, now()) WHERE id = $4`,
    [score, total, passed, attemptId],
  );
  if (passed) {
    await client.query(
      `INSERT INTO lesson_progress (student_id, lecture_id)
       SELECT a.student_id, e.lecture_id FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = $1
       ON CONFLICT DO NOTHING`,
      [attemptId],
    );
  }
}

const student = express.Router();

student.get('/auth/me', requireStudent, async (req, res) => {
  const user = await currentUser(req.session.userId);
  res.json({ user: publicUser(user) });
});

student.post('/auth/logout', requireStudent, (req, res) => req.session.destroy(() => res.json({ ok: true })));

student.post('/auth/change-password', requireStudent, async (req, res) => {
  try {
    const user = await currentUser(req.session.userId);
    if (req.body.new_password !== req.body.confirm_new_password) return res.status(400).json({ message: 'Password confirmation does not match' });
    if (!(await bcrypt.compare(req.body.current_password || '', user.password_hash))) return res.status(400).json({ message: 'Current password is incorrect' });
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.new_password, 12), user.id]);
    res.json({ ok: true });
  } catch (err) { sendError(res, err); }
});

student.get('/profile', requireStudent, async (req, res) => {
  const user = await currentUser(req.session.userId);
  const profile = (await query('SELECT * FROM students WHERE user_id = $1', [req.session.userId])).rows[0] || {};
  res.json({ user: publicUser(user), profile });
});

student.patch('/profile', requireStudent, async (req, res) => {
  try {
    const b = req.body;
    await tx(async (client) => {
      await client.query('UPDATE users SET name = $1, email = NULLIF($2, \'\'), updated_at = now() WHERE id = $3', [b.name, b.email || null, req.session.userId]);
      await client.query(
        `UPDATE students SET student_number = $1, guardian_name = $2, guardian_phone = $3, governorate = $4, birth_date = NULLIF($5,'')::date WHERE user_id = $6`,
        [b.student_number || null, b.guardian_name || null, b.guardian_phone || null, b.governorate || null, b.birth_date || null, req.session.userId],
      );
    });
    const user = await currentUser(req.session.userId);
    res.json({ user: publicUser(user) });
  } catch (err) { sendError(res, err); }
});

student.get('/courses', requireStudent, async (req, res) => {
  try {
    const user = await currentUser(req.session.userId);
    const params = [];
    const clauses = ["s.status = 'published'"];
    if (user.level_code) { params.push(user.level_code); clauses.push(`l.code = $${params.length}`); }
    if (req.query.term) { params.push(req.query.term); clauses.push(`t.code = $${params.length}`); }
    const items = await subjectRows(`WHERE ${clauses.join(' AND ')}`, params);
    res.json({ items });
  } catch (err) { sendError(res, err); }
});

student.post('/redeem', requireStudent, redeemLimiter, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    await tx(async (client) => {
      const found = await client.query('SELECT * FROM activation_codes WHERE code = $1 FOR UPDATE', [code]);
      const row = found.rows[0];
      if (!row || row.used_at || row.revoked_at || (row.expires_at && new Date(row.expires_at) < new Date())) {
        const err = new Error('Invalid activation code');
        err.status = 400;
        throw err;
      }
      await client.query('UPDATE activation_codes SET used_by = $1, used_at = now() WHERE id = $2', [req.session.userId, row.id]);
      await client.query(
        `INSERT INTO subscriptions (student_id, subject_id, activation_code_id, status)
         VALUES ($1,$2,$3,'active')
         ON CONFLICT (student_id, subject_id) DO UPDATE SET status = 'active', activation_code_id = EXCLUDED.activation_code_id, activated_at = now()`,
        [req.session.userId, row.subject_id, row.id],
      );
    });
    res.json({ ok: true });
  } catch (err) { sendError(res, err); }
});

student.get('/subscriptions', requireStudent, async (req, res) => {
  const { rows } = await query(
    `SELECT su.*, su.subject_id AS course_id, sub.name_ar AS course_name_ar, sub.cover_url
     FROM subscriptions su JOIN subjects sub ON sub.id = su.subject_id
     WHERE su.student_id = $1 AND su.status = 'active' ORDER BY su.activated_at DESC`,
    [req.session.userId],
  );
  res.json({ items: rows });
});

student.get('/courses/:id', requireStudent, async (req, res) => {
  try {
    const sub = await query('SELECT 1 FROM subscriptions WHERE student_id = $1 AND subject_id = $2 AND status = $3', [req.session.userId, req.params.id, 'active']);
    if (!sub.rows.length) return res.status(403).json({ message: 'Activate this subject first' });
    const course = (await subjectRows('WHERE s.id = $1', [req.params.id]))[0];
    const lectures = await query(
      `SELECT le.*, le.subject_id AS course_id, le.title AS name_ar,
              (SELECT count(*)::int FROM exams e WHERE e.lecture_id = le.id) AS exams_count,
              EXISTS(SELECT 1 FROM lesson_progress lp WHERE lp.student_id = $1 AND lp.lecture_id = le.id) AS passed
       FROM lectures le WHERE le.subject_id = $2 AND le.status = 'published' ORDER BY le.position`,
      [req.session.userId, req.params.id],
    );
    const lessons = [];
    for (const row of lectures.rows) lessons.push({ ...row, open: await lectureOpen(req.session.userId, row) });
    res.json({ course, lessons, progress: await progressFor(req.session.userId, req.params.id) });
  } catch (err) { sendError(res, err); }
});

student.get('/courses/:courseId/lessons/:lessonId', requireStudent, async (req, res) => {
  try {
    const lesson = (await query('SELECT *, title AS name_ar FROM lectures WHERE id = $1 AND subject_id = $2', [req.params.lessonId, req.params.courseId])).rows[0];
    if (!lesson) return res.status(404).json({ message: 'Lecture not found' });
    const sub = await query('SELECT 1 FROM subscriptions WHERE student_id = $1 AND subject_id = $2 AND status = $3', [req.session.userId, req.params.courseId, 'active']);
    if (!sub.rows.length || !(await lectureOpen(req.session.userId, lesson))) return res.status(403).json({ message: 'Lecture is locked' });
    const files = await query('SELECT *, url FROM lecture_files WHERE lecture_id = $1 ORDER BY id', [lesson.id]);
    const exams = await query(
      `SELECT e.*, EXISTS(
          SELECT 1 FROM exam_attempts a WHERE a.exam_id = e.id AND a.student_id = $2 AND a.passed = TRUE
        ) AS passed,
        (SELECT count(*)::int FROM exam_attempts a WHERE a.exam_id = e.id AND a.student_id = $2) AS attempts_count,
        (SELECT max(round((a.score / NULLIF(a.total_points,0)) * 100))::int FROM exam_attempts a WHERE a.exam_id = e.id AND a.student_id = $2 AND a.total_points IS NOT NULL) AS best_percent
       FROM exams e WHERE e.lecture_id = $1 ORDER BY e.id`,
      [lesson.id, req.session.userId],
    );
    const videos = [];
    if (lesson.video_url) videos.push({ title: lesson.title, url: lesson.video_url, provider: 'upload' });
    if (lesson.youtube_url) videos.push({ title: lesson.title, url: lesson.youtube_url, provider: 'youtube' });
    const lessonOut = {
      ...lesson,
      bunny_embed_url: lesson.bunny_video_id ? bunnyEmbedUrl(lesson.bunny_video_id) : null,
    };
    // ملفات PDF المخزنة على R2 مبيترجعش ليها رابط مباشر أبدًا - الفرونت
    // لازم يطلب رابط مؤقت من /api/student/documents/:id/access.
    const filesOut = files.rows.map((f) => (f.storage === 'r2' ? { ...f, url: null, protected: true } : f));
    res.json({ lesson: lessonOut, files: filesOut, exams: exams.rows, videos });
  } catch (err) { sendError(res, err); }
});

// بيدّي رابط مؤقت (Signed URL) لملف PDF محدد بعد التحقق الكامل من:
// 1) تسجيل دخول الطالب  2) اشتراكه في المادة  3) إتاحة الدرس له.
// الرابط صالح لمدة قصيرة (افتراضي 5 دقايق) ومربوط بالطالب اللي طلبه فقط
// من ناحية تسجيل الوصول - مشاركة الرابط مع حد تاني هتنتهي صلاحيتها بسرعة.
student.get('/documents/:id/access', requireStudent, documentAccessLimiter, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  async function logAccess(documentId, courseId, result, reason) {
    try {
      await query(
        'INSERT INTO document_access_logs (user_id, document_id, course_id, ip_address, result, reason) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.session.userId, documentId, courseId || null, ip, result, reason || null],
      );
    } catch (logErr) { console.error('Failed to log document access:', logErr); }
  }
  try {
    const doc = (await query(
      `SELECT lf.*, le.subject_id AS course_id, le.id AS lecture_id
       FROM lecture_files lf JOIN lectures le ON le.id = lf.lecture_id
       WHERE lf.id = $1`,
      [req.params.id],
    )).rows[0];

    if (!doc) { await logAccess(req.params.id, null, 'denied', 'not_found'); return res.status(404).json({ message: 'Document not found' }); }
    if (doc.storage !== 'r2' || !doc.r2_object_key) { await logAccess(doc.id, doc.course_id, 'denied', 'not_protected'); return res.status(400).json({ message: 'This file is not served through protected access' }); }

    const sub = await query('SELECT 1 FROM subscriptions WHERE student_id = $1 AND subject_id = $2 AND status = $3', [req.session.userId, doc.course_id, 'active']);
    if (!sub.rows.length) { await logAccess(doc.id, doc.course_id, 'denied', 'not_subscribed'); return res.status(403).json({ message: 'Activate this subject first' }); }

    const lesson = (await query('SELECT * FROM lectures WHERE id = $1', [doc.lecture_id])).rows[0];
    if (!lesson || !(await lectureOpen(req.session.userId, lesson))) { await logAccess(doc.id, doc.course_id, 'denied', 'lecture_locked'); return res.status(403).json({ message: 'Lecture is locked' }); }

    const url = await getSignedDownloadUrl(doc.r2_object_key);
    const expiresIn = Number(process.env.PDF_SIGNED_URL_EXPIRY_SECONDS || 300);
    await logAccess(doc.id, doc.course_id, 'granted', null);

    const student = await currentUser(req.session.userId);
    const subject = (await query('SELECT name_ar FROM subjects WHERE id = $1', [doc.course_id])).rows[0];

    res.json({
      url,
      expiresIn,
      title: doc.title,
      watermark: {
        studentName: student.name,
        studentId: student.id,
        studentPhone: student.phone || null,
        courseName: subject ? subject.name_ar : null,
        issuedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    await logAccess(req.params.id, null, 'denied', 'server_error');
    sendError(res, err);
  }
});

student.post('/courses/:courseId/lessons/:lessonId/complete', requireStudent, async (req, res) => {
  try {
    const lesson = (await query('SELECT * FROM lectures WHERE id = $1 AND subject_id = $2', [req.params.lessonId, req.params.courseId])).rows[0];
    if (!lesson || !(await lectureOpen(req.session.userId, lesson))) return res.status(403).json({ message: 'Lecture is locked' });
    const exams = await query('SELECT count(*)::int AS n FROM exams WHERE lecture_id = $1', [lesson.id]);
    if (exams.rows[0].n > 0) return res.status(400).json({ message: 'Complete the lecture exam first' });
    await query('INSERT INTO lesson_progress (student_id, lecture_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.session.userId, lesson.id]);
    res.json({ ok: true });
  } catch (err) { sendError(res, err); }
});

student.post('/exams/:id/attempts', requireStudent, async (req, res) => {
  try {
    const exam = (await query('SELECT e.*, le.subject_id, le.id AS lecture_id FROM exams e JOIN lectures le ON le.id = e.lecture_id WHERE e.id = $1', [req.params.id])).rows[0];
    if (!exam) return res.status(404).json({ message: 'Exam not found' });
    const sub = await query('SELECT 1 FROM subscriptions WHERE student_id = $1 AND subject_id = $2 AND status = $3', [req.session.userId, exam.subject_id, 'active']);
    if (!sub.rows.length) return res.status(403).json({ message: 'Activate this subject first' });
    const lesson = (await query('SELECT * FROM lectures WHERE id = $1', [exam.lecture_id])).rows[0];
    if (!(await lectureOpen(req.session.userId, lesson))) return res.status(403).json({ message: 'Lecture is locked' });
    const count = await query('SELECT count(*)::int AS n FROM exam_attempts WHERE exam_id = $1 AND student_id = $2', [exam.id, req.session.userId]);
    if (!exam.allow_retry && count.rows[0].n > 0) return res.status(400).json({ message: 'Retry is not allowed' });
    if (exam.max_attempts && count.rows[0].n >= exam.max_attempts) return res.status(400).json({ message: 'Maximum attempts reached' });
    const attempt = await query('INSERT INTO exam_attempts (exam_id, student_id) VALUES ($1,$2) RETURNING *', [exam.id, req.session.userId]);
    const questions = await query(
      `SELECT id, question_type, question_text, points,
              CASE WHEN question_type = 'mcq' THEN options ELSE NULL END AS options
       FROM exam_questions WHERE exam_id = $1 ORDER BY position`,
      [exam.id],
    );
    const safeQuestions = questions.rows.map((q) => ({ ...q, options: (q.options || []).map((o, idx) => ({ id: idx, option_text: typeof o === 'string' ? o : o.option_text })) }));
    res.status(201).json({ exam, attempt: attempt.rows[0], questions: safeQuestions });
  } catch (err) { sendError(res, err); }
});

student.post('/attempts/:id/submit', requireStudent, async (req, res) => {
  try {
    let output;
    await tx(async (client) => {
      const attempt = (await client.query('SELECT * FROM exam_attempts WHERE id = $1 AND student_id = $2 FOR UPDATE', [req.params.id, req.session.userId])).rows[0];
      if (!attempt || attempt.status !== 'in_progress') {
        const err = new Error('Attempt cannot be submitted');
        err.status = 400;
        throw err;
      }
      const questions = (await client.query('SELECT * FROM exam_questions WHERE exam_id = $1 ORDER BY position', [attempt.exam_id])).rows;
      const answers = req.body.answers || [];
      for (const q of questions) {
        const a = answers.find((x) => Number(x.question_id) === q.id) || {};
        let points = null;
        let correct = null;
        let method = null;
        if (q.question_type === 'mcq') {
          correct = Number(a.selected_option_id) === Number(q.correct_index);
          points = correct ? Number(q.points) : 0;
          method = 'auto';
        } else if (q.question_type === 'true_false') {
          correct = String(a.answer_text || a.selected_option_id) === String(q.correct_answer);
          points = correct ? Number(q.points) : 0;
          method = 'auto';
        }
        await client.query(
          `INSERT INTO exam_answers (attempt_id, question_id, selected_option_id, answer_text, is_correct, points_awarded, scoring_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option_id = EXCLUDED.selected_option_id, answer_text = EXCLUDED.answer_text,
             is_correct = EXCLUDED.is_correct, points_awarded = EXCLUDED.points_awarded, scoring_method = EXCLUDED.scoring_method`,
          [attempt.id, q.id, a.selected_option_id ?? null, a.answer_text ?? null, correct, points, method],
        );
      }
      await client.query("UPDATE exam_attempts SET status = 'submitted', submitted_at = now() WHERE id = $1", [attempt.id]);
      await finalizeAttempt(client, attempt.id);
      output = (await client.query('SELECT * FROM exam_attempts WHERE id = $1', [attempt.id])).rows[0];
    });
    res.json({ attempt: output });
  } catch (err) { sendError(res, err); }
});

student.get('/attempts', requireStudent, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, e.title AS exam_title, e.duration_minutes, sub.name_ar AS course_name_ar, le.title AS lesson_name_ar
     FROM exam_attempts a JOIN exams e ON e.id = a.exam_id JOIN lectures le ON le.id = e.lecture_id JOIN subjects sub ON sub.id = le.subject_id
     WHERE a.student_id = $1 ORDER BY a.started_at DESC`,
    [req.session.userId],
  );
  res.json({ items: rows });
});

student.get('/attempts/:id', requireStudent, async (req, res) => {
  try {
    const attempt = (await query(
      `SELECT a.*, e.title AS exam_title FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = $1 AND a.student_id = $2`,
      [req.params.id, req.session.userId],
    )).rows[0];
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
    const qs = await query(
      `SELECT q.id, q.question_type, q.question_text, q.points, q.options, q.correct_index, q.correct_answer,
              ea.selected_option_id, ea.answer_text, ea.is_correct, ea.points_awarded, ea.scoring_method
       FROM exam_questions q LEFT JOIN exam_answers ea ON ea.question_id = q.id AND ea.attempt_id = $1
       WHERE q.exam_id = $2 ORDER BY q.position`,
      [attempt.id, attempt.exam_id],
    );
    const questions = qs.rows.map((q) => ({
      ...q,
      options: (q.options || []).map((o, idx) => ({
        id: idx,
        option_text: typeof o === 'string' ? o : o.option_text,
        is_correct: idx === q.correct_index,
        is_selected: idx === q.selected_option_id,
      })),
    }));
    res.json({ attempt, questions });
  } catch (err) { sendError(res, err); }
});

student.get('/notifications', requireStudent, async (req, res) => {
  const user = await currentUser(req.session.userId);
  const { rows } = await query(
    `SELECT n.*, (nr.notification_id IS NOT NULL)::int AS is_read
     FROM notifications n
     LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
     WHERE n.scope = 'all' OR (n.scope = 'user' AND n.user_id = $1) OR (n.scope = 'level' AND n.level_id = $2)
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.session.userId, user.level_id],
  );
  res.json({ items: rows, unread_count: rows.filter((r) => !r.is_read).length });
});

student.post('/notifications/:id/read', requireStudent, async (req, res) => {
  await query('INSERT INTO notification_reads (notification_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.use('/api/student', student);

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await currentUser(req.session.userId);
  res.json({ user: publicUser(user) });
});

app.use(express.static(frontendDir));
app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/admin.html', (_req, res) => res.sendFile(path.join(frontendDir, 'admin', 'index.html')));
app.get('/client.html', (_req, res) => res.sendFile(path.join(frontendDir, 'client', 'index.html')));
app.get('/login-teacher.html', (_req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

const port = Number(process.env.PORT || 3000);

async function start() {
  await query(schemaSql);
  app.listen(port, () => {
    console.log(`Law LMS server listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, start };

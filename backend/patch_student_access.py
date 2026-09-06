#!/usr/bin/env python3
"""
شغّل السكريبت ده من جوه /opt/lms-project/backend:
    python3 patch_student_access.py

بيضيف:
1) endpoint جديد GET /api/student/documents/:id/access
   - بيتحقق إن الطالب مسجّل دخول
   - بيتحقق إن الطالب مشترك في المادة (subscription)
   - بيتحقق إن الدرس متاح له (lectureOpen)
   - يطلع presigned GET URL قصير الأجل من R2
   - يسجّل محاولة الوصول (نجاح/فشل) في document_access_logs
2) rate limiter مخصص لل endpoint ده (منع إساءة الاستخدام)
3) تعديل GET /api/student/courses/:courseId/lessons/:lessonId عشان الملفات
   المخزنة على R2 ميرجعش لها url مباشر (يفضل null، والفرونت يستخدم
   /access endpoint بدل منه)

آمن: بيوقف من غير أي تعديل لو النص المتوقع مش موجود بالظبط.
"""
import sys

PATH = "src/server.js"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

MARKER = "no changes"

# ---------- 1) إضافة rate limiter بعد الموجودين ----------
OLD_LIMITERS = """const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const redeemLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });"""

NEW_LIMITERS = OLD_LIMITERS + """
// يحدّ عدد مرات طلب رابط PDF مؤقت لكل مستخدم عشان يمنع إساءة استخدام إعادة
// الطلب المتكرر (كل رابط صالح لمدة قصيرة، فمن الطبيعي إن الفرونت يطلب واحد
// جديد بين كل شوية، لكن نمنع أي محاولة تلقائية مفرطة).
const documentAccessLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.session.userId || 'anon'}`,
});"""

if OLD_LIMITERS not in content:
    print("ERROR step1: rate limiter anchor not found. No changes made.")
    sys.exit(1)

# ---------- 2) إضافة الـ endpoint الجديد بعد student.get('/courses/:courseId/lessons/:lessonId', ...) ----------
OLD_LESSON_ROUTE_END = """    const videos = [];
    if (lesson.video_url) videos.push({ title: lesson.title, url: lesson.video_url, provider: 'upload' });
    if (lesson.youtube_url) videos.push({ title: lesson.title, url: lesson.youtube_url, provider: 'youtube' });
    const lessonOut = {
      ...lesson,
      bunny_embed_url: lesson.bunny_video_id ? bunnyEmbedUrl(lesson.bunny_video_id) : null,
    };
    res.json({ lesson: lessonOut, files: files.rows, exams: exams.rows, videos });
  } catch (err) { sendError(res, err); }
});"""

NEW_LESSON_ROUTE_END = """    const videos = [];
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
    res.json({
      url,
      expiresIn,
      title: doc.title,
      watermark: {
        studentName: student.name,
        studentId: student.id,
        issuedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    await logAccess(req.params.id, null, 'denied', 'server_error');
    sendError(res, err);
  }
});"""

if OLD_LESSON_ROUTE_END not in content:
    print("ERROR step2: lesson route end anchor not found. No changes made.")
    sys.exit(1)

if "documents/:id/access" in content:
    print("SKIPPED: student access endpoint already present")
    sys.exit(0)

content = content.replace(OLD_LIMITERS, NEW_LIMITERS, 1)
content = content.replace(OLD_LESSON_ROUTE_END, NEW_LESSON_ROUTE_END, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: student access endpoint added")

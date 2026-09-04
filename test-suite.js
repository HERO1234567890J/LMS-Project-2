#!/usr/bin/env node
/**
 * =========================================================
 *  Law LMS - سكريبت اختبار شامل (Backend + Database + API + Frontend)
 * =========================================================
 *
 * الاستخدام:
 *   BASE_URL=https://almostasharacademy.online \
 *   ADMIN_PHONE=01030951438 \
 *   ADMIN_PASSWORD='Admin@1030951438!' \
 *   node test-suite.js
 *
 * لتفعيل اختبارات الإنشاء/التعديل/الحذف الحقيقية (اختياري، بتنضف نفسها):
 *   ... node test-suite.js --full
 *
 * ملاحظات:
 * - السكريبت بيسجل دخول كأدمن حقيقي، وبينشئ حساب طالب تجريبي وهمي
 *   عشان يختبر مسار الطالب، وبيمسحه تلقائيًا في الآخر.
 * - من غير --full: بيختبر بس GET endpoints (قراءة فقط، آمنة 100% على بياناتك).
 * - مع --full: بينشئ كورس تجريبي، يعدله، يمسحه (تنظيف ذاتي).
 * - محتاج Node.js 18+ (فيه fetch built-in).
 * =========================================================
 */

const BASE_URL = (process.env.BASE_URL || 'https://almostasharacademy.online').replace(/\/$/, '');
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const FULL = process.argv.includes('--full');

if (!ADMIN_PHONE || !ADMIN_PASSWORD) {
  console.error('❌ لازم تحدد ADMIN_PHONE و ADMIN_PASSWORD كمتغيرات بيئة قبل التشغيل.');
  console.error('مثال: ADMIN_PHONE=01xxxxxxxxx ADMIN_PASSWORD=xxxx node test-suite.js');
  process.exit(1);
}

const results = [];
let passCount = 0, failCount = 0, skipCount = 0;

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  if (status === 'PASS') passCount++;
  else if (status === 'FAIL') failCount++;
  else skipCount++;
  const icon = status === 'PASS' ? '\x1b[32m✔\x1b[0m' : status === 'FAIL' ? '\x1b[31m✘\x1b[0m' : '\x1b[33m⚠\x1b[0m';
  console.log(`${icon} ${name}${detail ? '  —  ' + detail : ''}`);
}

function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function req(path, { method = 'GET', cookie, body, timeoutMs = 15000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json, fine */ }
    return { res, data, cookie: extractCookie(res) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n=== بدء اختبار المنصة: ${BASE_URL} ${FULL ? '(وضع FULL - هيعدل بيانات تجريبية)' : '(قراءة فقط)'} ===\n`);

  // ---------- 1) Health check ----------
  try {
    const { res, data } = await req('/api/health');
    if (res.status === 200 && data && data.ok) record('Health Check  /api/health', 'PASS');
    else record('Health Check  /api/health', 'FAIL', `status ${res.status}`);
  } catch (e) { record('Health Check  /api/health', 'FAIL', e.message); }

  // ---------- 2) Frontend pages ----------
  const pages = [
    ['/', 'صفحة تسجيل الدخول'],
    ['/admin.html', 'لوحة الأدمن'],
    ['/client.html', 'بوابة الطالب'],
    ['/login-teacher.html', 'صفحة دخول المدرس'],
  ];
  for (const [path, label] of pages) {
    try {
      const r = await fetch(BASE_URL + path);
      record(`Frontend: ${label} (${path})`, r.status === 200 ? 'PASS' : 'FAIL', `status ${r.status}`);
    } catch (e) { record(`Frontend: ${label} (${path})`, 'FAIL', e.message); }
  }

  // ---------- 2b) Static assets ----------
  const assets = ['/admin/style.css', '/admin/teacher-script.js', '/client/style.css'];
  for (const path of assets) {
    try {
      const r = await fetch(BASE_URL + path);
      record(`Static asset ${path}`, r.status === 200 ? 'PASS' : 'FAIL', `status ${r.status}`);
    } catch (e) { record(`Static asset ${path}`, 'FAIL', e.message); }
  }

  // ---------- 3) Admin/teacher login ----------
  let teacherCookie = null;
  try {
    const { res, data, cookie } = await req('/api/auth/login', {
      method: 'POST',
      body: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
    });
    if (res.status === 200 && cookie) {
      teacherCookie = cookie;
      record('Admin Login  POST /api/auth/login', 'PASS', `role: ${data?.role || 'n/a'}`);
    } else {
      record('Admin Login  POST /api/auth/login', 'FAIL', `status ${res.status} - ${JSON.stringify(data)}`);
    }
  } catch (e) { record('Admin Login  POST /api/auth/login', 'FAIL', e.message); }

  // ---------- 4) Teacher GET endpoints (read-only, safe) ----------
  const teacherGetEndpoints = [
    '/api/teacher/auth/me',
    '/api/teacher/stats',
    '/api/teacher/courses',
    '/api/teacher/lessons',
    '/api/teacher/exams',
    '/api/teacher/students',
    '/api/teacher/attempts',
    '/api/teacher/exams/essay-queue',
    '/api/teacher/sales',
  ];
  if (teacherCookie) {
    for (const path of teacherGetEndpoints) {
      try {
        const { res } = await req(path, { cookie: teacherCookie });
        record(`Teacher GET  ${path}`, res.status === 200 ? 'PASS' : 'FAIL', `status ${res.status}`);
      } catch (e) { record(`Teacher GET  ${path}`, 'FAIL', e.message); }
    }
  } else {
    teacherGetEndpoints.forEach(p => record(`Teacher GET  ${p}`, 'SKIP', 'مفيش جلسة أدمن ناجحة'));
  }

  // ---------- 5) Throwaway test student: register ----------
  let studentCookie = null;
  let testStudentId = null;
  const testPhone = '0199' + Date.now().toString().slice(-7);
  const testPassword = 'TestPass@' + Date.now().toString().slice(-4);
  try {
    const { res, data, cookie } = await req('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Automation Student',
        phone: testPhone,
        password: testPassword,
        password_confirmation: testPassword,
        governorate: 'الاولى',
      },
    });
    if (res.status === 200 || res.status === 201) {
      record('Student Register  POST /api/auth/register', 'PASS', `phone: ${testPhone}`);
      studentCookie = cookie;
    } else {
      record('Student Register  POST /api/auth/register', 'FAIL', `status ${res.status} - ${JSON.stringify(data)}`);
    }
  } catch (e) { record('Student Register  POST /api/auth/register', 'FAIL', e.message); }

  // fallback: login if register didn't hand back a session cookie
  if (!studentCookie) {
    try {
      const { res, cookie } = await req('/api/auth/login', {
        method: 'POST',
        body: { phone: testPhone, password: testPassword },
      });
      if (res.status === 200 && cookie) {
        studentCookie = cookie;
        record('Student Login  POST /api/auth/login', 'PASS');
      } else {
        record('Student Login  POST /api/auth/login', 'FAIL', `status ${res.status}`);
      }
    } catch (e) { record('Student Login  POST /api/auth/login', 'FAIL', e.message); }
  }

  // ---------- 6) Student GET endpoints (read-only, safe) ----------
  const studentGetEndpoints = [
    '/api/student/auth/me',
    '/api/student/profile',
    '/api/student/courses',
    '/api/student/subscriptions',
    '/api/student/attempts',
    '/api/student/notifications',
  ];
  if (studentCookie) {
    for (const path of studentGetEndpoints) {
      try {
        const { res } = await req(path, { cookie: studentCookie });
        record(`Student GET  ${path}`, res.status === 200 ? 'PASS' : 'FAIL', `status ${res.status}`);
      } catch (e) { record(`Student GET  ${path}`, 'FAIL', e.message); }
    }
  } else {
    studentGetEndpoints.forEach(p => record(`Student GET  ${p}`, 'SKIP', 'مفيش جلسة طالب ناجحة'));
  }

  // ---------- 7) FULL mode only: safe self-cleaning write test ----------
  if (FULL && teacherCookie) {
    let tempCourseId = null;
    try {
      const { res, data } = await req('/api/teacher/courses', {
        method: 'POST',
        cookie: teacherCookie,
        body: { stage: 'الاولى', term: 'term1', name_ar: 'TEST_AUTOMATION_COURSE_DELETE_ME', price_egp: 0, description: 'auto test' },
      });
      if (res.status === 200 || res.status === 201) {
        tempCourseId = data?.item?.id || data?.id;
        record('Teacher POST  /api/teacher/courses (إنشاء تجريبي)', 'PASS', `id: ${tempCourseId ?? 'n/a'}`);
      } else {
        record('Teacher POST  /api/teacher/courses (إنشاء تجريبي)', 'FAIL', `status ${res.status} - ${JSON.stringify(data)}`);
      }
    } catch (e) { record('Teacher POST  /api/teacher/courses (إنشاء تجريبي)', 'FAIL', e.message); }

    if (tempCourseId) {
      try {
        const { res } = await req(`/api/teacher/courses/${tempCourseId}`, {
          method: 'PATCH', cookie: teacherCookie, body: { name_ar: 'TEST_AUTOMATION_COURSE_UPDATED' },
        });
        record('Teacher PATCH  /api/teacher/courses/:id', res.status === 200 ? 'PASS' : 'FAIL', `status ${res.status}`);
      } catch (e) { record('Teacher PATCH  /api/teacher/courses/:id', 'FAIL', e.message); }

      try {
        const { res } = await req(`/api/teacher/courses/${tempCourseId}`, { method: 'DELETE', cookie: teacherCookie });
        record('Teacher DELETE  /api/teacher/courses/:id (تنظيف)', res.status === 200 ? 'PASS' : 'FAIL', `status ${res.status}`);
      } catch (e) { record('Teacher DELETE  /api/teacher/courses/:id (تنظيف)', 'FAIL', e.message); }
    }
  } else if (!FULL) {
    record('اختبارات الإنشاء/التعديل/الحذف', 'SKIP', 'اتخطت أمانًا - شغّل بـ --full لو عايز تفعّلها (بتنضف نفسها تلقائي)');
  }

  // ---------- 8) Cleanup: delete the throwaway test student ----------
  if (teacherCookie) {
    try {
      const { res, data } = await req('/api/teacher/students', {
        cookie: teacherCookie,
      });
      if (res.status === 200) {
        const list = data?.items || (Array.isArray(data) ? data : []);
        const found = Array.isArray(list) ? list.find(s => s.phone === testPhone) : null;
        if (found) testStudentId = found.id;
      }
      if (!testStudentId) {
        const { res: r2, data: d2 } = await req(`/api/teacher/students?q=${encodeURIComponent(testPhone)}`, { cookie: teacherCookie });
        if (r2.status === 200) {
          const list2 = d2?.items || [];
          const found2 = list2.find(s => s.phone === testPhone);
          if (found2) testStudentId = found2.id;
        }
      }
    } catch (_) { /* ignore, handled below */ }

    if (testStudentId) {
      try {
        const { res } = await req(`/api/teacher/students/${testStudentId}`, { method: 'DELETE', cookie: teacherCookie });
        record('Cleanup: حذف حساب الطالب التجريبي', res.status === 200 ? 'PASS' : 'FAIL', `status ${res.status}`);
      } catch (e) { record('Cleanup: حذف حساب الطالب التجريبي', 'FAIL', e.message); }
    } else {
      record('Cleanup: حذف حساب الطالب التجريبي', 'SKIP', `مقدرش يلاقي id بتاع الرقم ${testPhone} — امسحه يدويًا لو ظهر في لوحة الطلاب`);
    }
  }

  // ---------- Summary ----------
  console.log('\n=== ملخص النتائج ===');
  console.log(`\x1b[32m✔ نجح: ${passCount}\x1b[0m`);
  console.log(`\x1b[31m✘ فشل: ${failCount}\x1b[0m`);
  console.log(`\x1b[33m⚠ اتخطى: ${skipCount}\x1b[0m`);
  console.log(`الإجمالي: ${results.length}\n`);

  if (failCount > 0) {
    console.log('=== تفاصيل الاختبارات اللي فشلت ===');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`✘ ${r.name}  —  ${r.detail}`));
    console.log('');
  }

  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch(e => {
  console.error('خطأ عام غير متوقع في السكريبت:', e);
  process.exit(1);
});

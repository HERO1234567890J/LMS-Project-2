/**
 * Teacher Dashboard — Cleaned and Updated (Phase 8)
 */

const API = '/api/teacher';

// ==================== أدوات مساعدة عامة ====================
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

let toastTimer = null;
function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { ...options, headers, credentials: 'same-origin' });
  if (res.status === 401) {
    window.location.href = '/login-teacher.html';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'حدث خطأ في الطلب');
  return data;
}

function statusBadge(status) {
  const map = {
    published: ['badge-success', 'منشور'],
    draft: ['badge-warning', 'مسودة'],
    archived: ['badge-muted', 'مؤرشف'],
    active: ['badge-success', 'نشط'],
    banned: ['badge-danger', 'موقوف'],
    used: ['badge-info', 'مستخدم'],
    unused: ['badge-success', 'غير مستخدم'],
    expired: ['badge-danger', 'منتهي'],
    revoked: ['badge-muted', 'ملغي'],
    in_progress: ['badge-warning', 'قيد التنفيذ'],
    submitted: ['badge-warning', 'مُسلَّم'],
    graded: ['badge-success', 'تم التصحيح'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function fmtDT(str) {
  if (!str) return '–';
  const d = new Date(String(str).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return esc(str);
  return d.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderPagination(container, page, totalPages, onPage) {
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  const mk = (label, p, disabled, active) =>
    `<button ${active ? 'class="active"' : ''} ${disabled ? 'disabled' : ''} data-page="${p}">${label}</button>`;
  let html = mk('→ السابق', page - 1, page <= 1, false);
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) html += mk(p, p, false, p === page);
  html += mk('التالي ←', page + 1, page >= totalPages, false);
  container.innerHTML = html;
  container.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { if (!b.disabled) onPage(Number(b.dataset.page)); })
  );
}

function goToSection(id) {
  document.querySelectorAll('.sidebar-nav li').forEach((i) => i.classList.toggle('active', i.dataset.section === id));
  document.querySelectorAll('.app-section').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== تشغيل اللوحة ====================
// ==================== تشغيل اللوحة ====================
document.addEventListener('DOMContentLoaded', () => {
  initShell();
  initOverview();
  initAddContent();
  initStudents();
  initExams();
  initNotifications();
  initProfile();

  // تشغيل المبيعات (تأكد إن السطر ده موجود)
  if (typeof initSales === 'function') {
    initSales();
  }
});

// ==================== الهيكل العام والمصادقة ====================
async function initShell() {
  try {
    const data = await api('/auth/me');
    const user = data.user;
    document.getElementById('sessionUserName').textContent = 'أستاذ / ' + user.name;
    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = user.name;
    const phoneInput = document.getElementById('profilePhoneInput');
    if (phoneInput) phoneInput.value = user.phone || '–';
  } catch (err) {
    if (err.message !== 'unauthorized') toast('تعذر التحقق من الجلسة', 'error');
  }

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    window.location.href = '/login-teacher.html';
  });

  const themeToggle = document.getElementById('themeToggle');
  const htmlEl = document.documentElement;
  const saved = localStorage.getItem('theme') || 'light';
  htmlEl.setAttribute('data-theme', saved);
  if (themeToggle) {
    themeToggle.textContent = saved === 'dark' ? '☀️' : '🌙';
    themeToggle.addEventListener('click', () => {
      const next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      htmlEl.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  const hamburger = document.getElementById('hamburgerBtn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const closeSidebar = () => { sidebar?.classList.remove('open'); overlay?.classList.remove('active'); };
  hamburger?.addEventListener('click', () => { sidebar?.classList.add('open'); overlay?.classList.add('active'); });
  overlay?.addEventListener('click', closeSidebar);

  document.querySelectorAll('.sidebar-nav li').forEach((item) => {
    item.addEventListener('click', () => { closeSidebar(); goToSection(item.dataset.section); });
  });
}

// ==================== إعدادات الحساب ====================
function initProfile() {
  const form = document.getElementById('adminPasswordForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      current_password: document.getElementById('adminCurrPass').value,
      new_password: document.getElementById('adminNewPass').value,
      confirm_new_password: document.getElementById('adminConfirmPass').value,
    };
    if (!body.current_password || !body.new_password || !body.confirm_new_password) {
      return toast('أكمل كل الحقول', 'error');
    }
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify(body) });
      toast('تم تغيير كلمة المرور بنجاح');
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ==================== قسم 1: نظرة عامة والإحصائيات ====================
async function loadOverview() {
  const body = document.getElementById('ovRecentStudentsBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="6" class="table-empty">جارِ تحميل البيانات...</td></tr>';
  try {
    const data = await api('/stats');
    const s = data.stats;
    document.getElementById('ovSubscribedStudents').textContent = s.subscribed_students;
    document.getElementById('ovPublishedCourses').textContent = s.published_courses;
    document.getElementById('ovAvailableCodes').textContent = s.available_codes;
    document.getElementById('ovPendingEssay').textContent = s.pending_essay_grades;
    document.getElementById('ovStudentsTotal').textContent = s.students_total;
    document.getElementById('ovPublishedLessons').textContent = s.published_lessons;
    document.getElementById('ovPublishedExams').textContent = s.published_exams;
    document.getElementById('ovUsedCodes').textContent = s.used_codes;

    if (!data.recent_students.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">لا يوجد طلاب مسجلون بعد</td></tr>';
      return;
    }
    body.innerHTML = data.recent_students
      .map(
        (st) => `
        <tr>
          <td><strong>${esc(st.name)}</strong></td>
          <td dir="ltr">${esc(st.phone)}</td>
          <td>${statusBadge(st.status)}</td>
          <td>${st.active_courses}</td>
          <td>${fmtDT(st.created_at)}</td>
          <td><button class="btn btn-outline btn-sm ov-open-student" data-id="${st.id}">عرض الملف</button></td>
        </tr>`
      )
      .join('');
    body.querySelectorAll('.ov-open-student').forEach((btn) =>
      btn.addEventListener('click', () => {
        goToSection('students');
        if (typeof window.openStudentById === 'function') window.openStudentById(Number(btn.dataset.id));
      })
    );
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty">${esc(err.message)}</td></tr>`;
  }
}

function initOverview() {
  document.getElementById('refreshOverviewBtn')?.addEventListener('click', loadOverview);
  loadOverview();
}

// ==================== النوافذ المنبثقة العامة ====================
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.getElementById('overlay')?.classList.add('active');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  if (!document.querySelector('.modal.open')) document.getElementById('overlay')?.classList.remove('active');
}

// دالة تشغيل التسلسل الهرمي (فرقة -> ترم/دكتور -> مادة) — مربوطة بالبيانات الحقيقية من /api/teacher/courses
function initHierarchyFilters() {
  const stageSelect = document.getElementById('acStageSelect');
  const termSelect = document.getElementById('acTermSelect');
  const doctorFilter = document.getElementById('acDoctorFilter');
  const courseSelect = document.getElementById('acCourseSelect');

  if (!stageSelect || !termSelect || !doctorFilter || !courseSelect) return;

  let stageCourses = [];

  function renderCourseOptions() {
    const term = termSelect.value;
    const doctorQuery = doctorFilter.value.trim().toLowerCase();
    const filtered = stageCourses.filter((c) => {
      if (term && c.term_code !== term) return false;
      if (doctorQuery && !(c.doctor_name || '').toLowerCase().includes(doctorQuery)) return false;
      return true;
    });
    if (!filtered.length) {
      courseSelect.innerHTML = '<option value="">لا توجد مواد مطابقة</option>';
      return;
    }
    courseSelect.innerHTML = '<option value="">-- اختر المادة --</option>' + filtered
      .map((c) => `<option value="${c.id}">${esc(c.name_ar)} — د. ${esc(c.doctor_name || 'غير محدد')} (${esc(c.term_name_ar)})${c.status !== 'published' ? ' (غير منشور)' : ''}</option>`)
      .join('');
  }

  stageSelect.addEventListener('change', async () => {
    if (!stageSelect.value) {
      termSelect.disabled = true;
      doctorFilter.disabled = true;
      courseSelect.disabled = true;
      courseSelect.innerHTML = '<option value="">-- اختر المادة --</option>';
      return;
    }
    termSelect.disabled = false;
    doctorFilter.disabled = false;
    courseSelect.disabled = false;
    courseSelect.innerHTML = '<option value="">جارِ جلب المواد...</option>';
    try {
      const res = await api(`/courses?stage=${encodeURIComponent(stageSelect.value)}`);
      stageCourses = res.items || [];
      renderCourseOptions();
    } catch (err) {
      courseSelect.innerHTML = '<option value="">تعذر التحميل</option>';
      toast(err.message, 'error');
    }
  });

  termSelect.addEventListener('change', renderCourseOptions);
  doctorFilter.addEventListener('input', renderCourseOptions);
}

function questionCardHTML() {
  const idx = document.querySelectorAll('#acQuestionsContainer .q-builder-card').length + 1;
  const div = document.createElement('div');
  div.className = 'q-builder-card';
  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
      <span class="q-num-tag">سؤال ${idx}</span>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <select class="form-control q-type" style="width:170px;">
          <option value="mcq">اختيار من متعدد</option>
          <option value="true_false">صح / خطأ</option>
          <option value="essay">مقالي</option>
        </select>
        <input type="number" class="form-control q-points" min="0.5" step="0.5" value="1" style="width:90px;" title="درجة السؤال">
        <button type="button" class="btn btn-sm btn-danger q-remove">✖</button>
      </div>
    </div>
    <input type="text" class="form-control q-text" placeholder="نص السؤال..." style="margin-bottom:8px;">
    <div class="q-dynamic"></div>
  `;
  renderQuestionDynamic(div);
  div.querySelector('.q-type').addEventListener('change', () => renderQuestionDynamic(div));
  div.querySelector('.q-remove').addEventListener('click', () => {
    div.remove();
    document.querySelectorAll('#acQuestionsContainer .q-builder-card').forEach((card, i) => {
      card.querySelector('.q-num-tag').textContent = `سؤال ${i + 1}`;
    });
  });
  return div;
}

function renderQuestionDynamic(div) {
  const type = div.querySelector('.q-type').value;
  const holder = div.querySelector('.q-dynamic');
  if (type === 'mcq') {
    holder.innerHTML = `
      <div class="options-builder-grid">
        <input type="text" class="form-control q-opt" placeholder="الخيار الأول">
        <input type="text" class="form-control q-opt" placeholder="الخيار الثاني">
        <input type="text" class="form-control q-opt" placeholder="الخيار الثالث">
        <input type="text" class="form-control q-opt" placeholder="الخيار الرابع">
      </div>
      <div class="correct-select-row">
        <label>الخيار الصحيح:</label>
        <select class="form-control q-correct" style="width:auto;">
          <option value="0">الخيار الأول</option>
          <option value="1">الخيار الثاني</option>
          <option value="2">الخيار الثالث</option>
          <option value="3">الخيار الرابع</option>
        </select>
      </div>`;
  } else if (type === 'true_false') {
    holder.innerHTML = `
      <div class="correct-select-row">
        <label>الإجابة الصحيحة:</label>
        <select class="form-control q-tf" style="width:auto;">
          <option value="true">صح</option>
          <option value="false">خطأ</option>
        </select>
      </div>`;
  } else {
    holder.innerHTML = `
      <div class="form-group">
        <label>الإجابة النموذجية (اختياري — للمرشد عند التصحيح):</label>
        <textarea class="form-control q-model" rows="2" placeholder="نموذج الإجابة..."></textarea>
      </div>`;
  }
}

function validateQuestions() {
  const cards = document.querySelectorAll('#acQuestionsContainer .q-builder-card');
  if (!cards.length) return { ok: false, error: 'أضف سؤالًا واحدًا على الأقل' };
  const questions = [];
  for (const card of cards) {
    const type = card.querySelector('.q-type').value;
    const text = card.querySelector('.q-text').value.trim();
    const points = Number(card.querySelector('.q-points').value);
    if (!text) return { ok: false, error: 'اكتب نص السؤال في كل الأسئلة' };
    if (!(points > 0)) return { ok: false, error: 'درجة كل سؤال يجب أن تكون أكبر من صفر' };
    const q = { question_type: type, question_text: text, points };
    if (type === 'mcq') {
      const opts = [...card.querySelectorAll('.q-opt')].map((i) => i.value.trim());
      if (opts.some((o) => !o)) return { ok: false, error: 'أكمل الخيارات الأربعة في أسئلة الاختيار' };
      q.options = opts;
      q.correct_index = Number(card.querySelector('.q-correct').value);
    } else if (type === 'true_false') {
      q.correct_answer = card.querySelector('.q-tf').value;
    } else {
      const model = card.querySelector('.q-model').value.trim();
      if (model) q.correct_answer = model;
    }
    questions.push(q);
  }
  return { ok: true, questions };
}

async function submitAddContent() {
  const courseId = Number(document.getElementById('acCourseSelect').value);
  const name = document.getElementById('acLessonName').value.trim();
  if (!courseId) return toast('اختر الكورس أولاً', 'error');
  if (!name) return toast('اكتب عنوان المحاضرة', 'error');

  const examEnabled = document.getElementById('acExamEnabled').checked;
  let questions = [];
  if (examEnabled) {
    const v = validateQuestions();
    if (!v.ok) return toast(v.error, 'error');
    questions = v.questions;
  }

  const btn = document.getElementById('acSubmitBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'جارِ الحفظ والنشر...';
  try {
    const lessonPayload = { course_id: courseId, name_ar: name };
    const desc = document.getElementById('acLessonDesc').value.trim();
    const youtube = document.getElementById('acYoutubeUrl').value.trim();
    const publishAt = document.getElementById('acLessonPublishAt').value;
    if (desc) lessonPayload.description = desc;
    if (youtube) lessonPayload.youtube_url = youtube;
    if (publishAt) lessonPayload.publish_at = new Date(publishAt).toISOString();

    const lessonRes = await api('/lessons', { method: 'POST', body: JSON.stringify(lessonPayload) });
    const lessonId = lessonRes.item.id;

    const videoFile = document.getElementById('acVideoInput').files[0];
    if (videoFile) {
      const fd = new FormData();
      fd.append('video', videoFile);
      await api(`/lessons/${lessonId}/video`, { method: 'POST', body: fd });
    }

    const files = document.getElementById('acFilesInput').files;
    if (files.length) {
      const fd = new FormData();
      for (const f of files) fd.append('attachments', f);
      await api(`/lessons/${lessonId}/files`, { method: 'POST', body: fd });
    }

    const publishNow = document.getElementById('acPublishNow')?.checked;
    if (!publishAt && publishNow) {
      await api(`/lessons/${lessonId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
    }

    let examTitle = '';
    if (examEnabled) {
      const title = document.getElementById('acExamTitle').value.trim() || `امتحان ${name}`;
      const duration = Number(document.getElementById('acDuration').value);
      const passPercent = Number(document.getElementById('acPassPercent').value);
      const allowRetry = Number(document.getElementById('acAllowRetry').value) === 1;
      const maxAttempts = document.getElementById('acMaxAttempts').value;
      const examPayload = { lesson_id: lessonId, title, duration_minutes: duration, pass_percent: passPercent, allow_retry: allowRetry };
      if (allowRetry && maxAttempts) examPayload.max_attempts = Number(maxAttempts);
      const examRes = await api('/exams', { method: 'POST', body: JSON.stringify(examPayload) });
      examTitle = examRes.item.title;
      for (const q of questions) {
        await api(`/exams/${examRes.item.id}/questions`, { method: 'POST', body: JSON.stringify(q) });
      }
    }

    toast(examEnabled
      ? `تم حفظ المحاضرة «${name}» وامتحانها «${examTitle}» (${questions.length} سؤال) بنجاح`
      : `تم حفظ المحاضرة «${name}» بنجاح`);

    document.getElementById('addLectureForm').reset();
    document.getElementById('acQuestionsContainer').innerHTML = '';
    document.getElementById('acExamTitle').value = '';

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function initAddContent() {
  document.getElementById('acAddQuestionBtn')?.addEventListener('click', () => {
    document.getElementById('acQuestionsContainer').appendChild(questionCardHTML());
  });

  document.getElementById('acExamEnabled')?.addEventListener('change', (e) => {
    const examFields = document.getElementById('acExamFields');
    if (examFields) examFields.style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('acLessonName')?.addEventListener('input', (e) => {
    const title = document.getElementById('acExamTitle');
    if (title && !title.value.trim()) title.value = `امتحان ${e.target.value.trim()}`;
  });

  document.getElementById('acVideoInput')?.addEventListener('change', (e) => {
    document.getElementById('acVideoName').textContent = e.target.files[0] ? `✓ ${e.target.files[0].name}` : '';
  });

  document.getElementById('acFilesInput')?.addEventListener('change', (e) => {
    const names = [...e.target.files].map((f) => f.name).join('، ');
    document.getElementById('acFilesNames').textContent = e.target.files.length ? `✓ ${names}` : '';
  });

  // الجزء السحري لإيقاف عناد المتصفح
  const form = document.getElementById('addLectureForm');
  if (form) {
    form.setAttribute('novalidate', 'true');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitAddContent();
    });
  }

  const examEnabled = document.getElementById('acExamEnabled');
  const examFields = document.getElementById('acExamFields');
  if (examFields) examFields.style.display = examEnabled?.checked ? '' : 'none';

  const qc = document.getElementById('acQuestionsContainer');
  if (qc) qc.appendChild(questionCardHTML());

  initHierarchyFilters();
}

// ==================== قسم 4: إدارة الطلاب ====================
const stuState = { q: '', status: '', stage_id: '', page: 1, totalPages: 1, currentProfileId: null, currentStudentStage: null };
function loadStudentStages() {
  const select = document.getElementById('stuStageFilter');
  if (!select) return;
  select.innerHTML = '<option value="">الكل</option>' +
    '<option value="prep3">الصف الثالث الإعدادي</option>' +
    '<option value="sec1">الصف الأول الثانوي</option>' +
    '<option value="sec2">الصف الثاني الثانوي</option>';
}

function studentRowHTML(s) {
  // ترجمة كود المرحلة لاسمها بالعربي
  const stagesMap = { 'year1': 'الفرقة الأولى', 'year2': 'الفرقة الثانية', 'year3': 'الفرقة الثالثة', 'year4': 'الفرقة الرابعة' };
  const stageLabel = stagesMap[s.stage] || 'غير محدد';

  return `<tr>
    <td><div class="student-cell"><span class="avatar-circle">${esc((s.name || '؟')[0])}</span><div><strong>${esc(s.name)}</strong></div></div></td>
    <td dir="ltr">${esc(s.phone || '—')}</td>
    
    <!-- هنا شيلنا المحافظة وحطينا المرحلة بدل منها -->
    <td><strong>${stageLabel}</strong></td>
    
    <td>${statusBadge(s.status)}</td>
    <td>${s.active_courses}</td>
    <td>${fmtDT(s.created_at)}</td>
    <td><button class="btn btn-sm btn-outline" data-view-student="${s.id}">عرض الملف</button></td>
  </tr>`;
}

async function loadStudents() {
  const params = new URLSearchParams();
  if (stuState.q) params.set('q', stuState.q);
  if (stuState.status) params.set('status', stuState.status);
  if (stuState.stage_id) params.set('stage_id', stuState.stage_id);
  params.set('page', stuState.page);
  try {
    const res = await api(`/students?${params}`);
    const tbody = document.getElementById('stuTableBody');
    if (!res.items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">لا يوجد طلاب مطابقون للبحث</td></tr>`;
    } else {
      tbody.innerHTML = res.items.map(studentRowHTML).join('');
      tbody.querySelectorAll('[data-view-student]').forEach((btn) =>
        btn.addEventListener('click', () => showStudentProfile(Number(btn.dataset.viewStudent)))
      );
    }
    document.getElementById('stuCount').textContent = res.total;
    stuState.totalPages = res.total_pages;
    renderPagination(document.getElementById('stuPagination'), res.page, res.total_pages, (p) => {
      stuState.page = p;
      loadStudents();
    });
  } catch (err) {
    document.getElementById('stuTableBody').innerHTML = `<tr><td colspan="7" class="table-empty">${esc(err.message)}</td></tr>`;
  }
}

async function showStudentProfile(id) {
  try {
    const { student, subscriptions, attempts, stats } = await api(`/students/${id}`);
    stuState.currentProfileId = id;
    stuState.currentStudentStage = student.stage;

    document.getElementById('spName').textContent = student.name;
    document.getElementById('spStatusTag').innerHTML = statusBadge(student.status);
    document.getElementById('spGov').textContent = `📍 المحافظة: ${student.governorate || '—'}`;
    const stagesMap = { 'year1': 'الفرقة الأولى', 'year2': 'الفرقة الثانية', 'year3': 'الفرقة الثالثة', 'year4': 'الفرقة الرابعة' };
    document.getElementById('spStage').textContent = `📚 المرحلة: ${stagesMap[student.stage] || 'غير محدد'}`;
    document.getElementById('spPhone').textContent = student.phone || '—';
    const wa = document.getElementById('spWaLink');
    if (student.phone) wa.href = `https://wa.me/${student.phone.replace(/\D/g, '')}`;
    else wa.style.display = 'none';
    const spParentPhoneEl = document.getElementById('spParentPhone');
    if (spParentPhoneEl) spParentPhoneEl.textContent = student.guardian_phone || '—';
    document.getElementById('spStudentNumber').textContent = student.student_number || '—';
    document.getElementById('spRegDate').textContent = fmtDT(student.created_at);
    document.getElementById('spLastLogin').textContent = student.last_login_at ? fmtDT(student.last_login_at) : 'لم يسجل دخول بعد';
    document.getElementById('spQuickStats').textContent =
      `⭐ ${stats.active_courses} كورس نشط | ${stats.passed_attempts}/${stats.total_attempts} محاولات ناجحة | ${stats.passed_lessons} درس مكتمل`;

    const subs = document.getElementById('spSubscriptions');
    if (!subscriptions.length) {
      subs.innerHTML = '<span class="table-empty">لا يوجد اشتراكات</span>';
    } else {
      subs.innerHTML = subscriptions.map((s) => `<span class="sub-tag">${esc(s.course_name_ar)} <span class="sub-status ${esc(s.status)}">${esc(s.status)}</span></span>`).join('');
    }

    const hist = document.getElementById('spExamsHistory');
    if (!attempts.length) {
      hist.innerHTML = '<tr><td colspan="6" class="table-empty">لا توجد محاولات</td></tr>';
    } else {
      hist.innerHTML = attempts.map((t) => {
        const pct = t.total_points ? `${t.score}/${t.total_points}` : '—';
        return `<tr>
          <td>${esc(t.exam_title)}</td>
          <td>${esc(t.course_name_ar)}</td>
          <td>${pct}</td>
          <td>${t.passed ? 'ناجح' : '—'}</td>
          <td>${statusBadge(t.status)}</td>
          <td>${fmtDT(t.submitted_at || t.started_at)}</td>
        </tr>`;
      }).join('');
    }

    const banBtn = document.getElementById('spBanBtn');
    if (student.status === 'banned') {
      banBtn.textContent = '✅ إلغاء الحظر';
      banBtn.classList.remove('btn-danger');
      banBtn.classList.add('btn-success');
    } else {
      banBtn.textContent = '⛔ حظر الحساب';
      banBtn.classList.remove('btn-success');
      banBtn.classList.add('btn-danger');
    }

    const profileCard = document.getElementById('studentProfileCard');
    profileCard.style.display = 'block';

    // تحويل الكارت لنافذة عائمة في منتصف الشاشة
    profileCard.style.position = 'fixed';
    profileCard.style.top = '50%';
    profileCard.style.left = '50%';
    profileCard.style.transform = 'translate(-50%, -50%)';
    profileCard.style.zIndex = '999999';
    profileCard.style.width = '95%';
    profileCard.style.maxWidth = '800px';
    profileCard.style.maxHeight = '90vh';
    profileCard.style.overflowY = 'auto';

    // عمل تعتيم (خلفية سوداء شفافة) وراء الملف
    profileCard.style.boxShadow = '0 0 0 100vw rgba(0,0,0,0.7), 0 10px 25px rgba(0,0,0,0.5)';
  } catch (err) {
    toast(err.message, 'error');
  }
}

window.openStudentById = function (id) { showStudentProfile(id); };
async function toggleStudentStatus() {
  const id = stuState.currentProfileId;
  if (!id) return;
  const isBanned = document.getElementById('spBanBtn').textContent.includes('إلغاء');
  const action = isBanned ? 'إلغاء حظر' : 'حظر';
  if (!confirm(`هل أنت متأكد من ${action} حساب «${document.getElementById('spName').textContent}»؟`)) return;
  try {
    await api(`/students/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: isBanned ? 'active' : 'banned' }) });
    toast(isBanned ? 'تم إلغاء الحظر بنجاح' : 'تم حظر الحساب وقطع جلساته');
    await showStudentProfile(id);
    loadStudents();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteStudentPermanently() {
  const id = stuState.currentProfileId;
  if (!id) return;
  const name = document.getElementById('spName').textContent;
  if (!confirm(`تحذير: سيتم حذف الطالب «${name}» نهائيًا مع كل بياناته (الاشتراكات ونتائج الامتحانات). هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟`)) return;
  try {
    await api(`/students/${id}`, { method: 'DELETE' });
    toast('تم حذف الطالب نهائيًا');
    document.getElementById('studentProfileCard').style.display = 'none';
    stuState.currentProfileId = null;
    loadStudents();
    if (typeof loadOverview === 'function') loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadManualActivateCourses() {
  const select = document.getElementById('maCourseSelect');
  select.innerHTML = '<option value="">جارِ التحميل...</option>';
  try {
    const res = await api('/courses');
    const stagesMap = { 'year1': 'الفرقة الأولى', 'year2': 'الفرقة الثانية', 'year3': 'الفرقة الثالثة', 'year4': 'الفرقة الرابعة' };

    const studentStage = stuState.currentStudentStage;
    const filteredCourses = res.items.filter(c => c.stage === studentStage);

    if (filteredCourses.length === 0) {
      select.innerHTML = '<option value="">لا توجد كورسات مضافة لهذه المرحلة</option>';
      return;
    }

    select.innerHTML = '<option value="">اختر الكورس...</option>' + filteredCourses
      .map((c) => {
        const stageName = stagesMap[c.stage] || 'مرحلة عامة';
        return `<option value="${c.id}">${esc(c.name_ar)} - (${stageName})${c.status !== 'published' ? ' (غير منشور)' : ''}</option>`;
      })
      .join('');

  } catch (err) {
    select.innerHTML = '<option value="">تعذر التحميل</option>';
  }
}

function initStudents() {
  document.getElementById('stuSearchBtn')?.addEventListener('click', () => {
    stuState.q = document.getElementById('stuSearchInput').value.trim();
    stuState.status = document.getElementById('stuStatusFilter').value;
    stuState.stage_id = document.getElementById('stuStageFilter').value;
    stuState.page = 1;
    loadStudents();
  });
  document.getElementById('stuSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('stuSearchBtn').click();
  });
  document.getElementById('spCloseBtn')?.addEventListener('click', () => {
    document.getElementById('studentProfileCard').style.display = 'none';
  });
  document.getElementById('spBanBtn')?.addEventListener('click', toggleStudentStatus);
  document.getElementById('spDeleteBtn')?.addEventListener('click', deleteStudentPermanently);
  document.getElementById('spActivateBtn')?.addEventListener('click', () => {
    document.getElementById('maStudentName').textContent = `للطالب: ${document.getElementById('spName').textContent}`;
    loadManualActivateCourses();
    openModal('manualActivateModal');
  });
  document.getElementById('maForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const courseId = Number(document.getElementById('maCourseSelect').value);
    if (!courseId || !stuState.currentProfileId) return toast('اختر الكورس', 'error');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/subscriptions/manual', { method: 'POST', body: JSON.stringify({ student_id: stuState.currentProfileId, course_id: courseId }) });
      toast('تم تفعيل الكورس بنجاح');
      closeModal('manualActivateModal');
      await showStudentProfile(stuState.currentProfileId);
      loadStudents();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('closeMaModalBtn')?.addEventListener('click', () => closeModal('manualActivateModal'));
  document.getElementById('maCancelBtn')?.addEventListener('click', () => closeModal('manualActivateModal'));

  loadStudentStages();
  loadStudents();
}

// ==================== قسم 6: الامتحانات والدرجات ====================
const examState = { course_id: '', exam_id: '', status: '', passed: '', page: 1, totalPages: 1, allExams: [] };

async function loadExamFilters() {
  try {
    const res = await api('/courses');
    const stagesMap = { 'year1': 'الفرقة الأولى', 'year2': 'الفرقة الثانية', 'year3': 'الفرقة الثالثة', 'year4': 'الفرقة الرابعة' };

    document.getElementById('exCourseFilter').innerHTML = '<option value="">الكل</option>' + res.items
      .map((c) => {
        const stageName = stagesMap[c.stage] || 'مرحلة عامة';
        return `<option value="${c.id}">${esc(c.name_ar)} - (${stageName})</option>`;
      })
      .join('');
  } catch (err) { /* يبقى فارغًا */ }

  try {
    const res = await api('/exams');
    examState.allExams = res.items;
    populateExamFilter();
  } catch (err) { /* يبقى فارغًا */ }
}

function populateExamFilter() {
  const select = document.getElementById('exExamFilter');
  const courseId = Number(examState.course_id);
  const filtered = courseId ? examState.allExams.filter((e) => e.course_id === courseId) : examState.allExams;
  select.innerHTML = '<option value="">الكل</option>' + filtered
    .map((e) => `<option value="${e.id}"${Number(examState.exam_id) === e.id ? ' selected' : ''}>${esc(e.title)}</option>`)
    .join('');
}

async function loadExamsTable() {
  const params = new URLSearchParams();
  if (examState.course_id) params.set('course_id', examState.course_id);
  if (examState.exam_id) params.set('exam_id', examState.exam_id);
  if (examState.status) params.set('status', examState.status);
  if (examState.passed !== '') params.set('passed', examState.passed);
  params.set('page', examState.page);
  try {
    const res = await api(`/attempts?${params}`);
    const tbody = document.getElementById('exTableBody');
    if (!res.items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">لا توجد نتائج مطابقة</td></tr>';
    } else {
      tbody.innerHTML = res.items.map((t) => {
        const pct = t.total_points ? Math.round((t.score / t.total_points) * 100) : null;
        const result = t.passed === null || t.passed === undefined
          ? '<span class="badge badge-muted">لم تُصحَّح بعد</span>'
          : t.passed ? '<span class="badge badge-success">ناجح</span>' : '<span class="badge badge-danger">راسب</span>';
        return `<tr>
          <td>${esc(t.student_name)}</td>
          <td>${esc(t.course_name_ar)}</td>
          <td>${esc(t.exam_title)}</td>
          <td>${t.score ?? 0}/${t.total_points ?? 0}</td>
          <td>${pct !== null ? `${pct}%` : '—'}</td>
          <td>${result}</td>
          <td>${fmtDT(t.submitted_at || t.started_at)}</td>
        </tr>`;
      }).join('');
    }
    document.getElementById('exCount').textContent = res.total;
    examState.totalPages = res.total_pages;
    renderPagination(document.getElementById('exPagination'), res.page, res.total_pages, (p) => {
      examState.page = p;
      loadExamsTable();
    });
  } catch (err) {
    document.getElementById('exTableBody').innerHTML = `<tr><td colspan="7" class="table-empty">${esc(err.message)}</td></tr>`;
  }
}

function essayCardHTML(a) {
  return `<div class="essay-card">
    <div class="essay-meta">
      <strong>${esc(a.student_name)}</strong>
      <span>${esc(a.exam_title)}</span>
    </div>
    <div class="essay-q">${esc(a.question_text)} <span class="meta-tag">${a.points} درجة</span></div>
    <div class="essay-answer">${esc(a.answer_text)}</div>
    ${a.model_answer ? `<details class="essay-model"><summary>الإجابة النموذجية</summary><p style="padding:6px 0;">${esc(a.model_answer)}</p></details>` : ''}
    <div class="essay-grade-row">
      <input type="number" class="form-control" min="0" max="${a.points}" step="0.5" value="${a.points}" data-grade-input>
      <button class="btn btn-primary btn-sm" data-grade-answer="${a.answer_id}">اعتماد التصحيح</button>
    </div>
  </div>`;
}

async function loadEssayQueue() {
  const container = document.getElementById('essayQueueContainer');
  try {
    const res = await api('/exams/essay-queue');
    document.getElementById('essayCount').textContent = res.items.length;
    if (!res.items.length) {
      container.innerHTML = '<p class="table-empty">لا توجد إجابات مقالية بانتظار التصحيح 🎉</p>';
      return;
    }
    container.innerHTML = res.items.map(essayCardHTML).join('');
    container.querySelectorAll('[data-grade-answer]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const card = btn.closest('.essay-card');
        const input = card.querySelector('[data-grade-input]');
        const points = Number(input.value);
        const max = Number(input.max);
        if (!(points >= 0) || points > max) return toast(`أدخل درجة بين 0 و ${max}`, 'error');
        const original = btn.textContent;
        btn.disabled = true;
        try {
          await api(`/exam-answers/${btn.dataset.gradeAnswer}/grade`, { method: 'POST', body: JSON.stringify({ points }) });
          toast('تم اعتماد التصحيح');
          loadEssayQueue();
          loadExamsTable();
          if (typeof loadOverview === 'function') loadOverview();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = original;
        }
      })
    );
  } catch (err) {
    container.innerHTML = `<p class="table-empty">${esc(err.message)}</p>`;
  }
}

function initExams() {
  document.getElementById('exApplyBtn')?.addEventListener('click', () => {
    examState.course_id = document.getElementById('exCourseFilter').value;
    examState.exam_id = document.getElementById('exExamFilter').value;
    examState.status = document.getElementById('exStatusFilter').value;
    examState.passed = document.getElementById('exPassedFilter').value;
    examState.page = 1;
    loadExamsTable();
  });
  document.getElementById('exCourseFilter')?.addEventListener('change', () => {
    examState.course_id = document.getElementById('exCourseFilter').value;
    examState.exam_id = '';
    populateExamFilter();
  });

  loadExamFilters();
  loadExamsTable();
  loadEssayQueue();
}

// ==================== قسم 7: الإشعارات ====================
function loadNotifStages() {
  const select = document.getElementById('notifStageSelect');
  if (!select) return;
  select.innerHTML = '<option value="">اختر المرحلة...</option>' +
    '<option value="prep3">الصف الثالث الإعدادي</option>' +
    '<option value="sec1">الصف الأول الثانوي</option>' +
    '<option value="sec2">الصف الثاني الثانوي</option>';
}

async function loadNotifStudents() {
  try {
    const res = await api('/students?page_size=100');
    document.getElementById('notifUserSelect').innerHTML = '<option value="">ابحث واختر...</option>' + res.items
      .map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.phone || '')})</option>`)
      .join('');
  } catch (err) { /* يبقى فارغًا */ }
}

function updateNotifScopeUI() {
  const scope = document.getElementById('notifScope').value;
  document.getElementById('notifStageWrap').style.display = scope === 'stage' ? '' : 'none';
  document.getElementById('notifUserWrap').style.display = scope === 'user' ? '' : 'none';
}

async function sendNotification(e) {
  e.preventDefault();
  const scope = document.getElementById('notifScope').value;
  const title = document.getElementById('notifTitle').value.trim();
  const body = document.getElementById('notifBody').value.trim();
  const link = document.getElementById('notifLink').value.trim();
  if (!title) return toast('اكتب عنوان الإشعار', 'error');
  if (!body) return toast('اكتب نص الإشعار', 'error');

  const payload = { scope, title, body };
  if (link) payload.link = link;
  if (scope === 'stage') {
    const stageId = document.getElementById('notifStageSelect').value;
    if (!stageId) return toast('اختر المرحلة الدراسية', 'error');
    payload.stage_id = stageId; // تم التعديل لأن المرحلة بقت نص مش رقم
  } else if (scope === 'user') {
    const userId = document.getElementById('notifUserSelect').value;
    if (!userId) return toast('اختر الطالب', 'error');
    payload.user_id = Number(userId);
  }

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true;
  try {
    const res = await api('/notifications', { method: 'POST', body: JSON.stringify(payload) });
    toast(`تم إرسال الإشعار إلى ${res.created} طالب`);
    e.target.reset();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function initNotifications() {
  document.getElementById('notifScope')?.addEventListener('change', updateNotifScopeUI);
  document.getElementById('notifForm')?.addEventListener('submit', sendNotification);

  updateNotifScopeUI();
  loadNotifStages();
  loadNotifStudents();
}

// ==================== إدارة وعرض الكورسات على النظام الجديد ====================
let currentEditCourseId = null;

async function loadTeacherCourses() {
  const grid = document.getElementById('teacherCoursesGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="width: 100%; text-align: center; padding: 20px;">جارِ تحميل الكورسات...</div>';

  try {
    const stageVal = document.getElementById('adminStageFilter')?.value || '';
    const termVal = document.getElementById('adminTermFilter')?.value || '';
    const doctorVal = document.getElementById('adminTeacherFilter')?.value || '';
    const qs = new URLSearchParams();
    if (stageVal) qs.set('stage', stageVal);
    if (termVal) qs.set('term', termVal);
    if (doctorVal) qs.set('doctor_name', doctorVal);
    const res = await api(`/courses${qs.toString() ? '?' + qs.toString() : ''}`);
    populateTeacherFilterOptions(res.items);
    if (!res.items.length) {
      grid.innerHTML = '<div style="width: 100%; text-align: center; padding: 20px; color: #777;">لا توجد كورسات مضافة بعد. اضغط على "+ إضافة كورس جديد" للبدء.</div>';
      return;
    }

    const stagesMap = { 'year1': 'الفرقة الأولى', 'year2': 'الفرقة الثانية', 'year3': 'الفرقة الثالثة', 'year4': 'الفرقة الرابعة' };

    grid.innerHTML = res.items.map(c => {
      const isArchived = c.status === 'archived';
      const statusClass = isArchived ? 'badge-muted' : (c.status === 'published' ? 'badge-success' : 'badge-warning');
      const statusLabel = isArchived ? 'مخفي' : (c.status === 'published' ? 'نشط' : 'مسودة');
      const stageLabel = stagesMap[c.stage] || 'مرحلة عامة';

      const safeName = esc(c.name_ar).replace(/'/g, "\\'");
      const safeDesc = esc(c.description || '').replace(/'/g, "\\'");
      const safeBadge = c.badge || 'normal';
      const safeDoctor = esc(c.doctor_name || '').replace(/'/g, "\\'");
      const safeCover = esc(c.cover_url || '').replace(/'/g, "\\'");

      return `
      <div class="course-card" style="${isArchived ? 'opacity: 0.6;' : ''}">
        <div class="course-badge ${statusClass}">${statusLabel}</div>
        <div class="course-thumbnail">
          <img src="${c.cover_url || 'https://via.placeholder.com/300x150?text=Course+Cover'}" style="width:100%; height:140px; object-fit:cover; border-radius:8px;">
        </div>
        <h3 style="margin-top: 10px;">${esc(c.name_ar)}</h3>
        <p style="font-size:0.9rem; color:#555;">المرحلة: <strong>${stageLabel}</strong> | الترم: <strong>${c.term_name_ar || '-'}</strong> | السعر: <strong>${c.price} ج</strong></p>
        <p style="font-size:0.9rem; color:#555;">المدرس: <strong>${esc(c.doctor_name || '-')}</strong></p>

        <div class="card-actions-row" style="margin-top:15px; display:flex; flex-wrap: wrap; gap:5px;">
          <button class="btn btn-sm btn-info" onclick="openLecturesManager(${c.id}, '${safeName}')" style="flex: 100%; background-color: #3b82f6; color: white; border: none;">📚 إدارة المحاضرات</button>
          
          <button class="btn btn-sm btn-secondary" onclick="openEditCourse(${c.id}, '${safeName}', ${c.price}, '${c.stage}', '${safeDesc}', '${safeBadge}', '${c.term_code || ''}', '${safeDoctor}', '${safeCover}')" style="flex:1;">تعديل</button>
          <button class="btn btn-sm btn-warning" onclick="toggleCourseVisibility(${c.id}, '${c.status}')" style="flex:1;">
            ${isArchived ? 'إظهار' : 'إخفاء'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteCourse(${c.id})" style="flex:1;">حذف</button>
        </div>
      </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div style="color:red; padding: 20px;">خطأ: ${err.message}</div>`;
  }
}

function populateTeacherFilterOptions(items) {
  const doctorSelect = document.getElementById('adminTeacherFilter');
  if (!doctorSelect) return;
  const currentValue = doctorSelect.value;
  const doctors = [...new Set(items.map((c) => c.doctor_name).filter(Boolean))].sort();
  doctorSelect.innerHTML = '<option value="">-- كل المدرسين --</option>' +
    doctors.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  if (doctors.includes(currentValue)) doctorSelect.value = currentValue;
}
function initTeacherCourseFilters() {
  const stageEl = document.getElementById('adminStageFilter');
  const termEl = document.getElementById('adminTermFilter');
  const doctorEl = document.getElementById('adminTeacherFilter');
  if (!stageEl || stageEl.dataset.bound) return;
  stageEl.dataset.bound = '1';
  [stageEl, termEl, doctorEl].forEach((el) => {
    el?.addEventListener('change', () => loadTeacherCourses());
  });
}
window.openEditCourse = function (id, name, price, stage, desc, badge, term, doctorName, coverUrl) {
  currentEditCourseId = id;
  document.getElementById('courseTitleInput').value = name;
  document.getElementById('coursePriceInput').value = price;
  document.getElementById('courseStageInput').value = stage;
  document.getElementById('courseTermInput').value = term;
  document.getElementById('courseTeacherInput').value = doctorName;
  document.getElementById('courseDescInput').value = desc;
  document.getElementById('courseBadgeInput').value = badge;

  const coverPreview = document.getElementById('courseCoverPreview');
  if (coverPreview) {
    if (coverUrl) { coverPreview.src = coverUrl; coverPreview.style.display = 'block'; }
    else { coverPreview.style.display = 'none'; }
  }
  const imgInput = document.getElementById('courseImageInput');
  if (imgInput) imgInput.removeAttribute('required');

  document.querySelector('#newCourseModal h3').innerHTML = '✏️ تعديل بيانات المادة';
  document.querySelector('#newCourseForm button[type="submit"]').innerHTML = 'حفظ التعديلات 💾';

  openModal('newCourseModal');
};

window.toggleCourseVisibility = async function (id, currentStatus) {
  const newStatus = currentStatus === 'archived' ? 'published' : 'archived';
  try {
    await api(`/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    toast(newStatus === 'archived' ? 'تم إخفاء المادة عن الطلاب' : 'تم إظهار المادة للطلاب', 'success');
    loadTeacherCourses();
  } catch (err) { toast(err.message, 'error'); }
};

window.deleteCourse = async function (id) {
  if (!confirm('هل أنت متأكد من حذف هذه المادة نهائياً بكل محتوياتها؟')) return;
  try {
    await api(`/courses/${id}`, { method: 'DELETE' });
    toast('تم حذف المادة بنجاح', 'success');
    loadTeacherCourses();
    if (typeof loadOverview === 'function') loadOverview();
  } catch (err) { toast(err.message, 'error'); }
};

document.addEventListener('DOMContentLoaded', () => {
  initTeacherCourseFilters();
  loadTeacherCourses();

  const openCourseBtn = document.getElementById('openNewCourseModal');
  const closeCourseBtn = document.getElementById('closeNewCourseModalBtn');
  const cancelCourseBtn = document.getElementById('cancelCourseBtn');
  const courseForm = document.getElementById('newCourseForm');

  const resetModal = () => {
    currentEditCourseId = null;
    if (courseForm) courseForm.reset();
    document.querySelector('#newCourseModal h3').innerHTML = '➕ إضافة مادة جديدة';
    document.querySelector('#newCourseForm button[type="submit"]').innerHTML = 'حفظ ونشر المادة فوراً 🚀';
    const coverPreview = document.getElementById('courseCoverPreview');
    if (coverPreview) coverPreview.style.display = 'none';
    const imgInput = document.getElementById('courseImageInput');
    if (imgInput) imgInput.setAttribute('required', 'required');
    closeModal('newCourseModal');
  };

  if (openCourseBtn) openCourseBtn.addEventListener('click', () => { resetModal(); openModal('newCourseModal'); });
  if (closeCourseBtn) closeCourseBtn.addEventListener('click', resetModal);
  if (cancelCourseBtn) cancelCourseBtn.addEventListener('click', resetModal);

  if (courseForm) {
    courseForm.onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'جارِ الحفظ...';

      try {
        const newCoverFile = document.getElementById('courseImageInput').files[0];
        if (!currentEditCourseId && !newCoverFile) {
          toast('من فضلك اختر صورة غلاف المادة', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }

        const payload = {
          name_ar: document.getElementById('courseTitleInput').value.trim(),
          stage: document.getElementById('courseStageInput').value,
          term: document.getElementById('courseTermInput').value,
          doctor_name: document.getElementById('courseTeacherInput').value,
          price: Number(document.getElementById('coursePriceInput').value),
          description: document.getElementById('courseDescInput').value.trim(),
          badge: document.getElementById('courseBadgeInput').value,
          status: 'published'
        };

        let res;
        if (currentEditCourseId) {
          res = await api(`/courses/${currentEditCourseId}`, { method: 'PATCH', body: JSON.stringify(payload) });
          toast('تم تعديل المادة بنجاح', 'success');
        } else {
          res = await api('/courses', { method: 'POST', body: JSON.stringify(payload) });
          toast('تم إضافة المادة بنجاح', 'success');
        }

        const coverFile = document.getElementById('courseImageInput').files[0];
        if (coverFile) {
          const fd = new FormData();
          fd.append('cover', coverFile);
          await api(`/courses/${res.item?.id || res.id}/cover`, { method: 'POST', body: fd });
        }

        resetModal();
        loadTeacherCourses();
        if (typeof loadOverview === 'function') loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    };
  }
});

// ==================== إدارة المحاضرات (حذف وعرض) ====================
let currentManageCourseId = null;

// 1. دالة فتح نافذة المحاضرات (بالإجبار والتوليد التلقائي)
// 1. دالة فتح نافذة المحاضرات (النسخة المدمرة للأخطاء)
window.openLecturesManager = function (courseId, courseName) {
  currentManageCourseId = courseId;

  // بنمسح أي نافذة قديمة معلقة أو مستخبية في الـ HTML عشان متبوظش الدنيا
  const oldModal = document.getElementById('manageLecturesModal');
  if (oldModal) oldModal.remove();

  // بنبني النافذة من الصفر وبنرميها في وش الشاشة بقوة
  const modalHtml = `
    <div id="manageLecturesModal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); z-index: 2147483647; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(3px);">
      <div style="background: #fff; padding: 20px; border-radius: 10px; width: 90%; max-width: 500px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        <h3 style="margin-top: 0; color: #333; font-family: inherit; border-bottom: 2px solid #eee; padding-bottom: 10px;">
          📚 محاضرات كورس: <span style="color: #3b82f6;">${esc(courseName)}</span>
        </h3>
        
        <div id="lecturesListContainer" style="margin-top: 15px; overflow-y: auto; padding-right: 5px; min-height: 100px; max-height: 50vh;">
          <div style="text-align: center; padding: 10px; font-weight: bold;">جارِ تحميل المحاضرات...</div>
        </div>

        <div style="margin-top: 20px; text-align: left; border-top: 1px solid #eee; padding-top: 15px;">
          <button onclick="closeLecturesModal()" style="padding: 8px 20px; cursor: pointer; background: #ef4444; color: white; border: none; border-radius: 5px; font-weight: bold; font-family: inherit;">إغلاق النافذة</button>
        </div>
      </div>
    </div>
  `;

  // بنلزقها في الـ Body مباشرة عشان تبقى بره أي حاجة مخفية
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // بنشغل دالة جلب المحاضرات عشان تملى النافذة
  loadCourseLectures(courseId);
};

// 2. دالة إغلاق النافذة
window.closeLecturesModal = function () {
  const modal = document.getElementById('manageLecturesModal');
  if (modal) modal.remove(); // بنمسحها خالص من الصفحة لحد ما نعوزها تاني
};

// 3. دالة جلب المحاضرات ورسمها (بالفلترة الذكية وتوحيد الأرقام)
async function loadCourseLectures(courseId) {
  const container = document.getElementById('lecturesListContainer');
  container.innerHTML = '<div style="text-align: center; padding: 10px;">جارِ تحميل المحاضرات...</div>';

  try {
    const res = await api('/lessons');
    console.log("1. كل المحاضرات اللي راجعة من السيرفر:", res.items); // رادار

    const allLessons = res.items || [];

    // توحيد الأنواع (Number) عشان نضمن التطابق بنسبة 100%
    const courseLessons = allLessons.filter(l => Number(l.course_id) === Number(courseId));
    console.log("2. محاضرات الكورس الحالي فقط:", courseLessons); // رادار

    if (courseLessons.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: #777; padding: 10px;">لا توجد محاضرات في هذا الكورس حتى الآن.</div>';
      return;
    }

    container.innerHTML = courseLessons.map(l => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #eee; background: #f9f9f9; margin-bottom: 5px; border-radius: 8px;">
        <div style="font-weight: 600; color: #333;">
          ${esc(l.name_ar)}
        </div>
        <button class="btn btn-sm btn-danger" onclick="deleteLesson(${l.id})" style="background-color: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">🗑️ حذف</button>
      </div>
    `).join('');

  } catch (err) {
    console.error("خطأ في جلب المحاضرات:", err);
    container.innerHTML = `<div style="color: red; text-align: center; padding: 10px;">خطأ: ${err.message}</div>`;
  }
}

// 4. دالة حذف المحاضرة
window.deleteLesson = async function (lessonId) {
  if (!confirm('هل أنت متأكد من حذف هذه المحاضرة نهائياً بكل محتوياتها؟')) return;

  try {
    await api(`/lessons/${lessonId}`, { method: 'DELETE' });
    toast('تم حذف المحاضرة بنجاح', 'success');

    // تحديث القائمة فوراً
    if (currentManageCourseId) {
      loadCourseLectures(currentManageCourseId);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
};


// ==================== قسم المبيعات والأرباح (بيانات حقيقية من /api/teacher/sales) ====================
async function loadSalesData() {
  const doctorFilterEl = document.getElementById('salesDoctorFilter');
  const dateFromEl = document.getElementById('salesDateFrom');
  const dateToEl = document.getElementById('salesDateTo');
  const tableBody = document.getElementById('salesTableBody');

  if (!tableBody) return;

  const doctor = doctorFilterEl ? doctorFilterEl.value.trim() : '';
  const dateFrom = dateFromEl ? dateFromEl.value : '';
  const dateTo = dateToEl ? dateToEl.value : '';

  tableBody.innerHTML = '<tr><td colspan="6" class="table-empty">جارِ تحميل المبيعات...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (doctor) params.set('doctor', doctor);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const res = await api(`/sales${params.toString() ? `?${params}` : ''}`);
    const items = res.items || [];

    const revEl = document.getElementById('teacherPendingRevenue');
    const countEl = document.getElementById('teacherFilteredLectures');
    if (revEl) revEl.textContent = res.total_revenue ?? 0;
    if (countEl) countEl.textContent = items.length;

    if (!items.length) {
      tableBody.innerHTML = '<tr><td colspan="6" class="table-empty">لا توجد مبيعات في هذا النطاق.</td></tr>';
      return;
    }
    tableBody.innerHTML = items.map((s) => `
      <tr>
        <td dir="ltr"><strong>#${s.id}</strong></td>
        <td>${esc(s.student_name)}</td>
        <td>${esc(s.course_name_ar)} — د. ${esc(s.doctor_name || 'غير محدد')}</td>
        <td><strong>${s.price_egp} ج.م</strong></td>
        <td>${s.via_code ? '<span class="badge badge-info">كود تفعيل</span>' : '<span class="badge badge-success">تفعيل يدوي</span>'}</td>
        <td>${fmtDT(s.activated_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" class="table-empty">${esc(err.message)}</td></tr>`;
  }
}

async function loadPlatformTotalRevenue() {
  const el = document.getElementById('totalPlatformRevenue');
  if (!el) return;
  try {
    const res = await api('/sales');
    el.textContent = res.total_revenue ?? 0;
  } catch { /* leave the placeholder if this fails; the filtered card below still loads independently */ }
}

function initSales() {
  ['salesDoctorFilter', 'salesDateFrom', 'salesDateTo'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(id === 'salesDoctorFilter' ? 'input' : 'change', loadSalesData);
  });

  // زرار تسوية الحساب مُعطّل عمدًا: لا يوجد نظام مدفوعات/رصيد مستقل للمدرسين في الباك إند حاليًا.
  loadPlatformTotalRevenue();
  loadSalesData();
}
// ==========================================================================
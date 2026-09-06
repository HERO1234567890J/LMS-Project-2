(function () {
  'use strict';

  // ---------- Helpers ----------
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(url, options = {}) {
    const init = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...options };
    if (init.body && typeof init.body === 'object') init.body = JSON.stringify(init.body);
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'حدث خطأ غير متوقع');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(text, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = text;
    c.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function pct(score, total) {
    if (!total) return 0;
    return Math.round((score / total) * 100);
  }

  function ytEmbed(url) {
    const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : null;
  }

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const sidebar = $('sidebar');
  const navItems = document.querySelectorAll('.sidebar-nav li');
  const sections = document.querySelectorAll('.app-section');

  // ---------- Global state ----------
  const state = {
    currentCourseId: null,
    currentCourseName: '',
    currentLessonId: null,
    lessonData: null,
    exam: null, // { attempt, questions, answers, qIndex, timerInterval, deadline }
  };

  window.openModal = function (id) {
    $(id)?.classList.add('open');
    overlay?.classList.add('active');
  };

  window.closeModal = function (id) {
    $(id)?.classList.remove('open');
    if (!document.querySelector('.modal.open')) overlay?.classList.remove('active');
  };

  // ---------- SPA navigation ----------
  function showSection(name) {
    navItems.forEach((i) => i.classList.toggle('active', i.getAttribute('data-section') === name));
    sections.forEach((sec) => sec.classList.toggle('active', sec.id === name));
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    }
    window.scrollTo({ top: 0 });
  }

  function showLevel(id) {
    if (sidebar.classList.contains('open')) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
    document.querySelectorAll('#enrolled .drill-level').forEach((lv) => lv.classList.add('hidden'));
    $(id)?.classList.remove('hidden');
  }

  // ---------- Catalog (available courses) ----------
  async function loadAvailableCourses() {
    const grid = $('availableCoursesGrid') || $('availableSubjectsGrid');
    try {
      const termSelect = $('termFilterSelect');
      const termQuery = termSelect && termSelect.value ? `?term=${encodeURIComponent(termSelect.value)}` : '';
      const { items } = await api('/api/student/courses' + termQuery);
      if (!items.length) {
        grid.innerHTML = '<p class="empty-state">لا توجد كورسات متاحة حاليًا. يمكنك الحصول على كود من المدرس.</p>';
        return;
      }
      grid.innerHTML = items.map((c) => `
        <div class="course-card">
          ${c.badge === 'featured' ? '<div class="course-badge">مميز</div>' : ''}
          
          <!-- كود الصورة اللي ضفناه -->
          <div class="course-thumbnail" style="margin-bottom: 10px;">
            <img src="${c.cover_url || 'https://via.placeholder.com/300x150?text=صورة+الكورس'}" style="width:100%; height:140px; object-fit:cover; border-radius:8px;">
          </div>

          <h3>${esc(c.name_ar)}</h3>
          <p class="course-meta">${esc(c.stage_name_ar)} · ${esc(c.term_name_ar || '')} · د. ${esc(c.doctor_name || 'غير محدد')}</p>
          <p class="course-desc">${esc(c.description || '')}</p>
          <div class="course-price">${c.price} جنيه <span class="course-lessons">${c.lessons_count} درس</span></div>
          <button class="btn btn-primary activate-btn" data-id="${c.id}" data-name="${esc(c.name_ar)}">تفعيل بالكود</button>
        </div>`).join('');
    } catch (err) {
      grid.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  // ---------- Activation modal ----------
  let redeemTarget = null;
  function openActivationModal(course) {
    redeemTarget = course;
    $('modalCourseName').textContent = `تفعيل: ${course.name}`;
    $('activationCodeInput').value = '';
    $('modalRedeemMsg').textContent = '';
    $('activationModal').classList.add('open');
    overlay.classList.add('active');
  }
  function closeActivationModal() {
    $('activationModal').classList.remove('open');
    if (!sidebar.classList.contains('open')) overlay.classList.remove('active');
    redeemTarget = null;
  }

  async function confirmRedeem() {
    const msgEl = $('modalRedeemMsg');
    msgEl.textContent = '';
    if (!redeemTarget) return;
    const code = $('activationCodeInput').value.trim();
    if (code.length !== 12) {
      msgEl.textContent = 'أدخل كود صحيح مكون من 12 رقم';
      msgEl.style.color = '#ef4444';
      return;
    }
    const btn = $('confirmCodeBtn');
    btn.disabled = true;
    try {
      await api('/api/student/redeem', { method: 'POST', body: { code } });
      toast('تم تفعيل الكود بنجاح — أضيف الكورس إلى كورساتك', 'success');
      closeActivationModal();
      loadAvailableCourses();
      loadEnrolledCourses();
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = '#ef4444';
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Enrolled courses ----------
  // ---------- Enrolled courses ----------
  async function loadEnrolledCourses() {
    const list = $('enrolledCoursesList');
    try {
      const { items } = await api('/api/student/subscriptions');
      if (!items.length) {
        list.innerHTML = '<p class="empty-state">لم تشترك في أي كورس بعد. فعّل كورسًا من قسم الكورسات المتاحة.</p>';
        return;
      }

      list.innerHTML = items.map((s) => `
        <div class="course-card">
          <!-- صورة مؤقتة لحد ما نسحب الصورة الحقيقية -->
          <div class="course-thumbnail" style="margin-bottom: 10px;">
            <img class="enrolled-course-img" src="https://via.placeholder.com/300x150?text=جاري+التحميل..." style="width:100%; height:140px; object-fit:cover; border-radius:8px;">
          </div>

          <h3>${esc(s.course_name_ar)}</h3>
          <p class="course-meta">مفعّل في ${fmtDate(s.activated_at)}</p>
          <div class="progress-bar-container"><div class="progress-bar" style="width:0%"></div></div>
          <span class="progress-text">جاري تحميل نسبة الإنجاز...</span>
          <button class="btn btn-secondary enter-course-btn" data-id="${s.course_id}">دخول الكورس</button>
        </div>`).join('');

      list.querySelectorAll('.enter-course-btn').forEach((btn) => {
        btn.addEventListener('click', () => enterCourse(Number(btn.getAttribute('data-id'))));
      });

      list.querySelectorAll('.course-card').forEach(async (card) => {
        const id = Number(card.querySelector('.enter-course-btn').getAttribute('data-id'));
        try {
          const detail = await api(`/api/student/courses/${id}`);
          const bar = card.querySelector('.progress-bar');
          const text = card.querySelector('.progress-text');
          const img = card.querySelector('.enrolled-course-img'); // مسكنا الصورة

          bar.style.width = detail.progress.completed_percent + '%';
          text.textContent = `تم إنجاز ${detail.progress.completed_percent}% (${detail.progress.passed_lessons} من ${detail.progress.total_lessons} دروس)`;

          // التعديل: نحط الصورة الحقيقية بعد ما الداتا ترجع
          if (detail.course && detail.course.cover_url) {
            img.src = detail.course.cover_url;
          } else {
            img.src = 'https://via.placeholder.com/300x150?text=بدون+صورة';
          }

        } catch (e) {
          card.querySelector('.progress-text').textContent = e.message;
        }
      });
    } catch (err) {
      list.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  // ---------- Course detail / lectures ----------
  async function enterCourse(courseId) {
    state.currentCourseId = courseId;
    showLevel('level-lectures');
    $('lecturesContainer').innerHTML = '<p class="empty-state">جاري تحميل الدروس...</p>';
    try {
      const data = await api(`/api/student/courses/${courseId}`);
      state.currentCourseName = data.course.name_ar;
      $('heroCourseTitle').textContent = data.course.name_ar;
      $('heroCourseSubtitle').textContent = data.course.description || '';
      $('heroBreadcrumb').textContent = `${data.course.stage_name_ar} · ${data.course.term_name_ar || ''} · د. ${data.course.doctor_name || 'غير محدد'}`;
      $('heroLessonsCount').textContent = data.progress.total_lessons;
      $('heroPassedCount').textContent = data.progress.passed_lessons;
      $('heroPercent').textContent = data.progress.completed_percent + '%';
      renderLectures(data.lessons);
    } catch (err) {
      $('lecturesContainer').innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  function renderLectures(lessons) {
  const container = $('lecturesContainer'); // أو document.getElementById حسب ما إنت معرف $
  if (!lessons.length) {
    container.innerHTML = '<p class="empty-state">لا توجد دروس منشورة في هذه المادة بعد.</p>';
    return;
  }
  
  container.innerHTML = lessons.map((l) => {
    // حالة الدرس المقفول (يحتاج إلى شراء)
    if (!l.open) {
      // نفترض أن السعر يأتي من الباك إند l.price، وإذا لم يوجد نضع 50 كافتراضي للتجربة
      const price = l.price || 50; 
      return `
        <div class="lecture-card locked" style="display: flex; justify-content: space-between; align-items: center; padding: 15px;">
          <div>
            <span style="color: #666; font-weight: bold; display: block;">🔒 ${esc(l.name_ar)}</span>
            <span class="lecture-meta" style="font-size: 0.85rem; color: #888;">${l.exams_count ? `${l.exams_count} امتحان` : 'لا يوجد امتحان'}</span>
          </div>
          <button class="btn btn-sm btn-success" onclick="buyLecture(${l.id}, ${price}, '${esc(l.name_ar)}')" style="margin: 0; padding: 5px 15px;">
            شراء بـ ${price} ج.م
          </button>
        </div>`;
    }
    
    // حالة الدرس المفتوح (تم شراؤه مسبقاً)
    return `
      <div class="lecture-card unlocked" style="cursor: pointer;">
        <div class="lecture-header" style="display: flex; justify-content: space-between;">
          <span>${l.passed ? '✅' : '🔓'} ${esc(l.name_ar)}</span>
          <span class="lecture-open-hint" style="background: rgba(16, 185, 129, 0.1); color: var(--primary); padding: 3px 10px; border-radius: 6px; font-weight: bold;">
            ${l.passed ? 'تم الاجتياز' : 'دخول للمشاهدة ➔'}
          </span>
        </div>
        <div class="lecture-meta">${l.exams_count ? `${l.exams_count} امتحان` : 'لا يوجد امتحان'}</div>
      </div>`;
  }).join('');
  
  container.querySelectorAll('.lecture-card.unlocked').forEach((card, idx) => {
    card.addEventListener('click', () => {
      if (typeof enterLesson === 'function') {
        enterLesson(lessons[idx].id);
      }
    });
  });
}

// دالة الشراء (توضع تحت دالة renderLectures مباشرة)
window.buyLecture = function() {
  toast('شراء المحاضرات بالمحفظة غير مفعل حاليا. استخدم كود التفعيل الخاص بالمادة.', 'warning');
};

  // ---------- Lesson content ----------
  async function enterLesson(lessonId) {
    state.currentLessonId = lessonId;
    showLevel('level-tabs');
    $('currentLectureTitle').textContent = 'جاري التحميل...';
    try {
      const data = await api(`/api/student/courses/${state.currentCourseId}/lessons/${lessonId}`);
      state.lessonData = data;
      $('currentLectureTitle').textContent = data.lesson.name_ar;
      renderVideos(data);
      renderFiles(data.files);
      renderExams(data.exams);
    } catch (err) {
      toast(err.message, 'error');
      $('currentLectureTitle').textContent = 'تعذر تحميل الدرس';
    }
  }

  function renderVideos(data) {
    const container = $('videoContainer');
    const videos = [...(data.videos || [])];
    if ((!videos.length || !videos.some((v) => v.provider === 'bunny')) && data.lesson.bunny_embed_url) {
      videos.unshift({ title: 'فيديو الدرس', url: data.lesson.bunny_embed_url, provider: 'bunny' });
    }
    if ((!videos.length || !videos.some((v) => v.provider === 'youtube')) && data.lesson.youtube_url) {
      videos.unshift({ title: 'فيديو الدرس', url: data.lesson.youtube_url, provider: 'youtube' });
    }
    if (!videos.length) {
      container.innerHTML = '<p class="empty-state">لا يوجد فيديو لهذا الدرس.</p>';
      return;
    }
    container.innerHTML = videos.map((v) => {
      if (v.provider === 'bunny') {
        return `<div class="video-container"><iframe src="${esc(v.url)}" title="${esc(v.title)}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`;
      }
      const embed = ytEmbed(v.url);
      if (embed) {
        return `<div class="video-container"><iframe src="${embed}" title="${esc(v.title)}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`;
      }
      if (v.provider === 'upload') {
        return `<div class="video-container"><video controls src="${esc(v.url)}" style="width:100%"></video></div>`;
      }
      return `<p class="empty-state"><a href="${esc(v.url)}" target="_blank" rel="noopener">📺 ${esc(v.title)} — فتح الفيديو</a></p>`;
    }).join('');
  }

  function renderFiles(files) {
    const container = $('filesContainer');
    if (!files.length) {
      container.innerHTML = '<p class="empty-state">لا توجد ملفات مرفقة مع هذا الدرس.</p>';
      return;
    }
    container.innerHTML = files.map((f) => `
      <div class="pdf-file-item">
        <div class="pdf-icon">📄</div>
        <div class="pdf-info">
          <h4>${esc(f.title)}</h4>
          ${f.file_size ? `<span>الحجم: ${Math.round(f.file_size / 1024)} كيلوبايت</span>` : ''}
        </div>
        <div class="pdf-actions">
          <a href="${esc(f.url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">👁️ معاينة</a>
          <a href="${esc(f.url)}" download class="btn btn-primary btn-sm">📥 تحميل الملف</a>
        </div>
      </div>`).join('');
  }

  function renderExams(exams) {
    const container = $('examsContainer');

    // لو مفيش امتحان، نطلع للطالب زرار "تعليم المحاضرة كمكتملة"
    if (!exams.length) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 30px; background: #f8f9fa; border-radius: 10px; border: 1px dashed #ccc;">
          <p style="font-size: 1.1rem; margin-bottom: 15px;">لا يوجد امتحان لهذه المحاضرة. هل أنهيت المذاكرة؟</p>
          <button id="markCompleteBtn" class="btn btn-success btn-lg" style="width: 100%; max-width: 300px; padding: 12px; font-size: 1.1rem; cursor: pointer;">
             ✅ تعليم المحاضرة كمكتملة
          </button>
        </div>
      `;

      // أمر الزرار لما الطالب يدوس عليه
      $('markCompleteBtn')?.addEventListener('click', async (e) => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = 'جاري الحفظ...';
        try {
          await api(`/api/student/courses/${state.currentCourseId}/lessons/${state.currentLessonId}/complete`, { method: 'POST' });
          toast('تم إكمال المحاضرة بنجاح، يمكنك الآن الانتقال للمحاضرة التالية!', 'success');

          // بعد ثانية ونص، نرجعه لقائمة الكورس عشان يلاقي الدرس اللي بعده اتفتح
          setTimeout(() => enterCourse(state.currentCourseId), 1500);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = '✅ تعليم المحاضرة كمكتملة';
        }
      });
      return;
    }

    // لو فيه امتحان بيتعرض عادي زي ما كان
    container.innerHTML = exams.map((e) => `
      <div class="exam-start-card">
        <div class="exam-start-icon">🎯</div>
        <div class="exam-start-details">
          <h3>${esc(e.title)}</h3>
          <p>${esc(e.description || '')}</p>
          ${e.passed ? '<span class="status-badge badge-success">✓ تم اجتياز هذا الامتحان</span>' : ''}
          <div class="exam-meta-pills">
            ${e.duration_minutes ? `<span class="meta-pill">⏱️ ${e.duration_minutes} دقيقة</span>` : '<span class="meta-pill">⏱️ بلا حد زمني</span>'}
            <span class="meta-pill">🎯 نسبة النجاح: ${e.pass_percent}%</span>
            ${e.attempts_count ? `<span class="meta-pill">📄 محاولاتك: ${e.attempts_count}</span>` : ''}
            ${e.best_percent !== null ? `<span class="meta-pill">📊 أفضل نتيجة: ${e.best_percent}%</span>` : ''}
          </div>
        </div>
        <div class="exam-start-action">
          <button class="btn btn-success btn-lg start-exam-btn" data-id="${e.id}" data-title="${esc(e.title)}">▶ بدء الامتحان</button>
        </div>
      </div>`).join('');

    container.querySelectorAll('.start-exam-btn').forEach((btn) => {
      btn.addEventListener('click', () => startExam(Number(btn.getAttribute('data-id'))));
    });
  }

  // ---------- Exam interface ----------
  async function startExam(examId) {
    try {
      const res = await api(`/api/student/exams/${examId}/attempts`, { method: 'POST' });
      state.exam = {
        attempt: res.attempt,
        questions: res.questions,
        answers: {},
        qIndex: 0,
        timerInterval: null,
        deadline: null,
      };
      openExamInterface(res.exam.title);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function openExamInterface(title) {
    $('examTitle').textContent = title;
    showLevel('level-exam-interface');
    renderExamQuestion();
    renderExamGrid();
    startExamTimer();
  }

  function startExamTimer() {
    const exam = state.exam;
    if (!exam) return;
    const el = $('examTimer');
    clearInterval(exam.timerInterval);

    const examMeta = state.lessonData?.exams.find((e) => e.id === exam.attempt.exam_id);
    const minutes = examMeta?.duration_minutes ?? null;
    if (!minutes) {
      el.textContent = 'بلا حد زمني';
      return;
    }
    const startedAt = new Date(String(exam.attempt.started_at).replace(' ', 'T') + 'Z').getTime();
    exam.deadline = startedAt + minutes * 60000;

    exam.timerInterval = setInterval(() => {
      const remain = exam.deadline - Date.now();
      if (remain <= 0) {
        clearInterval(exam.timerInterval);
        toast('انتهى الوقت — جاري تسليم الإجابات تلقائيًا', 'warning');
        submitExam(false);
        return;
      }
      const total = Math.floor(remain / 1000);
      const m = Math.floor(total / 60).toString().padStart(2, '0');
      const s = (total % 60).toString().padStart(2, '0');
      el.textContent = `${m}:${s}`;
      el.classList.toggle('pulse', total <= 60);
    }, 500);
  }

  function renderExamQuestion() {
    const exam = state.exam;
    const q = exam.questions[exam.qIndex];
    $('questionNumber').textContent = `سؤال ${exam.qIndex + 1} من ${exam.questions.length}`;
    $('questionText').textContent = q.question_text;
    const opts = $('optionsGroup');
    opts.innerHTML = '';
    const saved = exam.answers[q.id];

    if (q.question_type === 'essay') {
      const ta = document.createElement('textarea');
      ta.className = 'form-control essay-input';
      ta.rows = 6;
      ta.placeholder = 'اكتب إجابتك هنا...';
      ta.value = saved?.answer_text || '';
      ta.addEventListener('input', () => { exam.answers[q.id] = { answer_text: ta.value.trim() }; renderExamGrid(); });
      opts.appendChild(ta);
    } else {
      (q.options || []).forEach((o) => {
        const label = document.createElement('label');
        label.className = 'option-label';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'q_opt';
        input.checked = saved && saved.selected_option_id === o.id;
        input.addEventListener('change', () => { exam.answers[q.id] = { selected_option_id: o.id }; renderExamGrid(); });
        const span = document.createElement('span');
        span.textContent = o.option_text;
        label.appendChild(input);
        label.appendChild(span);
        opts.appendChild(label);
      });
    }

    $('prevQBtn').disabled = exam.qIndex === 0;
    const nextBtn = $('nextQBtn');
    nextBtn.disabled = exam.qIndex === exam.questions.length - 1;
    nextBtn.textContent = exam.qIndex === exam.questions.length - 1 ? 'تم' : 'التالي';
  }

  function renderExamGrid() {
    const exam = state.exam;
    const grid = $('questionGridNav');
    grid.innerHTML = '';
    exam.questions.forEach((_, idx) => {
      const btn = document.createElement('button');
      btn.className = `q-btn ${idx === exam.qIndex ? 'current' : ''} ${exam.answers[exam.questions[idx].id] ? 'answered' : ''}`;
      btn.textContent = idx + 1;
      btn.addEventListener('click', () => {
        exam.qIndex = idx;
        renderExamQuestion();
        renderExamGrid();
      });
      grid.appendChild(btn);
    });
  }

  async function submitExam(manual) {
    const exam = state.exam;
    if (!exam) return;
    clearInterval(exam.timerInterval);

    const missing = exam.questions.filter((q) => !exam.answers[q.id]);
    if (manual && missing.length) {
      toast(`لم تجب عن ${missing.length} أسئلة بعد`, 'error');
      return;
    }

    const answers = exam.questions.map((q) => {
      const a = exam.answers[q.id] || {};
      return q.question_type === 'essay'
        ? { question_id: q.id, answer_text: a.answer_text || '' }
        : { question_id: q.id, selected_option_id: a.selected_option_id || null };
    });

    $('submitExamBtn').disabled = true;
    try {
      const res = await api(`/api/student/attempts/${exam.attempt.id}/submit`, { method: 'POST', body: { answers } });
      showExamResult(res.attempt);
      loadResults();
    } catch (err) {
      toast(err.message, 'error');
      startExamTimer();
    } finally {
      $('submitExamBtn').disabled = false;
    }
  }

  function showExamResult(attempt) {
    state.exam = null;
    const card = $('resultSummaryCard');
    const percent = pct(attempt.score, attempt.total_points);
    let statusHtml;
    if (attempt.passed === null) {
      statusHtml = '<span class="result-pill pending">⏳ بانتظار التقييم</span>';
    } else if (attempt.passed === 1) {
      statusHtml = '<span class="result-pill pass">🎉 ناجح</span>';
    } else {
      statusHtml = '<span class="result-pill fail">❌ راسب</span>';
    }
    card.innerHTML = `
      <h2 class="review-title">نتيجة المحاولة</h2>
      ${statusHtml}
      <div class="result-stats-boxes">
        <div class="res-box">
          <span class="res-box-icon ${attempt.passed === 1 ? 'green' : 'blue'}">🎗️</span>
          <div class="res-box-content">
            <span class="res-label">درجتك</span>
            <span class="res-val">${attempt.score} من ${attempt.total_points}</span>
          </div>
        </div>
        <div class="res-box">
          <span class="res-box-icon blue">📊</span>
          <div class="res-box-content">
            <span class="res-label">النسبة المئوية</span>
            <span class="res-val">${percent}%</span>
          </div>
        </div>
      </div>
      <div class="review-notice-banner">${attempt.passed === 1 ? '💡 <strong>ممتاز!</strong> تم فتح الدرس التالي تلقائيًا.' : attempt.passed === 0 ? '💡 <strong>محتاج مراجعة:</strong> راجع الدرس وأعد المحاولة.' : '💡 سيتم تقييم الإجابة المقالية من المدرس خلال وقت قصير.'}</div>
      <div class="review-submission-date">📅 تم التسليم: ${fmtDate(attempt.submitted_at)}</div>`;
    showLevel('level-result');
  }

  // ---------- Results section ----------
  async function loadResults() {
    const list = $('attemptsList');
    try {
      const { items } = await api('/api/student/attempts');
      const inProgress = items.filter((a) => a.status === 'in_progress').length;
      const pending = items.filter((a) => a.status === 'submitted').length;
      const graded = items.filter((a) => a.status === 'graded').length;
      $('statTotal').textContent = items.length;
      $('statInProgress').textContent = inProgress;
      $('statPending').textContent = pending;
      $('statGraded').textContent = graded;

      if (!items.length) {
        list.innerHTML = '<p class="empty-state">لم تؤدِّ أي امتحان بعد.</p>';
        return;
      }
      list.innerHTML = items.map((a) => {
        const badge = a.status === 'in_progress' ? '<span class="status-badge badge-warning">قيد التنفيذ</span>'
          : a.status === 'submitted' ? '<span class="status-badge badge-blue">بانتظار التقييم</span>'
            : a.passed === 1 ? '<span class="status-badge badge-success">ناجح</span>'
              : '<span class="status-badge badge-danger">راسب</span>';
        return `
          <div class="exam-item-card" data-attempt="${a.id}">
            <div class="card-top-bar">${badge}</div>
            <h3 class="exam-item-title">${esc(a.exam_title)}</h3>
            <p class="exam-breadcrumb">${esc(a.course_name_ar)} · ${esc(a.lesson_name_ar)}</p>
            <div class="exam-meta-row">
              <span>⏱️ المدة: ${a.duration_minutes || '—'} دقيقة</span>
              <span>🕒 البدء: ${fmtDate(a.started_at)}</span>
              ${a.submitted_at ? `<span>🕒 التسليم: ${fmtDate(a.submitted_at)}</span>` : ''}
              ${a.total_points ? `<span class="score-highlight">الدرجة: ${a.score ?? '—'} / ${a.total_points} (${pct(a.score, a.total_points)}%)</span>` : ''}
            </div>
            ${a.status !== 'in_progress' ? `<div class="card-footer-action"><button class="btn btn-blue toggle-review-btn"><span class="btn-text">📄 عرض المراجعة</span><span class="arrow-icon">▼</span></button></div>
            <div class="review-slide-container"><div class="review-slide-content"><p class="empty-state">جاري التحميل...</p></div></div>` : ''}
          </div>`;
      }).join('');

      list.querySelectorAll('.toggle-review-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const card = btn.closest('.exam-item-card');
          const slide = card.querySelector('.review-slide-container');
          const expanded = card.classList.toggle('expanded');
          if (expanded) {
            btn.querySelector('.btn-text').textContent = '📄 إخفاء المراجعة';
            slide.style.maxHeight = slide.scrollHeight + 'px';
            slide.style.opacity = '1';
            if (!card.dataset.loaded) {
              try {
                const data = await api(`/api/student/attempts/${card.getAttribute('data-attempt')}`);
                slide.querySelector('.review-slide-content').innerHTML = buildReviewHtml(data);
                slide.style.maxHeight = slide.scrollHeight + 'px';
                card.dataset.loaded = '1';
              } catch (err) {
                slide.querySelector('.review-slide-content').innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
              }
            }
          } else {
            btn.querySelector('.btn-text').textContent = '📄 عرض المراجعة';
            slide.style.maxHeight = '0px';
            slide.style.opacity = '0';
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  function buildReviewHtml(data) {
    const a = data.attempt;
    const percent = pct(a.score, a.total_points);
    const pill = a.passed === null ? '<span class="result-pill pending">⏳ بانتظار التقييم</span>'
      : a.passed === 1 ? '<span class="result-pill pass">🎉 ناجح</span>'
        : '<span class="result-pill fail">❌ راسب</span>';
    const qs = data.questions.map((q, idx) => {
      const correct = q.is_correct === 1;
      const pending = q.scoring_method === null && q.question_type === 'essay';
      let body = '';
      if (q.question_type === 'essay') {
        body = `<p class="q-answer-text"><strong>إجابتك:</strong> ${esc(q.answer_text || '—')}</p>`;
        if (q.correct_answer) body += `<p class="q-answer-text correct"><strong>الإجابة النموذجية:</strong> ${esc(q.correct_answer)}</p>`;
        if (q.points_awarded !== null) body += `<p class="q-answer-text"><strong>الدرجة:</strong> ${q.points_awarded} / ${q.points}</p>`;
      } else {
        body = `<div class="q-choices">${(q.options || []).map((o) => {
          let cls = 'choice-item';
          if (o.is_correct) cls += ' correct';
          else if (o.is_selected) cls += ' wrong-user';
          return `<div class="${cls}">${esc(o.option_text)} ${o.is_correct ? '✓' : o.is_selected ? '✗' : ''}</div>`;
        }).join('')}</div>`;
      }
      const badge = pending ? '<span class="q-badge warning">بانتظار التقييم</span>'
        : correct ? '<span class="q-badge success">✓ صحيحة</span>'
          : q.is_correct === 0 ? '<span class="q-badge danger">✗ خاطئة</span>'
            : '<span class="q-badge">بدون درجة</span>';
      return `
        <div class="q-review-item ${correct ? 'correct-q' : pending ? '' : 'wrong-q'}">
          <div class="q-review-header">
            <span class="q-title">السؤال ${idx + 1} من ${data.questions.length}</span>
            ${badge}
          </div>
          <p class="q-text">${esc(q.question_text)}</p>
          ${body}
          ${q.explanation ? `<p class="q-explanation">💡 ${esc(q.explanation)}</p>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="review-summary-card">
        <h2 class="review-title">${esc(a.exam_title)}</h2>
        ${pill}
        <div class="result-stats-boxes">
          <div class="res-box"><span class="res-box-icon ${a.passed === 1 ? 'green' : 'blue'}">🎗️</span>
            <div class="res-box-content"><span class="res-label">درجتك</span><span class="res-val">${a.score ?? '—'} من ${a.total_points}</span></div></div>
          <div class="res-box"><span class="res-box-icon blue">📊</span>
            <div class="res-box-content"><span class="res-label">النسبة</span><span class="res-val">${percent}%</span></div></div>
        </div>
      </div>
      <div class="review-questions-section">
        <h3 class="section-heading">مراجعة الأسئلة</h3>
        <div class="questions-review-list">${qs}</div>
      </div>`;
  }

  // ---------- Notifications ----------
  async function loadNotifications() {
    const list = $('notificationsList');
    try {
      const { items, unread_count } = await api('/api/student/notifications');
      $('notifUnreadCount').textContent = `${unread_count} غير مقروء`;
      const badge = $('notifBadge');
      badge.hidden = unread_count === 0;
      badge.textContent = unread_count;
      if (!items.length) {
        list.innerHTML = '<p class="empty-state">لا توجد إشعارات.</p>';
        return;
      }
      list.innerHTML = items.map((n) => `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-read="${n.is_read}">
          <div class="notification-content">
            <h4>${n.is_read ? '' : '● '}${esc(n.title)}</h4>
            <p>${esc(n.body)}</p>
            <span class="notification-date">${fmtDate(n.created_at)}</span>
          </div>
        </div>`).join('');
      list.querySelectorAll('.notification-item').forEach((item) => {
        item.addEventListener('click', async () => {
          const id = item.getAttribute('data-id');
          if (item.getAttribute('data-read') !== '0') return;
          item.setAttribute('data-read', '1');
          item.classList.remove('unread');
          try { await api(`/api/student/notifications/${id}/read`, { method: 'POST' }); loadNotifications(); } catch (e) { }
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  // ---------- Profile ----------
  const GOVERNORATES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الشرقية', 'الدقهلية', 'البحيرة', 'المنوفية', 'الغربية', 'الفيوم', 'قنا', 'أسوان', 'أسيوط', 'سوهاج', 'بني سويف', 'المنيا', 'الإسماعيلية', 'السويس', 'بورسعيد', 'الأقصر', 'مطروح', 'البحر الأحمر', 'الوادي الجديد', 'شمال سيناء', 'جنوب سيناء'];

  async function loadProfile() {
    try {
      const data = await api('/api/student/profile');
      const p = data.profile || {};
      $('pfName').value = data.user.name || '';
      $('pfEmail').value = data.user.email || '';
      $('pfPhone').value = data.user.phone || '';
      $('pfStudentNumber').value = p.student_number || '';
      $('pfGuardianName').value = p.guardian_name || '';
      $('pfGuardianPhone').value = p.guardian_phone || '';
      $('pfBirthDate').value = p.birth_date || '';
      const gov = $('pfGovernorate');
      gov.innerHTML = '<option value="">اختر المحافظة...</option>' + GOVERNORATES.map((g) => `<option value="${g}">${g}</option>`).join('');
      gov.value = p.governorate || '';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function setFormMsg(id, text, type) {
    const el = $(id);
    el.textContent = text;
    el.className = 'form-msg ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
  }

  async function initApp() {
    try {
      const data = await api('/api/student/auth/me');
      if (!data.user) throw new Error('no session');

      // قاموس ترجمة المراحل
      const stagesMap = {
        'year1': 'الفرقة الأولى',
        'year2': 'الفرقة الثانية',
        'year3': 'الفرقة الثالثة',
        'year4': 'الفرقة الرابعة'
      };

      // جلب اسم الطالب والمرحلة
      const studentName = esc(data.user.name);
      const studentStage = stagesMap[data.user.stage] || 'مرحلة عامة';

      // وضع الاسم وتحته المرحلة بتصميم شيك في القائمة الجانبية
      $('sessionUserName').innerHTML = `
        ${studentName}
        <div style="font-size: 0.85rem; color: #D4AF37; margin-top: 5px; font-weight: 600;">
          📚 ${studentStage}
        </div>
      `;

    } catch (err) {
      window.location.href = '/login.html';
      return;
    }
    loadAvailableCourses();
    loadEnrolledCourses();
    loadNotifications();
    loadProfile();
    loadResults();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Sidebar / overlay / theme
    $('hamburgerBtn').addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('active'); });
    overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); closeActivationModal(); });
    $('themeToggle').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      $('themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
    });

    // SPA routing
    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        const target = item.getAttribute('data-section');
        showSection(target);
        if (target === 'enrolled') {
          showLevel('level-courses');
          loadEnrolledCourses();
        }
      });
    });

    // Catalog activation
    const termFilterSelect = $('termFilterSelect');
    if (termFilterSelect && !termFilterSelect.dataset.bound) {
      termFilterSelect.dataset.bound = '1';
      termFilterSelect.addEventListener('change', () => loadAvailableCourses());
    }
    ($('availableCoursesGrid') || $('availableSubjectsGrid')).addEventListener('click', (e) => {
      const btn = e.target.closest('.activate-btn');
      if (btn) openActivationModal({ id: Number(btn.getAttribute('data-id')), name: btn.getAttribute('data-name') });
    });
    $('closeModalBtn').addEventListener('click', closeActivationModal);
    $('confirmCodeBtn').addEventListener('click', confirmRedeem);
    $('activationCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmRedeem(); });

    // Drill-down navigation
    $('backToCoursesBtn').addEventListener('click', () => showLevel('level-courses'));
    $('backToLecturesBtn').addEventListener('click', () => {
      showLevel('level-lectures');
      if (state.currentCourseId) enterCourse(state.currentCourseId);
    });
    $('backFromResultBtn').addEventListener('click', () => {
      if (state.currentCourseId) enterCourse(state.currentCourseId);
      else showLevel('level-courses');
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        $(btn.getAttribute('data-tab'))?.classList.add('active');
      });
    });

    // Exam interface controls
    $('exitExamBtn').addEventListener('click', () => {
      clearInterval(state.exam?.timerInterval);
      state.exam = null;
      showLevel('level-tabs');
    });
    $('prevQBtn').addEventListener('click', () => {
      if (state.exam && state.exam.qIndex > 0) { state.exam.qIndex--; renderExamQuestion(); renderExamGrid(); }
    });
    $('nextQBtn').addEventListener('click', () => {
      if (state.exam && state.exam.qIndex < state.exam.questions.length - 1) {
        state.exam.qIndex++; renderExamQuestion(); renderExamGrid();
      }
    });
    $('submitExamBtn').addEventListener('click', () => submitExam(true));

    // Results / notifications refresh
    $('refreshNotifBtn').addEventListener('click', loadNotifications);

    // Logout
    $('logoutBtn').addEventListener('click', async () => {
      try { await api('/api/student/auth/logout', { method: 'POST' }); } catch (e) { }
      window.location.href = '/login.html';
    });

    // Profile data form
    $('profileDataForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('pfName').value.trim(),
        email: $('pfEmail').value.trim(),
        student_number: $('pfStudentNumber').value.trim(),
        guardian_name: $('pfGuardianName').value.trim(),
        guardian_phone: $('pfGuardianPhone').value.trim(),
        governorate: $('pfGovernorate').value,
        birth_date: $('pfBirthDate').value,
      };
      setFormMsg('profileDataMsg', '');
      try {
        const res = await api('/api/student/profile', { method: 'PATCH', body });
        $('sessionUserName').textContent = res.user.name;
        setFormMsg('profileDataMsg', 'تم حفظ التعديلات بنجاح', 'success');
      } catch (err) {
        setFormMsg('profileDataMsg', err.message, 'error');
      }
    });

    // Change password form
    $('profilePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        current_password: $('currPass').value,
        new_password: $('newPass').value,
        confirm_new_password: $('confirmPass').value,
      };
      if (!body.current_password || !body.new_password || !body.confirm_new_password) {
        setFormMsg('profilePassMsg', 'أكمل حقول كلمة المرور الثلاثة', 'error');
        return;
      }
      setFormMsg('profilePassMsg', '');
      try {
        await api('/api/student/auth/change-password', { method: 'POST', body });
        setFormMsg('profilePassMsg', 'تم تغيير كلمة المرور بنجاح', 'success');
        $('currPass').value = ''; $('newPass').value = ''; $('confirmPass').value = '';
      } catch (err) {
        setFormMsg('profilePassMsg', err.message, 'error');
      }
    });

    initApp();
  });
})();

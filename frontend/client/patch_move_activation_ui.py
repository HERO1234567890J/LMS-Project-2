#!/usr/bin/env python3
"""
شغّل السكريبت ده من جوه /opt/lms-project/frontend/client:
    python3 patch_move_activation_ui.py

بيعمل حاجتين:
1) بيشيل زرار "تفعيل بالكود" من كارت الكورس في صفحة "الكورسات المتاحة"
   (كارت الكورس هيبقى عرض عادي بس: صورة + اسم + سعر).
2) في صفحة الكورس نفسه (قائمة الدروس/المواد)، بيوصّل زرار "شراء" اللي
   على المادة المقفولة بنفس مودال "أدخل كود التفعيل" اللي كان مربوط
   بكارت الكتالوج، بدل ما يفضل مجرد toast معطّل.

آمن: بيوقف من غير أي تعديل لو أي جزء من النص المتوقع مش موجود بالظبط.
"""
import sys

PATH = "script.js"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "lecture-activate-btn" in content:
    print("SKIPPED: already patched")
    sys.exit(0)

# ---------- 1) شيل زرار التفعيل من كارت الكتالوج ----------
OLD_CATALOG_CARD = """          <div class="course-price">${c.price} جنيه <span class="course-lessons">${c.lessons_count} درس</span></div>
          <button class="btn btn-primary activate-btn" data-id="${c.id}" data-name="${esc(c.name_ar)}">تفعيل بالكود</button>
        </div>`).join('');"""

NEW_CATALOG_CARD = """          <div class="course-price">${c.price} جنيه <span class="course-lessons">${c.lessons_count} درس</span></div>
        </div>`).join('');"""

if OLD_CATALOG_CARD not in content:
    print("ERROR step1: catalog card block not found verbatim. No changes made.")
    sys.exit(1)

# ---------- 2) وصّل زرار "شراء" جوه صفحة الدرس بمودال كود التفعيل ----------
OLD_LOCKED_BUTTON = """          <button class="btn btn-sm btn-success" onclick="buyLecture(${l.id}, ${price}, '${esc(l.name_ar)}')" style="margin: 0; padding: 5px 15px;">
            شراء بـ ${price} ج.م
          </button>
        </div>`;"""

NEW_LOCKED_BUTTON = """          <button class="btn btn-sm btn-success lecture-activate-btn" style="margin: 0; padding: 5px 15px;">
            تفعيل بالكود
          </button>
        </div>`;"""

if OLD_LOCKED_BUTTON not in content:
    print("ERROR step2: locked lesson button block not found verbatim. No changes made.")
    sys.exit(1)

OLD_LISTENER_TAIL = """  container.querySelectorAll('.lecture-card.unlocked').forEach((card, idx) => {
    card.addEventListener('click', () => {
      if (typeof enterLesson === 'function') {
        enterLesson(lessons[idx].id);
      }
    });
  });
}"""

NEW_LISTENER_TAIL = """  container.querySelectorAll('.lecture-card.unlocked').forEach((card, idx) => {
    card.addEventListener('click', () => {
      if (typeof enterLesson === 'function') {
        enterLesson(lessons[idx].id);
      }
    });
  });

  container.querySelectorAll('.lecture-activate-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openActivationModal({ id: state.currentCourseId, name: state.currentCourseName });
    });
  });
}"""

if OLD_LISTENER_TAIL not in content:
    print("ERROR step3: unlocked-card listener block not found verbatim. No changes made.")
    sys.exit(1)

content = content.replace(OLD_CATALOG_CARD, NEW_CATALOG_CARD, 1)
content = content.replace(OLD_LOCKED_BUTTON, NEW_LOCKED_BUTTON, 1)
content = content.replace(OLD_LISTENER_TAIL, NEW_LISTENER_TAIL, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: activation UI moved from catalog card into the course lesson list")

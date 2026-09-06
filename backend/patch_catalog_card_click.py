#!/usr/bin/env python3
"""
شغّل السكريبت ده من جوه /opt/lms-project/frontend/client:
    python3 patch_catalog_card_click.py

بيعمل حاجتين في كارت الكورس بصفحة "الكورسات المتاحة":
1) بيشيل عرض السعر خالص (بيسيب بس عدد الدروس).
2) بيخلي الكارت كله قابل للضغط وبيدخل مباشرة لصفحة الكورس (enterCourse)
   بدل ما كان يعتمد على زرار تفعيل بالكود (اللي اتشال قبل كده).

آمن: بيوقف من غير أي تعديل لو أي جزء من النص المتوقع مش موجود بالظبط.
"""
import sys

PATH = "script.js"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if 'class="course-card" data-id=' in content:
    print("SKIPPED: already patched")
    sys.exit(0)

# ---------- 1) افتح تاج الكارت بـ data-id + شيل السعر ----------
OLD_CARD_OPEN = """        <div class="course-card">
          ${c.badge === 'featured' ? '<div class="course-badge">مميز</div>' : ''}"""

NEW_CARD_OPEN = """        <div class="course-card" data-id="${c.id}" style="cursor:pointer;">
          ${c.badge === 'featured' ? '<div class="course-badge">مميز</div>' : ''}"""

if OLD_CARD_OPEN not in content:
    print("ERROR step1: course-card opening block not found verbatim. No changes made.")
    sys.exit(1)

OLD_PRICE_LINE = """          <div class="course-price">${c.price} جنيه <span class="course-lessons">${c.lessons_count} درس</span></div>
        </div>`).join('');"""

NEW_PRICE_LINE = """          <div class="course-price"><span class="course-lessons">${c.lessons_count} درس</span></div>
        </div>`).join('');"""

if OLD_PRICE_LINE not in content:
    print("ERROR step2: course-price line not found verbatim. No changes made.")
    sys.exit(1)

# ---------- 2) الكارت كله يدخل الكورس بدل زرار activate-btn القديم ----------
OLD_CLICK_HANDLER = """    ($('availableCoursesGrid') || $('availableSubjectsGrid')).addEventListener('click', (e) => {
      const btn = e.target.closest('.activate-btn');
      if (btn) openActivationModal({ id: Number(btn.getAttribute('data-id')), name: btn.getAttribute('data-name') });
    });"""

NEW_CLICK_HANDLER = """    ($('availableCoursesGrid') || $('availableSubjectsGrid')).addEventListener('click', (e) => {
      const card = e.target.closest('.course-card');
      if (card) enterCourse(Number(card.getAttribute('data-id')));
    });"""

if OLD_CLICK_HANDLER not in content:
    print("ERROR step3: catalog click handler not found verbatim. No changes made.")
    sys.exit(1)

content = content.replace(OLD_CARD_OPEN, NEW_CARD_OPEN, 1)
content = content.replace(OLD_PRICE_LINE, NEW_PRICE_LINE, 1)
content = content.replace(OLD_CLICK_HANDLER, NEW_CLICK_HANDLER, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: catalog card price removed and card is now clickable into the course")

#!/usr/bin/env python3
"""
شغّل السكريبت ده من جوه /opt/lms-project/frontend/admin:
    python3 patch_hide_admin_price.py

بيشيل عرض "السعر: X ج" من كارت الكورس في داشبورد الأدمن (بيسيب
المرحلة والترم زي ما هما). مبيلمسش c.price في onclick="openEditCourse(...)"
لإنها لسه لازمة لوظيفة التعديل الداخلية، مش للعرض بس.

آمن: بيوقف من غير أي تعديل لو النص المتوقع مش موجود بالظبط.
"""
import sys

PATH = "teacher-script.js"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

OLD_LINE = """        <p style="font-size:0.9rem; color:#555;">المرحلة: <strong>${stageLabel}</strong> | الترم: <strong>${c.term_name_ar || '-'}</strong> | السعر: <strong>${c.price} ج</strong></p>"""

NEW_LINE = """        <p style="font-size:0.9rem; color:#555;">المرحلة: <strong>${stageLabel}</strong> | الترم: <strong>${c.term_name_ar || '-'}</strong></p>"""

if NEW_LINE in content and OLD_LINE not in content:
    print("SKIPPED: already patched")
    sys.exit(0)

if OLD_LINE not in content:
    print("ERROR: expected line not found verbatim. No changes made.")
    sys.exit(1)

content = content.replace(OLD_LINE, NEW_LINE, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: price display removed from admin course card")

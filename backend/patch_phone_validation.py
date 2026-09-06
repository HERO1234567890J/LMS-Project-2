#!/usr/bin/env python3
"""
شغّل السكريبت ده من جوه /opt/lms-project/backend:
    python3 patch_phone_validation.py

بيضيف تحقق على رقم الموبايل في POST /api/auth/register:
- لازم يكون 11 رقم بالظبط
- لازم يبدأ بـ 01

آمن: بيوقف من غير أي تعديل لو النص المتوقع مش موجود بالظبط، أو لو
التحقق ده مضاف بالفعل.
"""
import sys

PATH = "src/server.js"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "رقم الموبايل يجب أن يتكون من 11 رقم" in content:
    print("SKIPPED: phone validation already present")
    sys.exit(0)

OLD_BLOCK = """    if (!body.name || !body.phone || !body.password) return res.status(400).json({ message: 'Name, phone, and password are required' });
    if (body.password !== (body.password_confirmation || body.password)) return res.status(400).json({ message: 'Password confirmation does not match' });"""

NEW_BLOCK = """    if (!body.name || !body.phone || !body.password) return res.status(400).json({ message: 'Name, phone, and password are required' });
    if (!/^01\\d{9}$/.test(String(body.phone).trim())) return res.status(400).json({ message: 'رقم الموبايل يجب أن يتكون من 11 رقم ويبدأ بـ 01' });
    if (body.password !== (body.password_confirmation || body.password)) return res.status(400).json({ message: 'Password confirmation does not match' });"""

if OLD_BLOCK not in content:
    print("ERROR: expected old block not found verbatim. No changes made.")
    print("This usually means the register route differs from what this script expects.")
    sys.exit(1)

content = content.replace(OLD_BLOCK, NEW_BLOCK, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: phone validation added to /api/auth/register")

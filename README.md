# Law LMS

نظام إدارة تعلم عربي لطلاب كلية الحقوق، يحتوي على بوابة للطالب ولوحة إدارة للمسؤول.

## التقنيات

| الجزء          | التقنية                                                    |
| -------------- | ---------------------------------------------------------- |
| Backend        | Node.js 20+ وExpress 4                                     |
| Database       | PostgreSQL عبر مكتبة `pg` وSQL مباشر بدون ORM              |
| Authentication | `express-session` مع تخزين الجلسات عبر `connect-pg-simple` |
| Passwords      | `bcryptjs`                                                 |
| Frontend       | HTML وCSS وJavaScript بدون React أو Vite أو build step     |
| Uploads        | `multer`، مع تخزين محلي اختياري أو Bunny Stream للفيديو    |
| Security       | `helmet` و`express-rate-limit` والتحقق من محتوى الملفات    |

لا يستخدم المشروع NestJS أو Prisma أو JWT أو SQLite أو Docker Compose.

## هيكل المشروع

```text
.
├── backend/
│   ├── src/
│   │   ├── server.js       # تطبيق Express وكل المسارات
│   │   ├── db.js           # اتصال PostgreSQL وquery/transaction helpers
│   │   └── schema.js       # تعريف الجداول وبيانات levels/terms الأولية
│   ├── scripts/
│   │   ├── migrate.js      # إنشاء schema في PostgreSQL
│   │   ├── seed.js         # إنشاء حساب المسؤول
│   │   └── check.js        # فحص تحميل التطبيق
│   ├── package.json
│   └── uploads/            # ملفات مرفوعة محليًا، ومجلدها مستثنى من Git
├── frontend/
│   ├── login.html
│   ├── admin/              # لوحة المسؤول
│   └── client/             # بوابة الطالب
├── docs/
├── legacy/                 # نسخة مرجعية قديمة من الواجهة
├── SCHEMA.md
├── ANALYSIS.md
└── SECURITY_REVIEW.md
```

## التشغيل المحلي

المتطلبات: Node.js 20+ وPostgreSQL.

1. أنشئ قاعدة PostgreSQL، مثلًا باسم `law_lms`.
2. من مجلد `backend` انسخ `.env.example` إلى `.env` واضبط `DATABASE_URL` و`SESSION_SECRET`.
3. نفّذ الأوامر التالية:

```bash
cd backend
npm install
npm run migrate
npm run seed
npm start
```

بعد التشغيل افتح `http://localhost:3000`، أو المنفذ الموجود في المتغير `PORT`.

`npm run migrate` ينفذ schema الموجود في `backend/src/schema.js`، ولا توجد migrations منفصلة أو Prisma schema.

## أهم أوامر Backend

| الأمر             | الوظيفة                                  |
| ----------------- | ---------------------------------------- |
| `npm start`       | تشغيل الخادم                             |
| `npm run migrate` | إنشاء أو تحديث الجداول المعرفة في schema |
| `npm run seed`    | إنشاء حساب المسؤول                       |
| `npm run check`   | فحص تحميل التطبيق                        |

## API

- `POST /api/auth/login` و`POST /api/auth/register`: الدخول وتسجيل الطلاب.
- `GET /api/auth/me`: بيانات الجلسة الحالية.
- `/api/teacher/*`: مسارات المسؤول لإدارة المواد والمحاضرات والامتحانات والطلاب والأكواد.
- `/api/student/*`: مسارات الطالب للمواد والاشتراكات والدروس والامتحانات والملف الشخصي.
- `GET /api/health`: فحص حالة الخادم.

المسارات لا تستخدم `/api/v2`، والمصادقة تعتمد على جلسات الخادم وليس access/refresh tokens.

## قاعدة البيانات

الهيكل التعليمي هو:

`levels` -> `terms` -> `subjects` -> `lectures` -> `lecture_files`

وتشمل الجداول أيضًا المستخدمين والطلاب وأكواد التفعيل والاشتراكات والامتحانات والتقدم والإشعارات. التفاصيل موجودة في [SCHEMA.md](SCHEMA.md).

## ملفات التوثيق

- [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md): إعداد التشغيل المحلي.
- [docs/API.md](docs/API.md): تفاصيل المسارات.
- [docs/DEPLOYMENT_OPERATIONS.md](docs/DEPLOYMENT_OPERATIONS.md): قائمة تشغيل الإنتاج.
- [SCHEMA.md](SCHEMA.md): تصميم PostgreSQL الحالي.
- [SECURITY_REVIEW.md](SECURITY_REVIEW.md): المراجعة الأمنية.
- [ANALYSIS.md](ANALYSIS.md): تحليل المشروع.

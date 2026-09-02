# DEPLOYMENT.md — دليل النشر خطوة بخطوة

> **لمن هذا الدليل؟** أي شخص يستلم نسخة من المشروع (ZIP أو مستودع Git) ويريد تثبيته وتشغيله على جهازه، ثم نقله إلى دومين حقيقي للنشر.
>
> **المتطلبات الأساسية على الجهاز:**
> - **Node.js 20+** (`node -v` للتأكد)
> - **npm 10+** (يأتي مع Node 20)
> - **Git** (لو هتستلم عبر `git clone`)
>
> **نظام التشغيل:** كل التعليمات أعلاه تعمل على Linux/macOS/Windows (PowerShell). سنعرض أوامر bash، يمكنك ترجمتها لـ PowerShell بسهولة.

---

## 1) تنزيل المشروع

### لو هتستلم عبر Git

```bash
git clone <your-repo-url> lms-project
cd lms-project
```

### لو هتستلم ZIP

1. فك الضغط في مجلد `lms-project/`.
2. ادخل المجلد: `cd lms-project`.

### بنية المجلد المتوقعة

```
lms-project/
├── .gitignore           ← يستثني node_modules وغيرها
├── .env.example         ← مرجع متغيرات البيئة (لا تضع فيه قيماً حقيقية)
├── ANALYSIS.md          ← التوثيق الشامل (كل المراحل)
├── SCHEMA.md            ← تصميم قاعدة البيانات
├── SECURITY_REVIEW.md   ← المراجعة الأمنية + قائمة التحقق قبل النشر
├── DEPLOYMENT.md        ← هذا الملف
├── backend/             ← كود الخادم (Node/Express)
└── frontend/            ← الصفحات (HTML/CSS/JS نقي)
```

---

## 2) تثبيت الاعتماديات

```bash
cd backend
npm install
```

**ملاحظات:**
- على Linux/macOS: الأمر العادي `npm install` يعمل مباشرة.
- على Windows مع WSL2 (مسار `/mnt/c/...`): قد تحتاج `--no-bin-links` لتجاوز مشكلة صلاحيات drvfs:
  ```bash
  npm install --no-bin-links
  ```
- **`better-sqlite3`** تحتاج Python + أدوات بناء على Linux. لو فشل التجميع، ثبّت:
  ```bash
  # Debian/Ubuntu
  sudo apt install python3 build-essential
  # macOS
  xcode-select --install
  ```

**تحقق:** يجب أن يُنشأ `backend/node_modules/` بحجم ~50 ميجابايت.

---

## 3) إعداد متغيرات البيئة

التطبيق **لا يقرأ `.env` تلقائيًا** (لا توجد dotenv). اختر طريقة واحدة من الطرق أدناه:

### 3.1 الطريقة الأسهل (تطوير محلي)

```bash
# من داخل مجلد backend/
export NODE_ENV=production
export SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64"))')"
export PORT=8000
export SITE_URL=https://your-domain.com
export PUBLIC_BASE_URL=https://your-domain.com
export PUBLISH_SCHEDULER_INTERVAL_MS=60000
```

### 3.2 مع systemd (الأفضل لـ VPS بإنتاج حقيقي)

أنشئ ملف `/etc/lms-project.env`:

```bash
sudo tee /etc/lms-project.env > /dev/null <<EOF
NODE_ENV=production
SESSION_SECRET=<ضع-قاعدة64-طويلة-هنا>
PORT=8000
SITE_URL=https://your-domain.com
PUBLIC_BASE_URL=https://your-domain.com
PUBLISH_SCHEDULER_INTERVAL_MS=60000
EOF
sudo chmod 600 /etc/lms-project.env   # مهم: لا يقرأه غير root
```

أنشئ وحدة systemd `/etc/systemd/system/lms-project.service`:

```ini
[Unit]
Description=LMS Project Backend
After=network.target

[Service]
Type=simple
User=lms
Group=lms
WorkingDirectory=/opt/lms-project/backend
EnvironmentFile=/etc/lms-project.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

ثم:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lms-project
sudo systemctl status lms-project     # يجب أن يكون active
```

### 3.3 مع Docker (إن أردت)

سيكون مرجعًا مفيدًا، لكن المشروع **لا يأتي مع `Dockerfile` افتراضيًا**. يمكنك إنشاء واحد بسيط في `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 8000
CMD ["node", "src/server.js"]
```

ثم يدويًا: `docker build -t lms-backend ./backend && docker run -d --restart=unless-stopped --env-file=/etc/lms-project.env -p 8000:8000 -v lms-data:/app/data -v lms-uploads:/app/uploads --name lms lms-backend`.

---

## 4) تشغيل قاعدة البيانات

### لا حاجة لأي شيء!

- SQLite تنشأ تلقائيًا في `backend/data/lms.db` عند أول تشغيل.
- الـ schema تُطبَّق تلقائيًا عبر نظام migrations في `backend/src/config/migrations.js`.
- الحساب الافتراضي للأدمن يُنشأ تلقائيًا عند أول إقلاع (لأول مرة فقط، لو الجدول فارغ):
  - **الموبايل**: `+201060021497`
  - **كلمة المرور**: `admin123` ← **يجب تغييرها فورًا** (انظر §6).

### تشغيل السيرفر (تجربة محلية)

```bash
cd backend
npm start
```

افتح `http://localhost:8000` في المتصفح. يجب أن تشاهد الصفحة الرئيسية.

### فحص الصحة

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

---

## 5) تغيير القيم الافتراضية غير الآمنة (إلزامي قبل النشر)

### 5.1 `SESSION_SECRET` (الأهم)

```bash
# ولّد قيمة قوية:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

- ضعها في `SESSION_SECRET` (الخطوة 3).
- افتراضيًا للتطوير فقط: `dev-secret-change-me`. **لا تستخدمه في النشر.**
- التطبيق **يرفض البدء** في الإنتاج (`NODE_ENV=production`) بدون SESSION_SECRET — هذا من إصلاحات المرحلة 11.

### 5.2 كلمة مرور حساب المدرس (`admin123`)

**قبل** فتح الموقع للجمهور:

1. ادخل على لوحة المدرس: `https://your-domain.com/login-teacher.html` بحساب `+201060021497` / `admin123`.
2. افتح **الإعدادات** (في السايدبار) → **تغيير كلمة المرور**.
3. اختر كلمة مرور قوية (≥ 12 حرف، حروف وأرقام ورموز).

أو حدّث DB مباشرة:
```bash
cd backend
node -e "
const bcrypt = require('bcryptjs');
const db = require('better-sqlite3')('data/lms.db');
const newPassword = 'YOUR-NEW-STRONG-PASSWORD';
const hash = bcrypt.hashSync(newPassword, 10);
db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(hash);
console.log('Updated admin password.');
"
```

### 5.3 ملف `.env` نفسه

- **لا ترفع `.env` على Git.** الملف مُستثنى تلقائيًا عبر `.gitignore`.
- مرّر القيم بطرق آمنة: SSH فقط، أو systemd `EnvironmentFile=` بصلاحيات `600`، أو secrets manager في CI/CD.

### 5.4 التحقق من الإعدادات

```bash
# SESSION_SECRET مُعرَّف؟
grep -q "^SESSION_SECRET=.\+" /etc/lms-project.env && echo OK

# كلمة مرور الأدمن تغيّرت؟ (يجب أن تكون مختلفة عن admin123)
# يمكنك التحقق من خلال محاولة تسجيل دخول بفشل بكلمة admin123.
```

---

## 6) النشر على دومين حقيقي (كرأي عام)

### 6.1 افترض: domain = `lms.example.com`، VPS = `Ubuntu 22.04`

#### أ) أشر الـ DNS

أنشئ سجل `A` لـ `lms.example.com` يشير إلى IP السيرفر. (اطلب من مزوّد الدومين.)

#### ب) ثبّت Nginx + Certbot (HTTPS مجاني)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

#### ج) أنشئ إعداد Nginx

`/etc/nginx/sites-available/lms-project`:

```nginx
server {
    listen 80;
    server_name lms.example.com;

    # Certbot سيُضيف 443 + SSL تلقائيًا بعد certbot --nginx
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # رفع ملفات كبيرة (الفيديوهات/المرفقات)
    client_max_body_size 200m;
}
```

فعّله:
```bash
sudo ln -s /etc/nginx/sites-available/lms-project /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### د) فعّل HTTPS

```bash
sudo certbot --nginx -d lms.example.com
```

Certbot يضيف `server { listen 443 ssl ... }` تلقائيًا + يجدد الشهادة.

#### هـ) اضبط التطبيق

```bash
# في /etc/lms-project.env
NODE_ENV=production
SESSION_SECRET=<قوة>
SITE_URL=https://lms.example.com
PUBLIC_BASE_URL=https://lms.example.com
```

أعد تشغيل:
```bash
sudo systemctl restart lms-project
```

#### و) (اختياري) ثقة في البروكسي لـ rate limiting

في `backend/src/app.js` السطر قبل (`app.use(express.json())`):

```js
if (IS_PROD) app.set('trust proxy', 1);
```

غير ضروري إن كان Nginx مباشرة (127.0.0.1) — `trust proxy` مفيد فقط لو وُجد CDN أو LB أمام Nginx.

### 6.2 تحقّق بعد النشر

```bash
# يجب أن يستجيب 200 بـ security headers
curl -I https://lms.example.com/health

# المتوقع:
#   X-Content-Type-Options: nosniff
#   Referrer-Policy: strict-origin-when-cross-origin
#   X-Frame-Options: SAMEORIGIN
#   Strict-Transport-Security: max-age=31536000; includeSubDomains
#   (وعدم وجود X-Powered-By)
```

---

## 7) أهم نقاط من `SECURITY_REVIEW.md` قبل الفتح للجمهور

| # | البند | الحالة |
|---|---|---|
| 1 | `SESSION_SECRET` قوي (≥ 32 حرف قاعدة64) | ⚠️ **افعلها** |
| 2 | `NODE_ENV=production` | ⚠️ **افعلها** |
| 3 | HTTPS مُفعّل + شهادة سارية | ⚠️ **افعلها** |
| 4 | كلمة مرور الأدمن تغيّرت (`admin123` ❌) | ⚠️ **افعلها** |
| 5 | `npm audit` — 0 ثغرات | ✅ مُحقَّق |
| 6 | Headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS) | ✅ مفعّل تلقائيًا |
| 7 | رفع الملفات: magic bytes + امتداد مُشتقّ من المحتوى (لا Content-Type confusion) | ✅ مُحقَّق |
| 8 | Rate limiting على login/register/forgot/reset/redeem/search | ✅ مفعّل |
| 9 | جميع روابط المعلم محمية بـ `requireRole('admin')` | ✅ مُحقَّق |
| 10 | محاولة اختراق حقيقية (IDOR + عزل أدوار + XSS) | ✅ 23/23 مرّت |
| 11 | النسخ الاحتياطي التلقائي لـ `data/lms.db` | 📝 **افعلها** (cron dayly) |
| 12 | مراقبة السجلات (`[security]`, `[error]`, `[fatal]`) | 📝 **افعلها** (logwatch/loki) |

### 🔴 قبل أي رابط دعوة يُرسل لطلاب حقيقيين

- [ ] غيّرت كلمة مرور حساب المدير (admin)؟
- [ ] أنشأت كورسات حقيقية (محتوى الصفحات الثابتة الأمامية في `index.html` يحتوي على كروت hardcoded للنحو/البلاغة/الأدب/المراجعة — راجع `frontend/index.html` لستبدالها أو اتركها كـ marketing).
- [ ] ضبطت `SITE_URL` للدومين الجديد (يؤثر على canonical/OG)؟
- [ ] جرّبت `/sitemap.xml` و `/robots.txt` على الدومين؟
- [ ] جرّبت نشر درس مجدول (`publish_at` قبل `now`)؟

### النسخ الاحتياطي (ضروري)

أضف cron يوميًا:

```bash
sudo crontab -e
# أضف:
0 3 * * * cd /opt/lms-project/backend && sqlite3 data/lms.db ".backup /var/backups/lms-$(date +\%Y\%m\%d).db" && find /var/backups -name 'lms-*.db' -mtime +7 -delete
```

**لا تستخدم `cp` على `lms.db` بينما السيرفر شغال** — استخدم `.backup` (يعمل نسخ آمن حتى مع WAL).

---

## 8) بيانات الدخول التجريبية (للاستخدام في الفحص فقط)

> ⚠️ **تحذير: غيّر كل كلمات المرور أدناه قبل الاستخدام الفعلي.**

### حساب المدرس (admin)

| الحقل | القيمة |
|---|---|
| الاسم | مدير المنصة |
| الموبايل | `+201000000000` |
| كلمة المرور | `admin123` |
| صفحة الدخول | `https://your-domain.com/login-teacher.html` |
| لوحة التحكم | `https://your-domain.com/admin/` |

### حساب طالب 1

| الحقل | القيمة |
|---|---|
| الاسم | أحمد محمد |
| الموبايل | `+201012345678` |
| كلمة المرور | `student123` |
| صفحة الدخول | `https://your-domain.com/login.html` |
| بوابة الطالب | `https://your-domain.com/client/` |

### حساب طالب 2

| الحقل | القيمة |
|---|---|
| الاسم | محمود عبد |
| الموبايل | `+201011112222` |
| كلمة المرور | `student123` |
| صفحة الدخول | `https://your-domain.com/login.html` |
| بوابة الطالب | `https://your-domain.com/client/` |

### سيناريوهات سريعة للتجربة

1. **كمدرس (admin)**: ادخل → أضف فئة → مرحلة → مادة → شهر → كورس → درس → ارفع غلاف → أنشئ امتحان → اعتمده.
2. **كرمز تفعيل**: في الكورس، أنشئ دفعة من 5 أكواد. انسخ كود منها.
3. **كطالب (من الـ login)**: استبدل الكود → ادخل الكورس → جرّب امتحان.
4. **صفحة كورس عامة (SEO)**: افتح `/course/1` بدون تسجيل دخول — يجب أن تشاهد meta tags نظيفة + رابط canonical.

### ملاحظات

- لا توجد بيانات محتوى تجريبية محفوظة في DB (الجداول فارغة بعد التنظيف النهائي). أنشئ كل شيء من الصفر.
- جميع رسائل الخطأ بالعربية (لا تكشف schema أو stack).
- جلسات الأفراد مرتبطة بالجهاز: جهاز جديد يُعلِّم الجلسات القديمة `suspicious` تلقائيًا.

---

## 9) استكشاف الأخطاء

| المشكلة | السبب | الحل |
|---|---|---|
| `Error: Cannot find module 'better-sqlite3'` | `npm install` فشل في بناء الـ native addon | ثبّت `python3` + `build-essential` وأعد التشغيل |
| `EPERM: operation not permitted, chmod` على Windows + WSL | drvfs filesystem لا يسمح بـ chmod | `npm install --no-bin-links` |
| `SESSION_SECRET is required in production` | نسيت ضبط `SESSION_SECRET` في الـ env | ولّد قيمة وصدّرها (الخطوة 5.1) |
| الكوكيز لا تعمل خلف HTTPS | `cookie.secure` يحتاج HTTPS | تأكد `NODE_ENV=production` و HTTPS مُفعّل |
| `/health` يعمل لكن `/api/teacher/*` يرجع 401 | لا توجد جلسة | اعمل login عبر `/admin/` أو API |
| `404` على `/course/1` | الكورس غير منشور (`status='draft'`) | غيّر الحالة من لوحة المدرس |
| `sitemap.xml` يظهر كورسات قديمة | متوقع — يتم تحديثه مع كل request | لا تحتجب |

---

## 10) المراجع

| تريد أن تفهم... | افتح |
|---|---|
| ما الذي بُني في كل مرحلة | `ANALYSIS.md` |
| تصميم قاعدة البيانات | `SCHEMA.md` |
| ما الذي رُوجع أمنيًا وما يجب الانتباه له | `SECURITY_REVIEW.md` |
| كيفية إعداد متغيرات البيئة | `.env.example` |
| مرجع النشر الكامل | `DEPLOYMENT.md` (هذا الملف) |

---

## 11) بعد النشر

- راقب السجلات: `sudo journalctl -u lms-project -f` (لو systemd) أو `tail -f /var/log/lms-project.log`.
- اعمل `npm audit` شهريًا: `cd backend && npm audit`.
- إذا غيّرت `SESSION_SECRET`، كل الجلسات تُلغى (يطلب المستخدمون تسجيل دخول جديد — لا بأس).
- للتحديث لنسخة جديدة: `git pull` ثم `sudo systemctl restart lms-project`. الـ migrations تُطبَّق تلقائيًا.

**بالتوفيق! 🚀** لو ظهرت مشكلة غير موثّقة، اكتبها في `SECURITY_REVIEW.md` §7.2 (Follow-ups).

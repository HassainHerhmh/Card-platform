# Card Platform API

باك اند Node.js لمنصة الكروت مع MySQL.

## التشغيل المحلي

```bash
cd backend
cp .env.example .env
# عدّل DATABASE_URL لقاعدة MySQL المحلية
npm install
npm run dev
```

السيرفر يعمل على: `http://localhost:3001`  
عند أول تشغيل: يُنشئ الجداول تلقائياً ويُدخل بيانات أولية (admin / 123456).

## النشر على Railway

1. أضف خدمة **MySQL** في نفس المشروع.
2. في خدمة الباك اند → **Variables** → **Add Variable Reference** → اختر `MYSQL_URL` من MySQL وسَمّه `DATABASE_URL` (أو اربط `MYSQL_URL` مباشرة).
3. أضف المتغيرات:
   - `NODE_ENV=production`
   - `JWT_SECRET` = سلسلة عشوائية طويلة
   - `CLIENT_URL=http://localhost:5173` (أضف رابط الفرونت اند لاحقاً عند النشر)
4. ادفع التغييرات إلى GitHub — Railway يعيد النشر تلقائياً.
5. تحقق: `GET /api/health` يجب أن يُرجع `"database": true` و `"dbConnected": true`.

## المسارات

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/api/health` | فحص السيرفر وقاعدة البيانات |
| POST | `/api/auth/login` | تسجيل الدخول |
| GET/POST/PUT/DELETE | `/api/users` | المستخدمين |
| GET/PUT | `/api/settings` | إعدادات الكود |
| GET/POST/PUT/DELETE | `/api/settings/categories` | فئات الكروت |
| GET/POST | `/api/agents` | الوكلاء |
| GET/POST | `/api/cards/batches` | دفعات الكروت |
| GET | `/api/ledger` | دفتر الحسابات |
| GET | `/api/reports/sales`, `/dashboard` | التقارير |
| GET/PUT | `/api/permissions/:userId` | صلاحيات المستخدم |
| GET | `/api/mikrotik/routers`, `/status` | ميكروتك |

## ربط MikroTik بأمان

### القاعدة الذهبية
**لا تضع بيانات الميكروتك في الفرونت اند أبداً.**

| مكان التخزين | ماذا يُخزَّن |
|--------------|-------------|
| Frontend | واجهة فقط: اختيار فئة، عدد كروت، زر طباعة |
| Backend `.env` أو قاعدة بيانات مشفرة | IP الراوتر، منفذ API، اسم المستخدم، كلمة المرور |
| MikroTik Firewall | السماح لـ API فقط من IP السيرفر |

### ماذا تحتاجون لتنفيذ الربط؟

1. **تفعيل API على MikroTik**
   - IP → Services → api (منفذ 8728) أو api-ssl (8729)
   - إنشاء مستخدم API بصلاحيات محدودة (ليس admin كامل)

2. **الباك اند يتصل بالراوتر**
   - مكتبة مثل `node-routeros` أو REST API
   - إنشاء مستخدمي hotspot: `/ip/hotspot/user/add`
   - ربط profile حسب فئة الكرت (يومي / أسبوعي / شهري)

3. **الفرونت اند يطلب من الباك اند فقط**
   ```
   POST /api/cards/batches — ينشئ الدفعة ويرفع الكروت على MikroTik حسب بروفايل الفئة
   Authorization: Bearer <token>
   { "category": "يومي", "count": 50 }
   ```

4. **حماية إضافية**
   - JWT لكل طلب
   - صلاحيات مستخدمين (من صفحة صلاحية المستخدمين)
   - تقييد IP السيرفر على جدار MikroTik
   - HTTPS في الإنتاج
   - عدم رفع ملف `.env` إلى GitHub

### لماذا لا من المنصة مباشرة؟

لو حطيت IP وكلمة مرور الميكروتك في React:
- أي شخص يفتح DevTools يشوفها
- تتسرب في الكود المبني (build)
- ما فيه تحكم بالصلاحيات

لذلك: **الإعداد والاتصال من الباك اند فقط**، والمنصة تعرض وترسل أوامر عامة.

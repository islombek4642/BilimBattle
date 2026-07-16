# Rate Limiting — Dizayn Spetsifikatsiyasi

**Sana:** 2026-07-16
**Maqsad:** Audit hujjatida topilgan eng yuqori ustuvorlikdagi xavfsizlik zaifligini — Express route'lar va Socket.IO event'larda rate-limiting yo'qligini — tuzatish.

## Ko'lam

**Kiradi:**
- Barcha `/api/*` REST route'lar uchun IP-asoslangan rate-limiting (Redis-asoslangan, taqsimlangan — mavjud `redis` ulanishini qayta ishlatadi)
- Barcha Socket.IO event handler'lar uchun per-socket throttling (jarayon-ichi, mavjud arxitektura naqshiga mos — texnik arxitektura hujjatida ham shu tarzda tavsiya etilgan)
- `trust proxy` sozlamasini to'g'irlash (production'da nginx-proxy ortida ishlaganligi sababli zarur)

**Kirmaydi:**
- Taqsimlangan (Redis-asoslangan) socket throttling — hozirgi bitta-server arxitekturasida ortiqcha murakkablik (audit hujjatida ham shunday deb belgilangan)
- CAPTCHA yoki boshqa bot-aniqlash mexanizmlari

## Muhim topilma: `trust proxy`

Production'da backend `docker-compose.yml`dagi `jwilder/nginx-proxy` naqshi orqali ishlaydi — barcha so'rovlar tashqi proksi orqali keladi. Hozircha `app.set('trust proxy', ...)` HECH QAYERDA sozlanmagan, ya'ni `req.ip` proksi konteynerining ichki Docker tarmoq IP manzilini qaytaradi, HAQIQIY klient IP emas. Bu, agar tuzatilmasa, barcha foydalanuvchilarni BITTA IP sifatida hisoblab, rate-limit'ni ma'nosiz qiladi (yoki `express-rate-limit`ning yangi versiyalarida `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` xatosini beradi). Tuzatish: `app.set('trust proxy', 1)` — faqat BITTA ishonchli proksi qatlamini tan olish (aniq va xavfsiz, `true` dan farqli — `true` cheksiz ishonch beradi va IP-soxtalashtirish xavfini oshiradi).

## REST rate-limiting

Kutubxona: `express-rate-limit` + `rate-limit-redis` (mavjud `backend/src/config/redis.ts`dagi ulanishni qayta ishlatadi).

Darajalangan limitlar:
- **`/health`** — LIMIT YO'Q (monitoring/orchestration uchun, hech qachon cheklanmasligi kerak)
- **`POST /api/auth/login`** — QATTIQ: 10 so'rov / 5 daqiqa, IP bo'yicha (autentifikatsiyasiz, eng nozik nuqta)
- **`POST /api/admin/questions/import`** — QATTIQ: 5 so'rov / 15 daqiqa, IP bo'yicha (allaqachon admin-himoyalangan, lekin qimmat operatsiya)
- **`GET /api/users/:telegramId/avatar`** — O'RTA: 60 so'rov / daqiqa, IP bo'yicha (ochiq, lekin haqiqiy buffer ishi qiladi)
- **Umumiy `/api/*`** (qolgan barcha route'lar — categories, leaderboard, stats, level-progress, achievements, profile, admin/stats) — YENGIL: 100 so'rov / daqiqa, IP bo'yicha (asosiy himoya qatlami)

Bir nechta limiter mos kelganda — ENG QATTIQ (eng aniq mos keluvchi) qo'llaniladi (masalan, `/api/auth/login` faqat o'zining 10/5min limitiga bo'ysunadi, umumiy 100/min qatlamiga EMAS — Express middleware tartibida aniqroq route birinchi ro'yxatga olinadi).

## Socket.IO throttling

Kutubxona kerak emas — oddiy, jarayon-ichi token-bucket hisoblagichi (`Map<socketId, {count, windowStart}>`), mavjud `matchmaker.ts`/`gameEngine.ts`dagi jarayon-ichi Map naqshlariga mos (masshtablanish hujjatida ham bitta-server bosqichida bu yetarli deb belgilangan).

Umumiy `createSocketThrottle(maxPerWindow, windowMs)` fabrika funksiyasi, har bir event handler boshida chaqiriladi:
- `submit_answer` — 10 / soniya (haqiqiy o'yin uchun juda yetarli, lekin spam'ni to'xtatadi)
- `join_queue`, `leave_queue`, `join_level_queue`, `leave_level_queue` — 5 / soniya
- `create_invite`, `join_invite`, `create_level_invite`, `join_level_invite` — 5 / soniya
- `reconnect_game` — 5 / soniya

Limitdan oshgan hodisa jimgina e'tiborsiz qoldiriladi (hech qanday xatolik javobi yubormaydi — bu spamerlarga "sizni aniqladik" signalini bermaydi, va oddiy foydalanuvchi UI orqali bunday tezlikda hodisa yubora olmaydi, shuning uchun haqiqiy foydalanuvchi tajribasiga ta'sir qilmaydi).

## Testlash

Backend: Jest, real Redis (mavjud loyiha konventsiyasi). REST uchun `supertest` orqali limit-oshirish stsenariysi (masalan, N+1-chi so'rov 429 qaytarishini tekshirish). Socket uchun `tests/integration/socketServer.test.ts`ga qo'shimcha — real `socket.io-client` orqali tezkor ketma-ket event yuborib, faqat limitgacha bo'lganlari qabul qilinishini tekshirish.

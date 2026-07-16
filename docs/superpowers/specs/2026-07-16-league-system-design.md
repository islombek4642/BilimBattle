# Liga (League) Tizimi — Dizayn Spetsifikatsiyasi

**Sana:** 2026-07-16
**Maqsad:** Game design hujjatida (7 bosqichli Bronza→Chempion, haftalik XP-asoslangan reyting) belgilangan Liga tizimini, XP+Mastery+Daily Quest tizimi ustiga, mavjud infratuzilmaga mos ravishda implementatsiya qilish.

## Ko'lam

**Kiradi:** 7 bosqichli liga (Bronza/Kumush/Oltin/Platina/Olmos/Usta/Chempion), haftalik XP to'planishi (lazy, `daily_quest_progress` naqshiga o'xshab), haftalik ko'tarilish/tushish hisob-kitobi (admin-tetiklaydigan, idempotent endpoint), `GET /api/league` (joriy liga + haftalik reyting), frontend'da `LeaderboardScreen`ga uchinchi "Liga" varag'i qo'shish, `HomeScreen`ga qisqa liga ko'rsatkichi.

**Kirmaydi:** Matchmaking'ni liga bo'yicha filtrlash (game design hujjatida ham ataylab rad etilgan — kam foydalanuvchi bazasida navbat cho'zilib ketishi mumkin), Legend/Prestij tizimi (bu — alohida, kelajakdagi bosqich), avtomatik in-process rejalashtiruvchi (quyida asoslanadi).

## Muhim texnik qaror: rejalashtirish mexanizmi

Tadqiqot shuni ko'rsatdi: backend'da HECH QANDAY job-scheduling kutubxonasi yo'q (`node-cron`, `bull` va h.k. o'rnatilmagan), va yagona mavjud "davriy ishlaydigan" narsa — bu `scripts/healthcheck-alert.sh`, u **host darajasidagi crontab** orqali ishlaydi (Node jarayonining o'zida emas).

**Qaror: yangi npm kutubxona QO'SHILMAYDI.** Buning o'rniga, mavjud host-cron naqshiga mos: `POST /api/admin/league/process-week` — admin-himoyalangan, IDEMPOTENT endpoint yaratiladi, va host crontab'ga (production serverda, qo'lda) haftalik bir marta (masalan, har Dushanba, 00:05'da) shu endpoint'ni chaqiruvchi yozuv qo'shiladi.

**Nega in-process `setInterval`/`node-cron` EMAS:** `docker-compose.yml` hozircha BITTA `api` konteyneri ishlatadi (replika yo'q), shuning uchun in-process taймer HOZIRCHA xavfsiz bo'lardi — LEKIN kelajakda 2+ instansiyaga o'tilsa (masshtablanish hujjatida rejalashtirilgan), har bir instansiya o'z taймerini alohida ishga tushirib, hisob-kitobni bir necha marta bajarishi mumkin edi. Host-cron + IDEMPOTENT endpoint yondashuvi bu muammoni BUTUNLAY oldini oladi (chaqiruv APP JARAYONI TASHQARISIDA, faqat bitta joydan keladi) va HECH QANDAY yangi bog'liqlik qo'shmaydi.

**Idempotentlik:** yangi `league_processing_log(week_start_date PRIMARY KEY, processed_at)` jadvali — endpoint chaqirilganda, agar o'sha hafta uchun qator ALLAQACHON mavjud bo'lsa, HECH NARSA qilmasdan darhol muvaffaqiyatli javob qaytaradi. Bu, tasodifiy takroriy chaqiruv (masalan, qo'lda ishga tushirish + cron ikkalasi ham bir kunda ishlasa) ZARARSIZ bo'lishini kafolatlaydi.

**Deploy talabi (kod EMAS, operatsion qadam):** production serverda `crontab -e` orqali quyidagi qatorni qo'shish kerak bo'ladi (implementatsiya rejasi buni aniq eslatib o'tadi, lekin bu — CEFR migratsiyasi kabi, qo'lda bajariladigan bir martalik sozlash):
```
5 0 * * 1 curl -X POST -u admin:$ADMIN_PASSWORD https://api.bilimbattle.uz/api/admin/league/process-week
```
**MUHIM:** manzil aniq `API_DOMAIN` (`api.bilimbattle.uz`) bo'lishi shart, `WEBAPP_DOMAIN` (`bilimbattle.uz`) EMAS — bular `docker-compose.yml`da ikkita alohida `VIRTUAL_HOST` (nginx-proxy vhost). `bilimbattle.uz`ga POST yuborilsa, so'rov frontend statik konteynerining nginx'iga (`frontend/nginx.conf`, faqat static fayllarni beradi) tushadi va `405 Not Allowed` qaytaradi — bu production'da haqiqatan ham yuz berdi va `api.bilimbattle.uz`ga tuzatilib, tasdiqlandi (2026-07-17).

## Ma'lumotlar modeli

**`league_weekly_xp(user_id, week_start_date, xp)`** — `daily_quest_progress`bilan BIR XIL "lazy" naqsh: har hafta uchun yangi qator, aniq reset qadami kerak emas. `week_start_date` — `progression/streakLogic.ts`dagi MAVJUD `mostRecentMonday()` funksiyasi orqali hisoblanadi (kod takrorlanmaydi, mavjud UTC-Dushanba-boshlanuvchi hafta mantig'i qayta ishlatiladi).

**`user_league(user_id PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'Bronza', updated_at)`** — foydalanuvchining JORIY liga darajasi. Birinchi marta `ingliz_tili` jangida XP olganda avtomatik `Bronza` bilan yaratiladi (`ON CONFLICT DO NOTHING` upsert).

**`league_processing_log(week_start_date PRIMARY KEY, processed_at)`** — yuqorida tushuntirilgan idempotentlik belgisi.

## XP to'planishi

Mavjud `backend/src/progression/progressionService.ts`ning `updateProgressionForRealPlayers` funksiyasiga BITTA qo'shimcha chaqiruv qo'shiladi (mavjud `addSubjectProgress`/`recordDailyMatch`/`recordDailyActivity` chaqiruvlari BILAN BIR QATORDA) — `player.score`ni (allaqachon hisoblangan) `league_weekly_xp`ga qo'shadi. Bu — MAVJUD integratsiya nuqtasi, yangi hook kerak emas.

## Haftalik hisob-kitob algoritmi

`POST /api/admin/league/process-week` chaqirilganda (`requireAuth` + `requireAdmin`, mavjud `adminApiRoutes.ts` naqshiga mos):
1. O'tgan hafta chegarasini hisoblash: `mostRecentMonday(hozir) - 7 kun`.
2. Agar `league_processing_log`da shu hafta uchun qator BOR bo'lsa — darhol `{alreadyProcessed: true}` qaytarib, TO'XTASH.
3. Shu hafta uchun `league_weekly_xp`da QATORI BOR barcha foydalanuvchilarni (0 XP bilan hafta o'tkazganlar HISOBGA OLINMAYDI — ular reytingda ishtirok etmagan, shuning uchun ko'tarilish/tushishga ham tortilmaydi) `user_league.tier` bo'yicha guruhlash.
4. Har bir guruh (liga darajasi) ICHIDA foydalanuvchilarni `league_weekly_xp.xp` bo'yicha KAMAYISH tartibida saralash.
5. Har guruhning YUQORI ~20%i — bir daraja YUQORIGA (Chempion'dan yuqoriga ko'tarilish yo'q — chegara).
6. Har guruhning PASTKI ~20%i — bir daraja PASTGA (Bronzadan pastga tushish YO'Q — game design hujjatidagi qat'iy qoida).
7. `user_league.tier`ni yangilash, `league_processing_log`ga yozuv qo'shish.

## API

**`GET /api/league`** (yangi, `requireAuth`) — javob: `{tier, weeklyXp, bracket: [{telegramId, firstName, weeklyXp}, ...]}` — `bracket` — foydalanuvchi bilan BIR XIL ligadagi, shu haftada eng ko'p XP to'plagan top-10 (mavjud `leaderboardRoutes.ts`dagi global/friends naqshiga o'xshash).

## Frontend

`frontend/src/screens/LeaderboardScreen.tsx`ga UCHINCHI varaq ("Liga") qo'shiladi (mavjud Global/Friends varaqlari yonida) — foydalanuvchining joriy ligasi + bracket ro'yxatini ko'rsatadi. `HomeScreen.tsx`ga qisqa liga ko'rsatkichi (masalan, "Oltin liga" belgisi) qo'shiladi — UI/UX hujjatidagi "Daraja 4 — fon konteksti" ustuvorligiga mos, kichik va DOIMIY EMAS (faqat liga ma'lumoti yuklangach ko'rinadi).

## Testlash

Backend: Jest, real Postgres. Haftalik hisob-kitob algoritmi uchun — turli XP taqsimoti bilan fixture foydalanuvchilar yaratib, promotion/relegation to'g'ri ishlashini tekshirish, PLUS idempotentlik testi (ikkinchi chaqiruv hech narsa o'zgartirmasligini tasdiqlash).

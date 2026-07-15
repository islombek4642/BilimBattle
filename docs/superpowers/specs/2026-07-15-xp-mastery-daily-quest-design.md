# XP, Mastery, Daily Quest va Kunlik Streak — Dizayn Spetsifikatsiyasi

**Sana:** 2026-07-15
**Maqsad:** BilimBattle'ga XP (hech qachon kamaymaydigan bilim ko'rsatkichi), Mastery Rank
(fan bo'yicha mahorat darajasi, 5 bosqich), Daily Quest (kunlik missiyalar) va Kunlik Faollik
Streak'ini qo'shish — CEFR-uslubidagi vaqtinchalik CEFR darajalash allaqachon mavjud bo'lgan
`ingliz_tili` kategoriyasi doirasida.

**Asos hujjatlar:** bu spec quyidagi oldingi tahlil/dizayn hujjatlariga tayanadi (loyihaning
tashqarisida, `d:\Startup\` papkasida saqlangan): audit, game design, emotional design, UI/UX
experience, art direction, design system, product ecosystem, technical architecture
hujjatlari. Ushbu spec — o'sha vizyondan BITTA, ANIQ, IMPLEMENTATSIYA QILINADIGAN bo'lakni
ажratib oladi.

## Ko'lam (Scope)

**Kiradi:**
- XP va Mastery — FAQAT `ingliz_tili` kategoriyasi uchun
- Daily Quest — 3 ta shablon, `ingliz_tili` faoliyatiga asoslangan
- Kunlik faollik streak (mavjud g'alaba-streak'dan ALOHIDA)
- Yangi ProfileScreen (SettingsScreen'dan profil-identifikatsiya qismini ajratib oladi)
- HomeScreen va LevelSelectScreen'ga tegishli qo'shimchalar

**Kirmaydi (keyingi bosqichlar uchun):**
- Boshqa kategoriyalar (Umumiy bilim, Sport/Kino/Musiqa) uchun XP/Mastery
- Liga (League) tizimi
- Fon-jarayon (cron/job-queue) infratuzilmasi — bu bosqichda LAZY-RESET yondashuvi
  ishlatiladi (pastda tushuntiriladi), chunki Daily Quest/Streak reset ATOMIK, past-hajmli
  operatsiya, alohida infratuzilma talab qilmaydi
- Yillik xulosa (recap), Achievement mukofot bog'lashi, Legend/Prestij

## Arxitektura

Mavjud kod bazasiga (backend/src) ikkita yangi modul qo'shiladi:
- `backend/src/progression/` — XP, Mastery, Daily Quest, Streak mantiqi
- Mavjud `gameEngine.ts`'ning `finishGame` funksiyasiga BITTA yangi chaqiruv qo'shiladi
  (mavjud achievement-tekshirish chaqiruvi bilan BIR XIL joyda, undan KEYIN) — bu, texnik
  arxitektura hujjatidagi "Game Engine'ni kichik saqlash" tamoyiliga qisman zid (to'liq
  hodisa-asoslangan shina hozircha yo'q), LEKIN bu — mavjud achievement-chaqiruv naqshi bilan
  BIR XIL, izchil yondashuv, va loyihaning HOZIRGI masshtabida (bitta server, kam
  foydalanuvchi) to'g'ri, oqilona qaror. Kelajakda hodisa-shina qo'shilganda, bu chaqiruv
  o'sha shinaga ko'chiriladi.

### Lazy-reset yondashuvi (fon-jarayonsiz kunlik/haftalik reset)

Hech qanday cron/scheduled job YARATILMAYDI. Buning o'rniga: har safar foydalanuvchi
`/api/profile` yoki jangni tugatish orqali progression ma'lumotiga murojaat qilganda,
backend SAQLANGAN oxirgi sanani JORIY UTC sanasi bilan solishtiradi:
- Agar saqlangan sana BUGUNGI kundan OLDIN bo'lsa → kunlik quest progressi va "bugungi"
  hisoblagichlar NOLGA TUSHIRILADI (yangi qatorlar yozilmaydi, mavjud qator YANGILANADI).
- Agar farq ANIQ 1 kun bo'lsa VA streak-himoya ishlatilmagan bo'lsa → streak SAQLANADI,
  himoya "ishlatilgan" deb belgilanadi.
- Agar farq 1 kundan KO'P bo'lsa → streak 0'ga (keyingi faoliyatda 1'ga) tushadi.

"Kun" — UTC taqvim sanasi sifatida belgilanadi (soddalik uchun; foydalanuvchining mahalliy
vaqt zonasi hisobga OLINMAYDI — bu, bilinган, hujjatlashtirilgan soddalashtirish, kelajakda
zarur bo'lsa qayta ko'rib chiqiladi).

## Ma'lumotlar modeli (kontseptual, aniq SQL implementatsiya bosqichida yoziladi)

**`subject_xp` jadvali** — `user_id, category (FAQAT 'ingliz_tili'), xp INTEGER DEFAULT 0,
mastery_points INTEGER DEFAULT 0`, composite PK `(user_id, category)`.

**`users` jadvaliga yangi ustunlar** — `daily_streak INTEGER DEFAULT 0`,
`best_daily_streak INTEGER DEFAULT 0`, `last_active_date DATE`,
`streak_freeze_used_at DATE` (haftalik himoyaning oxirgi ishlatilgan sanasi — hafta
boshlanishi bilan solishtirib, "bu hafta hali ishlatilmagan"ni aniqlash uchun).

**`daily_quest_progress` jadvali** — `user_id, quest_date DATE, matches_played INTEGER
DEFAULT 0, correct_answers INTEGER DEFAULT 0, best_stars_today SMALLINT DEFAULT 0`,
composite PK `(user_id, quest_date)`. Eski kunlarga oid qatorlar keyinchalik tozalanishi
mumkin (bu spec doirasida emas).

**Daily Quest katalogi** — Achievement katalogiga o'xshab, STATIK, kod-ichida massiv
(`backend/src/progression/dailyQuests.ts`):
1. `matches_3` — "Bugun 3 ta jang o'ynang" — `matches_played >= 3`
2. `correct_10` — "10 ta savolga to'g'ri javob bering" — `correct_answers >= 10`
3. `stars_2` — "Kamida bitta darajada 2+ yulduz oling" — `best_stars_today >= 2`

## XP va Mastery hisoblash formulasi

**XP** — mavjud `scoring.ts`dagi jangdagi ball hisoblash natijasidan OLINADI (yangi formula
YO'Q): har bir jang tugagach, o'sha o'yinchining shu jangda to'plagan XOM OCHKOSI (mavjud
`BASE_CORRECT_POINTS + tezlik bonusi`) `subject_xp.xp`ga QO'SHILADI. G'ALABA HAM,
MAG'LUBIYAT HAM XP qo'shadi (faqat ochko miqdoricha) — hech qachon kamaymaydi.

**Mastery Points** — HAR BIR TO'G'RI javob berilgan savolning `questions.cefr_level`iga
qarab og'irlik bilan qo'shiladi: A1=1, A2=2, B1=3, B2=4, C1=5, C2=6 ball. Bu, oddiy "ko'p
o'ynash"dan ko'ra "qiyinroq savollarga to'g'ri javob berish"ni mukofotlaydi (game design
hujjatining "Mastery — grind emas, sifat" tamoyili).

**Mastery Rank chegaralari** (`mastery_points` kumulyativ yig'indisi asosida):
- Boshlang'ich: 0–149
- O'rta: 150–449
- Yuqori: 450–1199
- Usta: 1200–2999
- Professor: 3000+

(Bu chegaralar — game design hujjatidagi "30-kun→O'rta, 90-kun→Yuqori/Usta, 1-yil→Professor"
taxminiy sur'atiga mos qilib tanlangan dizayn qarori; kelajakda haqiqiy o'yin ma'lumotlari
asosida moslashtirilishi mumkin.)

## Awarding hook nuqtasi

`gameEngine.ts`'ning `finishGame` funksiyasida, mavjud `awardMatchAchievementsForRealPlayers`
chaqiruvidan KEYIN, yangi `updateProgressionForRealPlayers(players, category, questionResults)`
chaqiriladi — bot o'yinchilar (`isBot`) BIRINCHI QATORDA `continue` bilan o'tkazib
yuboriladi (mavjud achievement naqshi bilan BIR XIL himoya). Bu funksiya: (a) XP'ni
qo'shadi, (b) to'g'ri javoblar bo'yicha Mastery Points'ni qo'shadi, (c) `daily_quest_
progress`'ni yangilaydi (lazy-reset tekshiruvi bilan), (d) kunlik streak'ni yangilaydi
(lazy-reset tekshiruvi bilan).

## API

**`GET /api/profile`** (yangi, JWT talab qiladi) — birlashtirilgan javob:
```
{
  xp: number,
  masteryPoints: number,
  masteryRank: 'Boshlangich' | 'Orta' | 'Yuqori' | 'Usta' | 'Professor',
  category: 'ingliz_tili',
  dailyQuests: [{ key, label, progress, target, completed }],
  streak: { current: number, best: number, freezeAvailable: boolean },
  achievements: (mavjud /api/achievements formatiga o'xshash),
  stats: (mavjud /api/stats/me formatiga o'xshash)
}
```
Bu endpoint mavjud `achievementsRoutes.ts`/`statsRoutes.ts` mantig'ini QAYTA YOZMAYDI, balki
ularning IChKI funksiyalarini CHAQIRADI (kod takrorlanmasligi uchun).

## Frontend

**Yangi `ProfileScreen.tsx`** — `NavigationContext`ga `{name: 'profile'}` qo'shiladi.
Tarkib (yuqoridan pastga): Mastery badge (5 bosqichli "yorug'lik intensivligi" vizual
tili), XP ko'rsatkichi, Streak ko'rsatkichi, ENG KO'PI BILAN 3 ta so'nggi qo'lga
kiritilgan Achievement (to'liq ro'yxat EMAS — qisqa "eng nodir yutuqlar" preview) + "Barcha
yutuqlarni ko'rish" tugmasi (mavjud AchievementsScreen'ga navigatsiya qiladi, kod
takrorlanmaydi), mavjud statistika (SettingsScreen'dagi profil kartasidan ko'chiriladi).
`AchievementsScreen.tsx`ning o'zi O'ZGARISHSIZ qoladi — u hamon to'liq katalogni
ko'rsatadigan, mustaqil ekran bo'lib qoladi.

**`SettingsScreen.tsx`** — profil kartasi (avatar, ism, o'yinlar/reyting) OLIB TASHLANADI
(ProfileScreen'ga ko'chiriladi), FAQAT sozlamalar (ovoz/vibratsiya) va admin havolasi
qoladi — Design System hujjatidagi "Profile va Settings ajratilgan bo'lishi kerak"
qoidasiga mos.

**`HomeScreen.tsx`** — yangi Daily Quest kartasi (3 ta missiya progressi bilan) va Kunlik
Streak ko'rsatkichi qo'shiladi, mavjud HUD qatoriga.

**`LevelSelectScreen.tsx`** — sahifa tepasida Mastery badge (Ingliz tili uchun) qo'shiladi.

**Vizual til (mastery "yorug'lik intensivligi")** — MAVJUD `index.css` tokenlaridan
foydalanadi (yangi rang IXTIRO QILINMAYDI):
- Boshlang'ich → `--color-ios-secondary-label` (neytral kulrang)
- O'rta → `--color-ios-blue`
- Yuqori → `--color-ios-green`
- Usta → `--color-ios-purple`
- Professor → `--color-ios-gold` + yengil `box-shadow` porlash effekti

Bu progressiya — neytraldan boshlab, mavjud rang tokenlari orqali, oxirida "porlash"ga
o'sib boradi — art direction hujjatidagi metafora bilan mos, lekin HECH QANDAY yangi
texnik token yaratmasdan.

## Xatoliklarni boshqarish

- Agar `/api/profile` chaqirilganda `subject_xp` qatori mavjud bo'lmasa (hali birorta
  Ingliz tili jangi o'ynalmagan) — 0 qiymatlar bilan standart javob qaytariladi, xatolik
  EMAS.
- Lazy-reset mantiqi — race condition holatiga (bir vaqtda ikkita so'rov) chidamli
  bo'lishi uchun, `ON CONFLICT DO UPDATE` (upsert) naqshidan foydalaniladi (mavjud
  `level_progress` upsert naqshiga o'xshash).

## Testlash

Backend: Jest, real Postgres/Redis (mavjud loyiha konventsiyasi). Yangi test fayllari:
`tests/progression/masteryService.test.ts`, `tests/progression/dailyQuests.test.ts`,
mavjud `gameEngine.test.ts`ga qo'shimcha testlar (progression chaqiruvi bot o'yinchilarni
o'tkazib yuborishini tekshiruvchi regressiya testi — achievement uchun qilingan xuddi shu
naqsh).

Frontend: Vitest + RTL, mavjud konventsiya. Yangi: `ProfileScreen.test.tsx`,
`api/profile.test.ts`, `HomeScreen.test.tsx`ga Daily Quest/Streak testlari qo'shiladi,
`SettingsScreen.test.tsx`dan profil-karta testlari OLIB TASHLANADI (ProfileScreen'ga
ko'chadi).

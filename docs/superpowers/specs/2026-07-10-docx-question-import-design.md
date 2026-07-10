# BilimBattle — Word (.docx) fayldan test savollarini yuklash (Design Spec)

**Sana:** 2026-07-10
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. G'oya va maqsad

Hozir test savollari `backend/src/db/seed.ts` faylida qattiq yozilgan TS massivi sifatida saqlanadi (jami 20 ta, 2 turkumda) va faqat `npm run seed` orqali, kodni qayta joylashtirish (redeploy) bilan bog'liq holda bazaga kiritiladi. Maqsad — admin panelidan to'g'ridan-to'g'ri, deploy qilmasdan, Word (.docx) faylni yuklab, undagi savollarni bazaga qo'sha olish.

## 2. Fayl formati va parsing

Yuklangan `.docx` fayl avval `mammoth` kutubxonasi yordamida oddiy matnga aylantiriladi, so'ng qatorma-qator quyidagi belgilar bo'yicha tahlil qilinadi:

- `?` bilan boshlangan qator → savol matni (yangi savol blokini boshlaydi)
- `+` bilan boshlangan qator → **to'g'ri** javob varianti
- `=` bilan boshlangan qator → **noto'g'ri** javob varianti
- Bo'sh qatorlar bloklar orasida e'tiborga olinmaydi (ajratuvchi sifatida ishlatilishi mumkin, lekin shart emas)

Misol:

```
? Dunyodagi eng katta okean qaysi?
= Atlantika
+ Tinch okeani
= Hind okeani
= Shimoliy Muz okeani

? Inson tanasida nechta suyak bor (kattalarda)?
= 186
+ 206
= 226
= 246
```

Har bir belgidan keyingi bo'sh joy (space) olib tashlanadi; qolgan matn shu qatorning mazmuni (savol matni yoki javob varianti) sifatida olinadi.

### Validatsiya (har bir savol bloki uchun alohida)

- Savol matni bo'sh bo'lmasligi kerak
- Aynan **bittagina** `+` qatori bo'lishi kerak (0 ta yoki 2+ ta bo'lsa — xatolik)
- Kamida **bitta** `=` qatori bo'lishi kerak
- Variantlar soni qat'iy 4 taga cheklanmaydi — interfeys moslashuvchan (`BattleScreen`da variantlar vertikal ro'yxat sifatida chiziladi, aniq sonini talab qilmaydi), lekin amalda odatda 4 ta bo'ladi

Bitta savol blokidagi xatolik **butun faylni rad etmaydi** — faqat o'sha blok o'tkazib yuboriladi, qolgan yaroqli bloklar baribir bazaga qo'shiladi. Har bir xatolik qaysi qatorda (fayldagi qator raqami) va nima sababdan yuz berganini ko'rsatadi (masalan: `{ line: 34, message: "to'g'ri javob belgilanmagan" }`).

Faylning `?` belgisidan oldingi har qanday boshlang'ich matni (preamble) e'tiborga olinmaydi.

## 3. Turkumlar bazaga ko'chiriladi

Hozir turkumlar (`umumiy_bilim`, `sport_kino_musiqa`) `backend/src/questions/questionRepository.ts`da qattiq yozilgan `CATEGORIES` massivi sifatida saqlanadi. Bu quyidagicha o'zgaradi:

- Yangi `categories` jadvali qo'shiladi: `key TEXT PRIMARY KEY`, `label TEXT NOT NULL`
- Bir martalik migratsiya orqali mavjud 2 ta turkum shu jadvalga ko'chiriladi
- `isValidCategory(key)` va `/api/categories` endpoint'i endi shu jadvaldan (Postgres so'rovi orqali) o'qiydi — kod ichidagi hardcode massiv olib tashlanadi
- `questions` va `matches` jadvallaridagi `category` ustuni o'zgarmaydi (hali ham oddiy TEXT, tashqi kalit (FK) emas) — mavjud ma'lumotlarga ta'sir qilmaydi

### Yangi turkum yaratish

Fayl yuklashda admin yangi turkum nomini (masalan "Tarix va geografiya") kiritishi mumkin:

- Nomdan avtomatik "key" hosil qilinadi (kichik harflarga o'tkaziladi, bo'shliqlar va boshqa belgilar `_` bilan almashtiriladi — masalan `tarix_va_geografiya`)
- Agar xuddi shu nomli turkum (katta-kichik harfga sezgir bo'lmagan holda) allaqachon mavjud bo'lsa, xatolik berilmaydi — savollar shunchaki o'sha mavjud turkumga qo'shiladi
- Agar hosil bo'lgan "key" boshqa nomli turkumniki bilan mos kelib qolsa (kamdan-kam holat), oxiriga raqamli qo'shimcha qo'shiladi (masalan `tarix_va_geografiya_2`)

## 4. Backend API

Yangi endpoint: **`POST /api/admin/questions/import`**

- Xuddi hozirgi `/api/admin/stats` kabi himoyalangan — faqat `ADMIN_TELEGRAM_ID`ga tegishli foydalanuvchining JWT tokeni bilan ishlaydi, boshqa har qanday so'rov `403` bilan rad etiladi
- `multipart/form-data` sifatida qabul qilinadi (`multer`, xotirada saqlash — diskka yozilmaydi):
  - `file` — `.docx` fayl (maksimal hajm: 5MB; boshqa kengaytma/MIME turi rad etiladi)
  - `category` — mavjud turkum kaliti, **YOKI**
  - `newCategoryLabel` — yangi turkum nomi (matn)

`category` va `newCategoryLabel`dan **aynan bittasi** berilishi shart — ikkalasi ham berilsa yoki ikkalasi ham bo'lmasa, so'rov `400` bilan rad etiladi. Agar `category` berilib, u hech qanday mavjud turkum kaliti bilan mos kelmasa (masalan yozuvda xato), so'rov ham `400` bilan rad etiladi (bu holatda avtomatik yangi turkum yaratilmaydi — buning uchun aniq `newCategoryLabel` kerak).

**Ishlash tartibi:**
1. Fayl kengaytmasi va hajmi tekshiriladi
2. `mammoth.extractRawText()` orqali fayl matnga aylantiriladi
3. 2-bo'limdagi parser bilan tahlil qilinadi (yaroqli bloklar + xatolar ro'yxati alohida ajratiladi)
4. Agar `newCategoryLabel` berilgan bo'lsa — 3-bo'limdagi mantiq bo'yicha turkum topiladi yoki yaratiladi
5. Yaroqli savol bloklari `questions` jadvaliga qo'shiladi (append, mavjudlarga tegilmaydi)
6. Javob: `{ category: { key, label }, inserted: 12, errors: [{ line: 34, message: "to'g'ri javob belgilanmagan" }] }`

## 5. Frontend — Admin paneli interfeysi

`AdminScreen.tsx`ga yangi bo'lim qo'shiladi: **"Savol qo'shish"**

- **Turkum tanlash**: dropdown — `/api/categories`dan kelgan mavjud turkumlar + ro'yxat oxirida "＋ Yangi turkum" varianti
  - "Yangi turkum" tanlansa, pastda matn kiritish maydoni chiqadi (turkum nomi uchun)
- **Fayl tanlash**: oddiy `.docx` fayl tanlagich (`<input type="file" accept=".docx">`)
- **"Yuklash" tugmasi**: bosilganda `multipart/form-data` so'rovi yuboriladi, tugma yuklanish paytida "Yuklanmoqda..." holatiga o'tadi va qayta bosilishining oldi olinadi

Yuklash tugagach, natija kartochkasi ko'rsatiladi:
- Muvaffaqiyatli qism: "✅ 12 ta savol qo'shildi (Tarix va geografiya)"
- Xatolar bo'lsa, ularning ro'yxati pastda alohida ko'rsatiladi: "34-qatorda: to'g'ri javob belgilanmagan" va h.k.

### Qasddan qilinmaydigan narsalar (YAGNI)

- Mavjud savollarni ko'rish/tahrirlash/o'chirish ro'yxati bu bosqichda qo'shilmaydi — faqat yuklash (append). Agar keyinchalik kerak bo'lsa, alohida so'rov/spec sifatida qilinadi.
- Bitta so'rovda bir nechta fayl yoki bir nechta turkum yuklash imkoni yo'q — bir yuklash = bitta fayl = bitta turkum.

## 6. Testlash rejasi

**Backend — parser (sof funksiya, eng ko'p test shu yerda):**
- To'g'ri formatdagi bir nechta savol bloki — barchasi to'g'ri ajratiladi
- Bloklar orasidagi bo'sh qatorlar e'tiborga olinishi
- `+` yo'q savol bloki → xatolik qatorini ko'rsatadi, boshqa bloklarni buzmaydi
- Ikkita `+` bor bloki → xatolik ("bir nechta to'g'ri javob belgilangan")
- `=` umuman yo'q bloki → xatolik ("noto'g'ri javob yo'q")
- Savol matni bo'sh (`?` dan keyin hech narsa yo'q) → xatolik
- Qatorlar boshida/oxirida bo'sh joy (whitespace) bo'lsa ham to'g'ri ishlashi
- Fayl boshida `?` dan oldin keladigan begona matn (preamble) e'tiborga olinmasligi
- Fayl oxirida tugallanmagan blok (oxirgi savol, keyin fayl tugaydi) ham to'g'ri yakunlanishi

**Backend — `/api/admin/questions/import` route (real Postgres bilan integratsion test):**
- Admin bo'lmagan foydalanuvchi so'rovi 403 bilan rad etilishi
- Yaroqli fayl + mavjud turkum → savollar bazaga qo'shilishi, javobda to'g'ri `inserted` soni
- Yangi turkum nomi bilan yuklash → `categories` jadvalida yangi qator paydo bo'lishi
- Xatoli bloklar bor fayl → yaroqlilari baribir qo'shilishi, xatolar ro'yxati qaytishi
- `.docx` bo'lmagan fayl yuborilsa rad etilishi
- Fayl hajmi chegaradan katta bo'lsa rad etilishi
- `category` va `newCategoryLabel` ikkalasi ham berilsa, yoki ikkalasi ham berilmasa — `400` bilan rad etilishi
- Mavjud bo'lmagan `category` kaliti berilsa — `400` bilan rad etilishi (yangi turkum avtomatik yaratilmasligi)

**Backend — `categories` jadvali / `isValidCategory`:**
- Mavjud turkum kaliti to'g'ri tasdiqlanishi
- Yangi qo'shilgan turkum ham keyinchalik yaroqli deb tanilishi

**Frontend — Admin ekranidagi yangi bo'lim (Vitest + RTL, API mock qilingan):**
- Turkum dropdown to'g'ri to'ldirilishi
- "Yangi turkum" tanlanganda matn maydoni chiqishi
- Fayl tanlab "Yuklash" bosilganda to'g'ri so'rov yuborilishi
- Muvaffaqiyatli javobda natija xabari ko'rsatilishi
- Xatolar ro'yxati bilan javob kelganda ular ro'yxat sifatida chiqishi

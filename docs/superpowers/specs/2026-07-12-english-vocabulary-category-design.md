# BilimBattle — "Ingliz tili" kategoriyasi (Design Spec)

**Sana:** 2026-07-12
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. G'oya va maqsad

Hozir botda 2 ta turkum bor: "Umumiy bilim" va "Sport/Kino/Musiqa" — ikkalasi ham docx orqali qo'lda kiritilgan, 10-20 tadan savol. Maqsad — "Ingliz tili" nomli yangi turkum qo'shish: inglizcha so'z ko'rsatiladi, 4 ta ta'rif (definition) variantidan to'g'risini tanlash kerak. Mavjud 1v1 HP/nokaut jang mexanikasi (`docs/superpowers/specs/2026-07-11-hp-knockout-battle-design.md`), tortishuv chizig'i, K.O. effektlari va yulduz reytingi — barchasi **o'zgarishsiz** ishlaydi, chunki ular kategoriyaga bog'liq emas, faqat `score`ga bog'liq.

**Muhim kashfiyot:** savol banki uchun AI generatsiyasi yoki qo'lda yozish shart emas — ochiq, bepul, tayyor manba topildi:

- **`MongoDB/english-words-definitions`** (Hugging Face, https://huggingface.co/datasets/MongoDB/english-words-definitions) — 466,670 ta inglizcha so'z, har biriga 1+ ta tayyor ta'rif. Litsenziya: **Apache 2.0** (tijorat uchun erkin). Ochiq, login/token talab qilmaydi (tekshirildi: `gated: false`, parquet fayl anonim yuklab olindi).

Bu shuni anglatadiki, butun turkum kontenti **bir martalik offline import skripti** orqali tayyorlanadi — runtime'da hech qanday tashqi API chaqiruvi yoki AI generatsiyasi bo'lmaydi. Natija — mavjud `questions` jadvaliga oddiy qatorlar sifatida yozilgan, xuddi docx-import orqali kiritilgan savollar kabi.

## 2. Ma'lumot manbai va tanlangan yondashuv

Brainstorming davomida ko'rib chiqilgan va rad etilgan variantlar (izoh uchun):
- Kaggle'dagi TOEIC/IELTS/TOEFL "test prep" dataseti — haqiqiy savol emas, faqat kompetensiya grafigi (rad etildi).
- CEFR daraja bo'yicha filtrlash — foydalanuvchi buni keraksiz deb hisobladi, olib tashlandi.
- So'zlarni chastota/uzunlik bo'yicha filtrlash — foydalanuvchi buni ham keraksiz deb hisobladi; **butun 466k so'z filtrsiz ishlatiladi**.

Yakuniy qaror:
- **Manba:** `MongoDB/english-words-definitions` to'liq (466,670 so'z), hech qanday filtrsiz.
- **To'g'ri javob:** har bir so'zning ta'riflar massividagi **1-ta'rifi**.
- **Noto'g'ri 3 variant:** butunlay tasodifiy tanlangan 3 ta BOSHQA so'zning 1-ta'rifi.
- **Savol matni:** so'zning o'zi (masalan "Negative"), inglizcha, tarjimasiz.
- **Qo'shimcha (bonus):** agar so'zning 1-tadan ortiq ta'rifi bo'lsa, qolgan ta'riflar alohida saqlanadi — natija reveal bosqichida "yana ko'rsatish" tugmasi orqali ko'rsatish uchun (4-band).

## 3. Import pipeline (bir martalik offline skript)

**Yangi fayl:** `backend/scripts/importEnglishVocabulary.ts`

Qadamlar:
1. Parquet faylni to'g'ridan-to'g'ri yuklab olish: `https://huggingface.co/api/datasets/MongoDB/english-words-definitions/parquet/default/train/0.parquet` (~42MB, login talab qilmaydi — tasdiqlandi).
2. Node.js parquet-o'qish kutubxonasi (masalan `hyparquet`) bilan parse qilish — har bir qatorda `term: string`, `definitions: string[]`.
3. Har bir so'z uchun:
   - `text` = `term`
   - `correctDefinition` = `definitions[0]`
   - `extraDefinitions` = `definitions.slice(1)` (bo'sh massiv bo'lishi mumkin)
4. 3 ta noto'g'ri variant — boshqa tasodifiy so'zlarning `definitions[0]`'idan tanlanadi. Ikkita tekshiruv bilan: (a) distractor so'zi asosiy so'zning o'zi bo'lmasligi kerak, (b) 3 ta distractor bir-biridan farqli so'zlardan bo'lishi kerak (ikkita distractor bir xil so'zdan kelib, variant sifatida bir xil matn ikki marta chiqib qolmasligi uchun).
5. 4 ta variant (1 to'g'ri + 3 noto'g'ri) aralashtiriladi (shuffle), `correct_index` shunga qarab hisoblanadi.
6. **Ommaviy insert** — mavjud `insertQuestions()` (`questionRepository.ts:79`) qator-baqator `INSERT` qiladi, bu 466k qator uchun amalda ishlatib bo'lmaydi (466k ketma-ket DB round-trip). Shuning uchun bu skript alohida, **batch insert** (masalan `UNNEST`/ko'p qatorli `VALUES` bilan 1000talab guruhlarda) ishlatadi — `insertQuestions()`ni chaqirmaydi, faqat shu bitta skriptga xos.
7. Skript `node dist/backend/scripts/importEnglishVocabulary.js` sifatida serverda qo'lda, bir marta ishga tushiriladi (deploy vaqtida, migratsiyadan keyin).

## 4. Backend — sxema o'zgarishlari

`backend/src/db/schema.sql`ga:

```sql
-- categories jadvaliga yangi turkum
INSERT INTO categories (key, label) VALUES
  ('ingliz_tili', 'Ingliz tili')
ON CONFLICT (key) DO NOTHING;

-- questions jadvaliga qo'shimcha ta'riflar uchun (faqat shu turkumda to'ldiriladi, boshqalarida NULL)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS extra_definitions JSONB;
```

`extra_definitions` — nullable, default `NULL`. Mavjud 2 ta turkum uchun bu ustun hech qachon to'ldirilmaydi (docx-import mantig'i o'zgarmaydi), faqat "Ingliz tili" savollarida so'zning qolgan ta'riflari (bo'sh bo'lishi mumkin) saqlanadi.

`questionRepository.ts`ga:
- `QuestionRecord` interfeysiga ixtiyoriy `extraDefinitions?: string[]` maydoni qo'shiladi.
- `getRandomQuestions()`dagi SELECT so'roviga `extra_definitions` ustuni qo'shiladi, natijada `row.extra_definitions` bo'lsa `extraDefinitions` sifatida qaytariladi (bo'lmasa `undefined`).

`gameEngine.ts`/`socketServer.ts` — **o'zgarishsiz qoladi**. `question`/`question_result` hodisalari hozircha faqat `text`/`options`/`correctIndex` (server ichida) ishlatadi; `extraDefinitions`ni clientga yuborish uchun `question_result` payload'iga ixtiyoriy maydon qo'shiladi (quyida).

## 5. Backend — `question_result` payload'iga qo'shimcha maydon

Hozirgi `question_result` socket hodisasi savol hal bo'lgach yuboriladi (to'g'ri javob, ballar va h.k.). Bunga ixtiyoriy `extraDefinitions?: string[]` maydoni qo'shiladi — faqat shu savol "Ingliz tili" turkumidan bo'lsa va so'zning qo'shimcha ta'riflari bo'lsa to'ldiriladi, aks holda `undefined`/mavjud emas (boshqa turkumlar uchun to'liq eski xatti-harakat saqlanadi).

## 6. Frontend — savol va reveal ekrani

`BattleScreen.tsx`/tegishli component'lar:
- Savol ekrani o'zgarmaydi — so'z + 4 variant, mavjud UI naqshi bilan (variant matnlari uzunroq bo'lishi mumkin, chunki ta'riflar to'liq gap — variant tugmalari mavjudda ham o'zgaruvchan uzunlikdagi matnni qo'llab-quvvatlaydi, qo'shimcha CSS ishi kutilmaydi, lekin implementatsiya vaqtida tekshiriladi).
- Javob berilgach (reveal bosqichi), agar shu savol uchun `extraDefinitions` mavjud va bo'sh bo'lmasa: "Yana ko'rsatish" (kengaytiriladigan) tugma/bo'lim ko'rinadi, bosilganda so'zning qolgan ta'riflari ro'yxat sifatida ochiladi. Boshqa turkumlarda bu bo'lim umuman ko'rsatilmaydi (`extraDefinitions` yo'q).

`frontend/src/utils/category.ts`dagi `CATEGORY_LABELS` obyektiga `'ingliz_tili': 'Ingliz tili'` qo'shiladi (`categoryLabel()` shu orqali Home/Waiting ekranlarida to'g'ri label ko'rsatadi).

## 7. Qamrov chegarasi (nima o'zgarmaydi)

- HP/nokaut mexanikasi, tortishuv chizig'i formulasi, K.O. effektlari, yulduz reytingi — barchasi o'zgarishsiz, chunki bular `score`ga bog'liq, kategoriyaga bog'liq emas.
- Mavjud 2 ta turkum (`umumiy_bilim`, `sport_kino_musiqa`) va ularning docx-import mexanizmi — o'zgarishsiz.
- `insertQuestions()` (admin docx-import uchun) — o'zgarishsiz, faqat yangi bulk-import skripti alohida yoziladi.
- Reyting/ELO, `matches` jadvali — o'zgarishsiz.

## 8. Xavf va e'tiborga oladigan narsalar

- **`getRandomQuestions()`dagi `ORDER BY RANDOM() LIMIT $2`** — hozircha 20 qatorlik turkumlarda muammosiz, lekin 466k qatorlik "Ingliz tili" turkumida Postgres barcha mos qatorlarni saralashi kerak bo'ladi. Amalda odatda bir necha yuz millisekunddan oshmaydi, lekin implementatsiya bosqichida `EXPLAIN ANALYZE` bilan tekshirilib, agar sezilarli sekinlik chiqsa, muqobil (masalan tasodifiy ID oralig'i) ko'rib chiqiladi — hozircha ortiqcha murakkablashtirilmaydi (YAGNI).
- **Ma'lumotlar bazasi hajmi** — 466k qator, JSONB variantlar bilan taxminan bir necha yuz MB. Mavjud Postgres o'rnatish uchun muammo emas, lekin backup/disk hajmini kuzatish tavsiya etiladi.
- **Litsenziya** — Apache 2.0 talab qiladigan yagona narsa: manba kodini (agar qayta tarqatilsa) litsenziya bildirishnomasi bilan birga saqlash. Import skripti/README'da dataset manbai va litsenziyasi eslatiladi.

## 9. Testlash rejasi

**Backend:**
- Import skripti: mock parquet qatorlari bilan, har bir so'z uchun to'g'ri `options`/`correct_index`/`extra_definitions` shakli hosil bo'lishini tekshirish (unit test, haqiqiy parquet fayl yuklamasdan).
- `getRandomQuestions()`: `extra_definitions` ustuni mavjud bo'lganda to'g'ri qaytarilishi, `NULL` bo'lganda `extraDefinitions` maydoni javobda umuman bo'lmasligi (mavjud 2 turkum uchun regressiya yo'qligini tasdiqlash).
- Mavjud kategoriyalar (`umumiy_bilim`, `sport_kino_musiqa`) uchun barcha eski testlar o'zgarishsiz o'tishi.

**Frontend:**
- Reveal ekranida `extraDefinitions` mavjud bo'lsa "Yana ko'rsatish" bo'limi ko'rinishi, bosilganda ochilishi; mavjud bo'lmasa umuman ko'rinmasligi.
- Turkum tanlash ro'yxatida "Ingliz tili" paydo bo'lishi va to'g'ri `key` bilan ishlashi.

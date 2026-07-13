# BilimBattle — Bosqichli rejim (Level Mode) — Design Spec

**Sana:** 2026-07-14
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. G'oya va maqsad

Hozir foydalanuvchi "Tezkor o'yin"/"Do'stni chaqirish" bosilganda kategoriya (Umumiy bilim / Sport-Kino-Musiqa / Ingliz tili) tanlab, tasodifiy 15 ta savol bilan HP/nokaut jangiga kiradi — o'yin ko'pincha 1-2 savoldan keyin nokaut bilan tez tugab qoladi, bu foydalanuvchi tajribasini yomonlashtiradi.

Bu spec — butunlay yangi, **real o'yinlardagi "bosqichlar" (levels) tizimi** kabi rejimni qo'shadi: foydalanuvchi 1-dan boshlab raqamlangan bosqich kartochkalaridan birini tanlaydi, xuddi shu bosqichni tanlagan boshqa o'yinchi bilan (yoki bot bilan) mos keladi, va **nokautsiz**, 15 ta savolning barchasini oxirigacha o'ynaydi. Natija — g'alaba/mag'lubiyat emas, balki **shaxsiy natija**: nechta to'g'ri javob berganiga qarab 1-3 yulduz.

Bu rejim faqat **Ingliz tili** (466k so'z) uchun quriladi. Shu bilan birga, butun ilova bo'ylab **kategoriya tanlash imkoniyati foydalanuvchi va admin interfeyslaridan butunlay olib tashlanadi** — "Umumiy bilim"/"Sport/Kino/Musiqa" backend/bazada saqlanib qoladi (hech narsa o'chirilmaydi), lekin hech qanday ekranda tanlanmaydi/ko'rinmaydi.

## 2. Ko'lam — katta rasm

- **Bosh sahifa** soddalashtiriladi: statistika/profil qismi olib tashlanadi, faqat 2 ta tugma qoladi — **"Tezkor o'yin"** va **"Do'stni chaqirish"**.
- Ikkalasi ham endi kategoriya tanlash o'rniga yangi **bosqich tanlash** ekraniga olib boradi.
- **"Tezkor o'yin"**: bosqich tanlanadi → darhol navbatga qo'shiladi, xuddi shu bosqichni tanlagan boshqa o'yinchi (yoki 15s ichida bot) bilan mos keladi.
- **"Do'stni chaqirish"**: bosqich tanlanadi → taklif havolasi tayyorlanadi → do'st havolani bossa xuddi shu bosqichga qo'shiladi.
- O'yin: shu bosqichga tegishli aniq 15 ta savol (ikkala o'yinchi uchun bir xil), 30 soniyalik hozirgi vaqt chegarasi, mavjud savol-javob ekrani qayta ishlatiladi. **Nokaut yo'q** — barcha 15 savol oxirigacha o'ynaladi.
- Natija: g'alaba/mag'lubiyat emas — har bir o'yinchi **o'zining** to'g'ri javoblar soniga qarab (raqibning natijasidan qat'i nazar) 1-3 yulduz oladi.
- Admin paneldagi `.docx` orqali savol qo'shish funksiyasi qoladi, lekin kategoriya tanlash olib tashlanadi — har doim `ingliz_tili`ga qo'shiladi.
- **Nima o'zgarmaydi (backend/baza darajasida):** `categories`/`questions` jadvallari, mavjud kategoriya-asosli tezkor o'yin/taklif socket hodisalari (`join_queue`/`create_invite`/`join_invite`), HP/nokaut mexanikasi — barchasi backendda ichkarida saqlanib, o'zgarishsiz qoladi, shunchaki hech qanday interfeys ularni chaqirmay qoladi.

## 3. Ma'lumotlar bazasi

`backend/src/db/schema.sql`ga yangi jadval qo'shiladi (foydalanuvchining har bir bosqichdagi eng yaxshi natijasini saqlash uchun):

```sql
CREATE TABLE IF NOT EXISTS level_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  level_number INTEGER NOT NULL,
  stars SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level_number)
);
```

`PRIMARY KEY (user_id, level_number)` — har bir foydalanuvchi uchun har bir bosqichda faqat bitta qator bo'lishini ta'minlaydi; qayta o'ynalganda `ON CONFLICT (user_id, level_number) DO UPDATE SET stars = GREATEST(level_progress.stars, EXCLUDED.stars)` orqali eng yaxshi natija saqlanadi (pastroq natija bilan ustidan yozib yubormaydi).

**Bosqich → savol bog'lanishi uchun yangi jadval kerak emas** — mavjud 466k `ingliz_tili` so'zidan ketma-ket 15talik bo'lak sifatida hisoblanadi (4-bo'limga qarang). Bu — "Ingliz tili" import skripti allaqachon so'zlarni tasodifiy aralashtirib import qilgani tufayli mumkin bo'lgan sodda yechim (`docs/superpowers/plans/2026-07-12-english-vocabulary-category.md`dagi klasterlanish tuzatishiga qarang) — ketma-ket ID oralig'i allaqachon "tasodifiy" so'zlar to'plamini beradi.

## 4. Backend — bosqich-savol bog'lanishi

`backend/src/questions/questionRepository.ts`ga yangi funksiya:

```ts
const QUESTIONS_PER_LEVEL = 15;
const LEVEL_CATEGORY_KEY = 'ingliz_tili';

export async function getQuestionsForLevel(level: number): Promise<QuestionRecord[]> {
  const offset = (level - 1) * QUESTIONS_PER_LEVEL;
  const result = await pool.query<{
    id: number;
    question_text: string;
    options: string[];
    correct_index: number;
    extra_definitions: string[] | null;
  }>(
    `SELECT id, question_text, options, correct_index, extra_definitions
     FROM questions WHERE category = $1 ORDER BY id ASC OFFSET $2 LIMIT $3`,
    [LEVEL_CATEGORY_KEY, offset, QUESTIONS_PER_LEVEL]
  );
  return result.rows.map(toQuestionRecord); // toQuestionRecord - getRandomQuestions bilan bir xil, umumiy helper
}

export async function maxAvailableLevel(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM questions WHERE category = $1`,
    [LEVEL_CATEGORY_KEY]
  );
  return Math.floor(Number(result.rows[0].count) / QUESTIONS_PER_LEVEL);
}
```

`idx_questions_category_id(category, id)` indeksi (allaqachon mavjud) bu so'rovni ham tez qiladi — `ORDER BY id` allaqachon indeks tartibida, `OFFSET` faqat indeks bo'ylab o'tib ketadi (to'liq saralash emas).

**Cheklov:** bosqich raqami juda katta bo'lsa (masalan 31,000+), `OFFSET` sekinlashishi mumkin (indeks bo'ylab o'tish hali ham `O(offset)`). Amalda 466k so'z ~31,000 bosqichgacha yetadi — bu masshtabga real yaqinlashmaguncha optimallashtirish shart emas (YAGNI).

## 5. Backend — yangi socket hodisalari

Mavjud `join_queue`/`create_invite`/`join_invite`ga **hech qanday o'zgarish kiritilmaydi**. Ularning yoniga to'rtta yangi, alohida hodisa qo'shiladi (`backend/src/socket/socketServer.ts`):

- `join_level_queue({ level: number })` — `handleJoinLevelQueue`ni chaqiradi
- `leave_level_queue({ level: number })` — `cancelWaiting`ni `queue:level:{level}` kaliti bilan chaqiradi
- `create_level_invite({ level: number })` — `createInvite`ni `level` bilan chaqiradi
- `join_level_invite({ inviterTelegramId: number, level: number })` — `join_invite`ning level-versiyasi

`backend/src/matchmaking/matchmaker.ts`ga ingichka wrapper funksiyalar qo'shiladi:

```ts
const LEVEL_CATEGORY_KEY = 'ingliz_tili';

function levelQueueCategory(level: number): string {
  return `level:${level}`; // queue.ts'ning queueKey() funksiyasi buni "queue:level:5" kalitiga aylantiradi - queue.ts'ga tegilmaydi
}

export async function handleJoinLevelQueue(io: Server, socketId: string, userId: number, level: number): Promise<void> {
  // handleJoinQueue bilan bir xil mantiq, faqat:
  // - category o'rniga levelQueueCategory(level) navbat kaliti sifatida ishlatiladi
  // - createMatch chaqirilganda LEVEL_CATEGORY_KEY (doim 'ingliz_tili') + level uzatiladi
}
```

`createMatch()` (matchmaker.ts) ixtiyoriy `level?: number` parametr oladi, `startGame(gameId, category, player1, player2, botDisplayName, level)`ga uzatadi.

**Muhim:** `levelQueueCategory(level)` faqat navbat KALITI sifatida ishlatiladi (Redis list nomi) — bu haqiqiy `categories` jadvalidagi kategoriya emas, shuning uchun `isValidCategory()` bu yerda **chaqirilmaydi** (bosqich raqami o'rniga oddiy `Number.isInteger(level) && level >= 1` tekshiruvi bilan almashtiriladi).

## 6. Backend — o'yin mexanikasi o'zgarishi

`backend/src/game/gameState.ts`ning `GameState` interfeysiga:

```ts
export interface GameState {
  // ... mavjud maydonlar o'zgarishsiz
  level?: number; // faqat bosqichli o'yinlarda mavjud
}
```

`backend/src/game/gameEngine.ts`:

- `startGame(gameId, category, player1, player2, botDisplayName?, level?)` — agar `level` berilgan bo'lsa, `getRandomQuestions(category, 15)` o'rniga `getQuestionsForLevel(level)` chaqiriladi, va `game.level = level` saqlanadi.
- `resolveQuestion()`dagi nokaut tekshiruvi (`anyoneKnockedOut`) — `if (!game.level) { ... nokaut tekshiruvi ... }` ichiga olinadi, ya'ni **bosqichli o'yinlarda butunlay o'chiriladi**. 15-savolgacha har doim davom etadi.
- `finishGame()` — bosqichli o'yin tugaganda (`game.level` mavjud bo'lsa), har bir o'yinchi uchun:
  ```ts
  const correctCount = player.answers.filter((a) => a && a.points > 0).length;
  const stars = calculateLevelStars(correctCount); // 8+/11+/14+ -> 1/2/3, 7 va kam -> 0
  await upsertLevelProgress(player.userId, game.level, stars);
  ```
  va `game_over` hodisasiga `levelStars?: number` (shu o'yinchining o'ziga tegishli yulduz soni) qo'shiladi — har ikki o'yinchiga alohida-alohida, chunki ularning natijalari boshqa-boshqa.

`calculateLevelStars(correctCount: number): number` — yangi sof funksiya (`backend/src/game/scoring.ts` yoki alohida modul):
```ts
export function calculateLevelStars(correctCount: number): number {
  if (correctCount >= 14) return 3;
  if (correctCount >= 11) return 2;
  if (correctCount >= 8) return 1;
  return 0;
}
```

## 7. Yulduz va etap ochilish qoidalari

- Har bir bosqichda **15 ta savol**.
- Yulduzlar (6-bo'limga qarang): 0-7 to'g'ri = **0★**, 8-10 = **1★**, 11-13 = **2★**, 14-15 = **3★**.
- Bosqichlar 10 talik **etaplarga** guruhlanadi: 1-etap = 1-10-bosqich, 2-etap = 11-20-bosqich, va h.k.
- **1-bosqich doim ochiq.**
- **Etap ICHIDA** (masalan 3-bosqichdan 4-bosqichga): oldingi bosqichda **kamida 2 yulduz** kerak. 0 yoki 1 yulduz bilan keyingi bosqich ochilmaydi — foydalanuvchi shu bosqichni qayta o'ynashi kerak.
- **Etaplar ORASIDA** (masalan 10-bosqichdan 11-bosqichga): shu etapdagi 10 ta bosqichdan jami **kamida 25 yulduz** (30 tadan) kerak.
- Bosqichni **istalgancha qayta o'ynash mumkin**, har safar eng yaxshi natija (yulduz) saqlanadi (3-bo'limdagi `GREATEST` orqali).

Bu ikki qoida quyidagicha hisoblanadi (frontend `LevelSelectScreen` uchun, backend `level_progress`dan olingan ma'lumot asosida):

```ts
function isLevelUnlocked(level: number, progress: Map<number, number>): boolean {
  if (level === 1) return true;
  const isFirstOfStage = (level - 1) % 10 === 0; // 11, 21, 31...
  if (isFirstOfStage) {
    const stageStart = level - 10; // masalan level=11 -> stageStart=1
    let totalStars = 0;
    for (let i = stageStart; i < level; i += 1) {
      totalStars += progress.get(i) ?? 0;
    }
    return totalStars >= 25;
  }
  return (progress.get(level - 1) ?? 0) >= 2;
}
```

## 8. Frontend — Bosh sahifa

`frontend/src/screens/HomeScreen.tsx` — statistika/profil qismi olib tashlanadi. Faqat sarlavha + 2 tugma qoladi:

```tsx
<PrimaryButton shiny onClick={() => navigate({ name: 'levelSelect', intent: 'quick' })}>
  <Lightning/> Tezkor o'yin
</PrimaryButton>
<SecondaryButton onClick={() => navigate({ name: 'levelSelect', intent: 'invite' })}>
  <UserPlus/> Do'stni chaqirish
</SecondaryButton>
```

## 9. Frontend — yangi `LevelSelectScreen`

`frontend/src/context/NavigationContext.tsx`ning `Screen` union tipi:

```ts
export type Screen =
  | { name: 'home' }
  | { name: 'levelSelect'; intent: 'quick' | 'invite' }        // categorySelect o'rniga
  | { name: 'waiting'; level: number; intent: 'quick' | 'invite' | 'joining' }  // category -> level
  | { name: 'battle'; gameId: string; level: number }           // category -> level
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; knockout: boolean; level: number; myStars?: number } // category -> level, + myStars
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'admin' };
```

Yangi backend REST endpointi (mavjud `GET /categories`/`GET /admin/stats` naqshiga o'xshab, JWT autentifikatsiyasi bilan): `GET /level-progress` — javob: `{ progress: { levelNumber: number; stars: number }[]; maxAvailableLevel: number }`.

Yangi `frontend/src/screens/LevelSelectScreen.tsx`:
- Backend'dan `GET /level-progress` orqali foydalanuvchining barcha bosqichlardagi yulduzlarini va `maxAvailableLevel`ni yuklaydi.
- 1-dan `maxAvailableLevel()`gacha kartochkalarni render qiladi (10 talik etaplar vizual guruhlangan holda — masalan har etap orasida sarlavha "1-etap", "2-etap").
- Har bir kartochka: bosqich raqami, agar qulflangan bo'lsa — qulf belgisi va bosilmaydigan holat, agar ochiq bo'lsa — bosilishi mumkin, agar o'ynalgan bo'lsa — 0-3 yulduz ko'rsatiladi.
- Bosqich bosilganda: `intent==='quick'` — `joinLevelQueue(level)` chaqiriladi; `intent==='invite'` — `createLevelInvite(level)` chaqiriladi; ikkalasida ham `navigate({ name: 'waiting', level, intent })`.

## 10. Frontend — Waiting/Battle/Result o'zgarishlari

- `WaitingScreen.tsx`: `category`/`categoryLabel` o'rniga `level` qabul qiladi. Matn: `` `${level}-bosqich bo'yicha raqib qidirilmoqda...` `` / `` `${level}-bosqich bo'yicha taklif havolasi tayyorlanmoqda...` ``.
- `BattleScreen.tsx`: `category` prop o'rniga `level` — ichki ishlash mantig'iga (savol/javob/HP chizig'i/K.O. effekti) hech qanday ta'sir qilmaydi, faqat `result`ga o'tishda `level` uzatiladi.
- `ResultScreen.tsx`: bosqichli o'yin uchun **yangi holat** qo'shiladi — `game_over`dan kelgan `levelStars` mavjud bo'lsa, mavjud "G'alaba qozondingiz!"/"Mag'lubiyat"/"Durrang" o'rniga yulduz natijasi ko'rsatiladi (masalan "3 ta yulduzga ega bo'ldingiz!" + 1-5 yulduzli animatsiya o'rniga 1-3 yulduzli ko'rinish). Bu — mavjud HP-nokaut o'yinlarining 1-5 yulduzli (g'alaba marjinaliga asoslangan) reytingidan **butunlay boshqa** tushuncha, ikkalasi aralashtirilmaydi.

## 11. O'chiriladigan kod

- `frontend/src/screens/CategorySelectScreen.tsx` + `CategorySelectScreen.test.tsx` — to'liq o'chiriladi (hech kim navigate qilmay qoladi).
- `frontend/src/utils/category.ts`dagi `categoryLabel()` + uning testi — ishlatilmay qoladi, o'chiriladi.
- Frontend `getCategories()` funksiyasi (`frontend/src/api/questions.ts`) — faqat `CategorySelectScreen` va `QuestionImportForm` uni chaqirar edi; ikkalasi ham o'zgargach, agar hech kim chaqirmasa, o'chiriladi.
- Backenddagi `categories`/`questions` jadvallari, `isValidCategory`/`getCategoryByKey`/`createCategory` funksiyalari — **o'chirilmaydi**, chunki admin import endpointi va mavjud `join_queue`/`create_invite` ular ustiga qurilgan.

## 12. Admin panel

`frontend/src/components/QuestionImportForm.tsx`:
- Kategoriya `<select>` va "Yangi turkum" matn maydoni olib tashlanadi.
- `handleUpload`da `formData.append('category', selectedCategory)` shartli mantiqi o'rniga doim `formData.append('category', 'ingliz_tili')`.
- Backend `POST /admin/questions/import` endpointi — **o'zgarishsiz** qoladi (u allaqachon `category`/`newCategoryLabel`dan birini kutadi, frontend endi doim `category: 'ingliz_tili'` yuboradi).

## 13. Qamrov chegarasi (nima o'zgarmaydi)

- Mavjud kategoriya-asosli tezkor o'yin/taklif (`join_queue`/`create_invite`/`join_invite`, `CategorySelectScreen`ning o'rnini bosuvchi eski yo'l) — backendda ichkarida to'liq ishlaydigan holda qoladi, faqat hech qanday interfeys ularni chaqirmaydi.
- HP/nokaut mexanikasi, tortishuv chizig'i, K.O. effekti, mavjud 1-5 yulduzli natija reytingi — bularning barchasi bosqichsiz (`game.level` yo'q) o'yinlar uchun **o'zgarishsiz** ishlashda davom etadi.
- `umumiy_bilim`/`sport_kino_musiqa` kategoriyalari va ularning savollari — bazada saqlanadi, o'chirilmaydi.
- Admin statistika ekrani (`AdminScreen.tsx`) — kategoriya bo'yicha statistika hech qachon ko'rsatmagan, shuning uchun bu o'zgarishdan butunlay ta'sirlanmaydi.
- `finishGame()`ning mavjud `persistMatchResult`/`recordMatchResult` chaqiruvi (`matches` jadvaliga yozish, `users.games_played`/`games_won` oshirish) — bosqichli o'yinlar uchun ham **o'zgarishsiz** chaqiriladi (`matches.category = 'ingliz_tili'` bilan, oddiy tezkor o'yindan farqlanmaydi). Bosqichli o'yin ekanini alohida belgilash (masalan `matches.level` ustuni) — bu spec doirasida kerak emas deb topildi, `level_progress` jadvali progress uchun yetarli.

## 14. Xavf va e'tiborga oladigan narsalar

- **`OFFSET` sekinlashishi** — juda yuqori bosqich raqamlarida (~10,000+) `OFFSET` sekinroq bo'lishi mumkin (6-bo'limga qarang). Hozircha YAGNI — muammo real bo'lganda ko'rib chiqiladi.
- **Bosqich raqamining `queues.ts` kaliti sifatida ishlatilishi** — `levelQueueCategory(level)` orqali hosil qilingan `"level:5"` kabi qatorlar haqiqiy `categories` jadvali bilan hech qanday aloqasi yo'q, faqat Redis navbat kaliti sifatida ishlaydi — bu ataylab shunday, chalkashlik keltirib chiqarmaydi, lekin kodda aniq izohlanishi kerak.
- **Ikki xil "yulduz" tushunchasi** — mavjud `ResultScreen`ning HP-nokaut o'yinlaridagi 1-5 yulduzli g'alaba reytingi va bu yangi bosqichli rejimning 1-3 yulduzli shaxsiy natija reytingi **butunlay boshqa narsalar**. Kod va UI darajasida bu ikkisi aniq ajratilishi kerak (masalan alohida komponent/funksiya nomlari bilan), aralashtirilmasligi kerak.

## 15. Testlash rejasi

**Backend:**
- `getQuestionsForLevel()` — to'g'ri OFFSET hisoblanishi, turli bosqich raqamlari uchun mos 15 ta savol qaytarilishi.
- `calculateLevelStars()` — chegara qiymatlar (7→0, 8→1, 10→1, 11→2, 13→2, 14→3, 15→3).
- `upsertLevelProgress()` — birinchi marta yozish, past natija bilan qayta yozishga urinish (eskisi saqlanishi kerak), yuqori natija bilan qayta yozish (yangilanishi kerak).
- `isLevelUnlocked()` mantig'i (yoki uning backend ekvivalenti) — 1-bosqich doim ochiq, etap ichida 2+ yulduz qoidasi, etaplar orasida 25+ jami yulduz qoidasi.
- `resolveQuestion()` — `game.level` mavjud bo'lganda nokaut ishlamasligi, barcha 15 savol oxirigacha o'ynalishi.
- Yangi socket hodisalari (`join_level_queue`/`leave_level_queue`/`create_level_invite`/`join_level_invite`) — mavjud `join_queue`/`create_invite` testlariga o'xshash integratsion testlar.

**Frontend:**
- `LevelSelectScreen` — qulflangan/ochiq/yulduzli holatlar to'g'ri ko'rsatilishi.
- `WaitingScreen`/`BattleScreen` — `level` prop bilan to'g'ri ishlashi.
- `ResultScreen` — `levelStars` mavjud bo'lganda yangi yulduz-natija holati ko'rsatilishi, aks holda mavjud g'alaba/mag'lubiyat holati o'zgarishsiz qolishi.
- `QuestionImportForm` — kategoriya tanlash yo'qligi, yuklashda doim `category: 'ingliz_tili'` yuborilishi.
- `CategorySelectScreen`ning o'chirilgani — boshqa hech qanday testda unga bog'liqlik qolmaganini tasdiqlash.

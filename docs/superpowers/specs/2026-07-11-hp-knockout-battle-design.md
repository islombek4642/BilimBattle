# BilimBattle — HP/Nokaut jang mexanikasi (Design Spec)

**Sana:** 2026-07-11
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. G'oya va maqsad

Hozir 1v1 bellashuv sof "test" hissi beradi: 7 ta savol, har biriga ball (`backend/src/game/scoring.ts`ning `calculateScore()` orqali — to'g'ri javob uchun 100 baza + tezlikka qarab 100gacha bonus, noto'g'ri = 0), oxirida kim ko'p ball to'plagan bo'lsa g'olib. Maqsad — buni haqiqiy "jang" hissiga aylantirish: har ikkala o'yinchi HP (jon) bilan boshlaydi, to'g'ri javob raqibga zarba beradi, va kimningdir HP'si 0'ga tushsa o'yin **darhol** tugaydi (barcha savollarni kutmasdan) — nokaut orqali.

**Muhim kashfiyot:** HP tizimi hozirgi ball tizimidan **hosil qilinadi** (derived), alohida yangi maydon sifatida saqlanmaydi:

```
Mening HP'im     = 500 − raqibning to'plagan balli
Raqibning HP'i   = 500 − mening to'plagan ballim
```

Bu shuni anglatadiki, `frontend/src/components/BattleHeader.tsx`dagi mavjud tortishuv chizig'i formulasi (`50 + (mening ball − raqib balli)/500*50`, `MAX_SWING_POINTS = 500` bilan) **matematik jihatdan aynan HP farqiga teng** — chiziq o'zi hech qanday formula o'zgarishisiz, faqat "ball farqi" o'rniga "HP farqi" deb talqin qilinadi. Backend'da ham ball hisoblash mantig'i (`calculateScore()`) o'zgarmaydi — faqat qachon o'yin tugashini aniqlaydigan bitta yangi tekshiruv qo'shiladi.

## 2. Backend o'zgarishlari

### 2.1 Savollar puli kengaytiriladi

`backend/src/game/gameEngine.ts`dagi `QUESTIONS_PER_GAME = 7` konstantasi `15`ga oshiriladi. Bu — zaxira: agar ikkala tomon ham juda yaxshi javob berib, hech kim 500 ballga (ya'ni raqib HP'sini 0'ga) yetkaza olmasa, o'yin cheksiz davom eta olmaydi, shuning uchun savollar puli kengroq bo'lishi kerak. Amalda ko'pchilik o'yinlar bundan ancha oldin (3-5 ta to'g'ri javobdan keyin) nokaut bilan tugaydi.

**Chegara holat:** agar biror turkumda hozircha 15 tadan kam savol bo'lsa (`getRandomQuestions` so'ralgan sondan kamini qaytaradi), o'yin shunchaki mavjud savollar tugagach yakunlanadi — bu allaqachon ishlaydigan `sendNextQuestion`ning `currentQuestionIndex >= game.questions.length` tekshiruvi orqali, qo'shimcha kod kerak emas.

### 2.2 Nokaut tekshiruvi

`resolveQuestion()` funksiyasida (`gameEngine.ts`), `question_result` yuborilgandan keyin, hozirgi kodda so'zsiz `await sendNextQuestion(gameId);` chaqiriladi. Bu quyidagicha o'zgaradi:

```ts
const HP_MAX = 500;

// ...question_result emit qilingandan keyin, sendNextQuestion o'rniga:
const knockedOutPlayer = game.players.find((p) => p.score >= HP_MAX);
if (knockedOutPlayer) {
  await finishGame(gameId, { knockout: true });
  return;
}
if (env.resultRevealMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, env.resultRevealMs));
}
await sendNextQuestion(gameId);
```

`p.score >= HP_MAX` sharti — "shu o'yinchi raqibiga yetarlicha zarba berdi, raqibning HP'i 0'ga tushdi" degani (chunki raqibning HP'i = `500 − p.score`).

**Ikkala tomon ham bir vaqtda 500'ga yetsa (ikkalasi ham shu savolga to'g'ri javob bergan holatda):** `finishGame()`ning mavjud g'olib aniqlash mantig'i (`p1.score === p2.score ? null : p1.score > p2.score ? ...`) o'zgarishsiz qo'llaniladi — kim ko'proq ball to'plagan bo'lsa (ya'ni raqibiga "chuqurroq" zarba bergan bo'lsa) o'sha g'olib, ballar teng bo'lsa durrang. Alohida yangi mantiq kerak emas.

**Zaxira holat (15 savolgacha hech kim nokaut bo'lmasa):** `sendNextQuestion`ning mavjud `currentQuestionIndex >= game.questions.length` tekshiruvi ishlab, oddiy `finishGame(gameId)` (nokautsiz) chaqiriladi — bu holatda ham xuddi hozirgidek, kim ko'p ball to'plagan (ya'ni HP'i ko'proq qolgan) bo'lsa g'olib bo'ladi.

### 2.3 `finishGame()`ga `knockout` bayrog'i qo'shiladi

`finishGame(gameId: string, opts?: { knockout?: boolean })` — ikkinchi, ixtiyoriy parametr qo'shiladi. `game_over` socket hodisasiga `knockout: opts?.knockout ?? false` maydoni qo'shiladi:

```ts
getIO().to(gameId).emit('game_over', {
  scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
  winnerId,
  knockout: opts?.knockout ?? false,
});
```

Bu — frontendga "o'yin nokaut orqali tugadimi (barcha savollar tugamasdan) yoki oddiy tarzda tugadimi" farqini bildirish uchun, maxsus "K.O.!" animatsiyasini faqat haqiqiy nokaut holatida ko'rsatish uchun kerak. `forfeitIfStillDisconnected()`dagi `finishGame` chaqiruvi (raqib chiqib ketgan holat) `knockout` parametrisiz qoladi (default `false`) — bu haqiqiy jang orqali nokaut emas.

## 3. Frontend — jang ekrani (BattleScreen/BattleHeader)

### 3.1 Tortishuv chizig'i — formula o'zgarmaydi

`BattleHeader.tsx`dagi hisoblash (`rawPosition = 50 + (myScore - opponentScore) / MAX_SWING_POINTS * 50`) **aynan hozirgidek qoladi** — 1-bo'limda ko'rsatilganidek, bu allaqachon HP farqiga matematik teng.

### 3.2 Zarba effektlari

Har safar yangi `question_result` kelganda (savol hal qilinganda), oldingi va yangi `scores`ni solishtirib, kimning balli oshganini aniqlaydi (mumkin: faqat men, faqat raqib, ikkalamiz ham bir vaqtda — ikkala tomon ham shu savolga to'g'ri javob bergan bo'lsa). Ball oshgan HAR BIR tomon uchun, ALOHIDA-ALOHIDA quyidagi effektlar ishga tushadi (agar ikkalamiz ham to'g'ri javob bergan bo'lsak, ikkala tomon effekti ham bir vaqtda, mustaqil ko'rsatiladi):

- **Zarba raqami**: zarba yegan tomonning ustida qisqa muddat (~0.8s) "−150" kabi raqam paydo bo'lib, biroz yuqoriga siljib, xira bo'lib yo'qoladi (CSS animatsiya, Tailwind `@theme`ga yangi `--animate-damage-pop` keyframe qo'shiladi, xuddi mavjud `--animate-vs-reveal` naqshiga o'xshab).
- **Chiziq "sakrashi"**: chiziq holatini yangilaydigan `transition-all duration-300` o'rniga, yangi pozitsiyaga o'tishda qisqa "overshoot" effekti (masalan `cubic-bezier` bilan biroz oshib tushish) qo'shiladi — silliq emas, "urilish" hissi bilan.
- **Ekran titrashi**: shu savolda berilgan zarba miqdori 150 balldan ko'p bo'lsa (ya'ni tezkor to'g'ri javob), butun jang ekraniga juda qisqa (~150ms) va kichik amplitudali "shake" animatsiyasi qo'shiladi. 150 va undan kam bo'lsa (sekinroq to'g'ri javob), faqat yuqoridagi ikkita effekt (raqam + chiziq sakrashi) ko'rsatiladi, ekran titramaydi.

### 3.3 Nokaut animatsiyasi

`gameOver.knockout === true` bo'lsa, `BattleScreen.tsx` "result" ekraniga o'tishdan oldin (yoki o'tish paytida) qisqa (~1s) "K.O.!" matnli overlay animatsiyasini ko'rsatadi (katta, urg'uli matn, markazda paydo bo'lib kattalashadigan/miltillovchi effekt bilan) — xuddi `WaitingScreen`dagi "VS" reveal effektiga o'xshash naqsh, lekin "K.O.!" matni bilan.

## 4. Frontend — natija ekrani (ResultScreen)

### 4.1 Yulduz reytingi

G'olib (`isWinner === true` VA `forfeited === false`) uchun, qolgan HP foiziga qarab 1-5 yulduz ko'rsatiladi:

```ts
function calculateStars(winnerScore: number, loserScore: number): number {
  const remainingHpPct = Math.max(0, (500 - loserScore) / 500) * 100;
  if (remainingHpPct >= 80) return 5;
  if (remainingHpPct >= 60) return 4;
  if (remainingHpPct >= 40) return 3;
  if (remainingHpPct >= 20) return 2;
  return 1;
}
```

(`loserScore` — g'olibning RAQIBI to'plagan ball, `findOpponentScore(scores, user.id)` orqali olinadi — bu allaqachon `frontend/src/utils/score.ts`da mavjud.)

Yulduzlar natija kartochkasida, "G'alaba qozondingiz!" matnidan pastda, birin-ketin (har biri ~0.15s farq bilan) kattalashib-kichrayib joyiga tushadigan animatsiya bilan paydo bo'ladi.

**Yulduz ko'rsatilmaydigan holatlar:**
- Mag'lub bo'lgan o'yinchi (`isWinner === false`) — yulduz umuman ko'rsatilmaydi, faqat hozirgidek "Mag'lubiyat" matni.
- Durrang (`isDraw === true`) — yulduz yo'q.
- Raqib chiqib ketgani sababli g'alaba (`forfeited === true`) — yulduz yo'q, chunki bu haqiqiy jang natijasi emas.

### 4.2 Ma'lumot oqimi

`knockout` maydoni `game_over` hodisasidan (2.3-bo'lim) `frontend/src/socket/useGameSocket.ts`ning `GameOverPayload` interfeysiga (`knockout?: boolean`), so'ng `BattleScreen.tsx`ning `result` ekraniga o'tish chaqiruviga (`replace({name: 'result', ..., knockout: gameOver.knockout ?? false})`), so'ng `frontend/src/context/NavigationContext.tsx`ning `result` ekran turiga (`knockout: boolean` maydoni qo'shiladi) orqali oqadi. `ResultScreen.tsx` bu maydonni faqat 3.3-bandidagi effekt allaqachon `BattleScreen`da ko'rsatilganini bilish uchun emas, balki agar kerak bo'lsa kelajakda foydalanish uchun qabul qiladi (hozircha faqat yulduz hisoblashda ishlatilmaydi, chunki yulduz hisoblash `forfeited`ga bog'liq, `knockout`ga emas).

## 5. Qamrov chegarasi (nima o'zgarmaydi)

- Ball hisoblash formulasi (`calculateScore()`) — o'zgarmaydi.
- Reyting/ELO, g'alaba/mag'lubiyat statistikasi, `matches` jadvaliga yozish mantig'i — o'zgarmaydi (g'olib aniqlash mantig'i bir xil qoladi, faqat QACHON chaqirilishi o'zgaradi).
- Tortishuv chizig'ining formulasi — o'zgarmaydi (1-bo'limda ko'rsatilganidek, allaqachon to'g'ri).
- Reconnect/forfeit mantig'i — o'zgarmaydi, faqat `finishGame`ga yangi ixtiyoriy parametr qo'shiladi (mavjud chaqiruvlar `undefined`/`{}` bilan ishlaydi, ya'ni `knockout: false`).

## 6. Testlash rejasi

**Backend:**
- `resolveQuestion()`/`finishGame()`: bir o'yinchi ball 500'ga yetganda o'yin darhol tugashi (savollar tugamasdan), `game_over`da `knockout: true` kelishi
- Ikkala o'yinchi ham bir vaqtda 500'dan oshsa, ko'proq ball to'plagan g'olib bo'lishi (yoki teng bo'lsa durrang)
- Hech kim 500'ga yetmasa, savollar puli tugagach (15 yoki kategoriyada mavjud bo'lgan barcha savollar), oddiy tarzda tugashi, `knockout: false`
- Forfeit orqali tugagan o'yin `knockout: false` bilan kelishi (mavjud xatti-harakat o'zgarmasligini tasdiqlash)

**Frontend:**
- `BattleHeader.tsx`: zarba effekti (raqam, chiziq animatsiyasi) to'g'ri hodisalarda ishga tushishi
- `ResultScreen.tsx`: `calculateStars()` funksiyasi turli HP foizlari uchun to'g'ri yulduz sonini qaytarishi (chegara qiymatlar: 79%→4, 80%→5 va h.k.); mag'lubiyat/durrang/forfeit holatlarida yulduz ko'rsatilmasligi
- `NavigationContext`/`BattleScreen`: `knockout` maydoni to'g'ri o'tkazilishi

# BilimBattle — Raqib ko'rinishi va "TikTok battle" uslubidagi Bellashuv dizayni (Design Spec)

**Sana:** 2026-07-09
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. G'oya va maqsad

Hozir `match_found` hodisasi faqat `{gameId, category}` yuboradi — 1v1 bellashuvda kim bilan o'ynayotganini hech kim bilmaydi. Bu ijtimoiy/musobaqa hissini kamaytiradi. Maqsad: raqibning ismi va profil rasmini ko'rsatish, va bellashuv ekranini "TikTok battle" uslubidagi tortishuv (tug-of-war) paneliga aylantirish — bu foydalanuvchini ko'proq band qiladi va musobaqa hissini kuchaytiradi.

**Muhim biznes qarori:** bot bilan o'ynalganda ham foydalanuvchi buni sezmasligi kerak (aks holda "foydalanuvchilar kam ekan" degan taassurot qoladi) — bot tasodifiy o'zbekcha ism bilan, haqiqiy raqibdek ko'rsatiladi.

## 2. Backend o'zgarishlari

### 2.1 `match_found` va `reconnect_game` javoblariga `opponent` maydoni qo'shish

`backend/src/matchmaking/matchmaker.ts`ning `createMatch` funksiyasi endi har bir o'yinchiga **ikkinchisining** ma'lumotini yuboradi:

```ts
interface OpponentInfo {
  telegramId: number;
  firstName: string;
}
```

`match_found` payload'i: `{ gameId, category, opponent: OpponentInfo }` — har bir socket o'ziga mos (qarama-qarshi tomonning) `opponent` obyektini oladi.

**Qayta ulanish (reconnect) holati:** `socketServer.ts`dagi `reconnect_game` handler ham xuddi shu `opponent` maydonini javobga qo'shishi kerak — aks holda internetni yo'qotib qayta ulangan o'yinchi raqib panelini yo'qotib qo'yadi. Bu ma'lumot `GameState`da saqlangan `game.players` ro'yxatidan (userId → users jadvalidan telegramId/firstName) olinadi.

### 2.2 Bot uchun tasodifiy o'zbekcha ism

`backend/src/matchmaking/matchmaker.ts`ga ism ro'yxati qo'shiladi:

```ts
const BOT_DISPLAY_NAMES = [
  'Aziz', 'Malika', 'Sardor', 'Dilnoza', 'Jasur', 'Nodira', 'Bekzod',
  'Zarina', 'Otabek', 'Madina', 'Sherzod', 'Gulnora', 'Farrux', 'Shahnoza',
  'Ulug\'bek',
];

function pickRandomBotDisplayName(): string {
  return BOT_DISPLAY_NAMES[Math.floor(Math.random() * BOT_DISPLAY_NAMES.length)];
}
```

Bot bilan o'yin yaratilganda (`createMatch`ning bot-fallback chaqiruvida), bazadagi haqiqiy bot foydalanuvchisining `firstName`i ("Bot") o'rniga, shu funksiya orqali tanlangan tasodifiy ism `opponent.firstName` sifatida yuboriladi. Bazadagi `users` jadvalidagi bot qatori **o'zgarmaydi** — bu faqat taqdimot (presentation) qatlamidagi almashtirish, chunki `matches` jadvali FK cheklovi uchun barqaror bot foydalanuvchi qatori hali ham kerak.

### 2.3 Profil rasmini olish — `GET /api/users/:telegramId/avatar`

Yangi marshrut, `requireAuth` bilan himoyalangan (faqat tizimga kirgan foydalanuvchilar so'rashi mumkin, ammo istalgan `telegramId` uchun — chunki bu raqibning ochiq profil rasmi, maxfiy ma'lumot emas).

**Ishlash tartibi:**
1. Redis'dan keshlangan rasm bor-yo'qligini tekshiradi (kalit: `avatar:<telegramId>`, TTL: 24 soat).
2. Kesh bo'lmasa, Telegram Bot API'ga ikkita chaqiruv qiladi: `getUserProfilePhotos(telegramId)` → birinchi rasmning `file_id`si → `getFile(file_id)` → `file_path`.
3. `https://api.telegram.org/file/bot<TOKEN>/<file_path>` orqali rasm baytlarini serverning o'zi yuklab oladi (Node 20'ning o'rnatilgan `fetch()`i bilan — yangi kutubxona kerak emas) va **javobni to'g'ridan-to'g'ri clientga oqim sifatida uzatadi** (proxy qiladi).
4. **Xavfsizlik uchun muhim:** frontend hech qachon Telegram fayl havolasiga yo'naltirilmaydi (redirect qilinmaydi) — chunki bu havolada bot tokenimiz ochiq ko'rinadi. Rasm faqat serverimiz orqali oqim sifatida uzatiladi.
5. Muvaffaqiyatli bo'lsa: rasm baytlari + `Content-Type` sarlavhasi bilan qaytariladi, va shu bayt Redis'ga ham keshlanadi.
6. Har qanday muvaffaqiyatsizlik (rasm yo'q, Telegram API xato qaytardi, `telegramId=0` — bot) — barchasi bir xil **404** sifatida qaytariladi. Frontend bu holatlarni farqlashi shart emas.

## 3. Frontend o'zgarishlari

### 3.1 `GameSocketContext` — `opponent` ma'lumotini saqlash

`useGameSocket` hook'i `match_found` va `reconnect_game` hodisalaridan kelgan `opponent: {telegramId, firstName}`ni state sifatida saqlaydi va context orqali `WaitingScreen` va `BattleScreen`ga uzatadi (bu ekranlar orasida context saqlanib turishi mavjud arxitektura tufayli avtomatik ishlaydi — `NavigationContext`dan yuqorida joylashgan).

### 3.2 "VS" ko'rinishi — `WaitingScreen`da

`matchFound` (va tegishli `opponent`) kelganda, `WaitingScreen` darhol `battle` ekraniga o'tkazish o'rniga, ~1.5–2 soniyaga quyidagi ko'rinishni ko'rsatadi:

- Chapda siz (ko'k doira, ism, avatar), o'ngda raqib (qizil doira, ism, avatar), o'rtada katta **"VS"** yozuvi.
- Vaqt tugagach, avtomatik `replace({ name: 'battle', gameId })` chaqiriladi.
- Alohida yangi `Screen` turi kerak emas — bu `WaitingScreen`ning o'zida `setTimeout` bilan boshqariladigan vaqtinchalik ko'rinish holati.

### 3.3 Yangi komponent: tortishuv paneli (`BattleHeader`)

`BattleScreen`dagi hozirgi `ScoreBar` o'rnini oladi (BattleScreen ichida). Ko'rinishi:

- Chap chetda: sizning doira-avataringiz va ismingiz (ko'k fon/chegara)
- O'ng chetda: raqib doira-avatari va ismi (qizil fon/chegara)
- O'rtada: gorizontal chiziq, pozitsiyasi formula bilan hisoblanadi:

```
position% = clamp(50 + (mening_ballim - raqib_balli) / 500 * 50, 0, 100)
```

(500 ball farqida chiziq to'liq bir chetga suriladi; bu qiymat keyinroq sozlanishi mumkin, hozircha sodda va tushunarli boshlang'ich nuqta sifatida tanlandi.)

### 3.4 Avatar yuklash va zaxira (fallback)

Har bir avatar oddiy `<img src="/api/users/{telegramId}/avatar">` orqali ko'rsatiladi. `onError` hodisasida (404 yoki tarmoq xatosi) — standart, jinssiz "foydalanuvchi" ikonkasi ko'rsatiladi (yangi rasm fayli sifatida qo'shiladi, tashqi manbadan emas — oddiy SVG). Bot uchun bu avtomatik ishlaydi, chunki backend bot uchun ham 404 qaytaradi — maxsus holatga ehtiyoj yo'q.

## 4. Ma'lumotlar oqimi (yangilangan)

1. Ikkala o'yinchi navbatga qo'shiladi → juftlashadi (yoki 15 soniyadan keyin bot bilan juftlashadi, soxta ism bilan)
2. `match_found` ikkalasiga ham `opponent` ma'lumoti bilan yuboriladi
3. `WaitingScreen` "VS" ko'rinishini ko'rsatadi (~1.5-2s) → `battle` ekraniga o'tadi
4. `BattleScreen`da `BattleHeader` doimiy ko'rinadi, ball o'zgarishi bilan chiziq animatsiyali suriladi
5. Agar aloqa uzilib qayta ulansa, `reconnect_game` javobi `opponent`ni qayta beradi — panel yo'qolmaydi

## 5. Xatoliklarni boshqarish

- Rasm yuklanmasa → standart avatar (frontend, `onError`)
- Telegram API xatosi/vaqt tugashi → backend 404 (client uchun "rasm yo'q" bilan bir xil)
- Bot ismi tasodifiy tanlanadi — ketma-ket bir xil ism chiqishi mumkin, past xavf, cheklanmaydi
- Qayta ulanishda `opponent` ma'lumoti yo'qolmasligi uchun `reconnect_game` javobiga ham qo'shiladi

## 6. Testlash

**Backend:**
- `matchmaker.test.ts`: `match_found`/`createMatch` natijasida `opponent` maydoni to'g'ri kelishini tekshirish (ikkala tomon uchun ham)
- Bot ismi: `BOT_DISPLAY_NAMES` ro'yxatidan tanlanganini, hech qachon "Bot" chiqmasligini tekshirish
- `reconnect_game` javobida `opponent` borligini tekshirish
- Avatar endpoint: Telegram API `global.fetch`ni mock qilib — muvaffaqiyatli holat (rasm bayt oqimi + kesh), 404 holatlari (rasm yo'q, API xato, telegramId=0)
- Redis keshlash: ikkinchi so'rovda Telegram API qayta chaqirilmasligini tekshirish

**Frontend:**
- `BattleHeader` komponenti: turli ball kombinatsiyalarida chiziq pozitsiyasi to'g'ri hisoblanishi (0%, 50%, 100% chegaralarda ham)
- Avatar `onError` — standart ikonkaga almashishi
- `WaitingScreen`: "VS" ko'rinishi soxta taymer (`vi.useFakeTimers`) bilan to'g'ri vaqtda `battle`ga o'tishi
- `GameSocketContext`/`useGameSocket`: `opponent` ma'lumoti to'g'ri saqlanishi va uzatilishi

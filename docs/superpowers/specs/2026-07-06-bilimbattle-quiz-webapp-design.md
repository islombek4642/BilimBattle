# BilimBattle — Telegram WebApp Viktorina O'yini (Design Spec)

**Sana:** 2026-07-06
**Holat:** Loyihalash bosqichi (MVP uchun tasdiqlangan)

## 1. G'oya va maqsad

Telegram Mini App (WebApp) ko'rinishida ishlaydigan, do'stlar va tasodifiy raqiblar bilan **real vaqtda 1v1 viktorina bellashuvi** o'yini. Foydalanuvchilar savol-javob orqali bellashadi, ball to'playdi va reyting jadvalida raqobatlashadi.

**Startup gipotezasi (MVP nima isbotlashi kerak):** odamlar bu o'yinni qayta-qayta o'ynaydimi va do'stlariga ulashadimi (retention + viral coefficient). Shu sababli MVP monetizatsiyasiz, faqat asosiy o'yin siklini tekshirishga qaratilgan (1-yondashuv: Lean MVP).

## 2. Auditoriya va kontent

- Kategoriyalar (MVP): **Umumiy bilim**, **Sport/Kino/Musiqa**
- Kelajakda qo'shiladi (v2): **Fanlar/DTM tayyorgarlik** (ta'lim yo'nalishi), Premium obuna
- Til: O'zbek (asosiy), keyinchalik Rus/Ingliz qo'shilishi mumkin

## 3. Arxitektura va texnologiyalar

| Qatlam | Texnologiya | Vazifasi |
|---|---|---|
| Frontend | Telegram Mini App — React + Telegram WebApp SDK | UI, Telegram autentifikatsiyasi, ulashish, tema |
| Backend API | Node.js (Express/Fastify) | Savollar, profil, reyting uchun REST API |
| Real-time | WebSocket (Socket.io) | 1v1 jonli bellashuv — savol yuborish, javob qabul qilish, taymer sinxronizatsiyasi |
| Ma'lumotlar bazasi | PostgreSQL | Foydalanuvchilar, savollar banki, o'yin tarixi, reyting |
| Tezkor xotira | Redis | Matchmaking navbati, faol o'yin holati |
| Telegram Bot | Bot API | Autentifikatsiya, do'stni taklif qilish uchun deep link (`t.me/bot?startapp=invite_XYZ`) |

**Asosiy tanlov sababi:** real vaqtli 1v1 bellashuv aniq va tez javob talab qiladi — WebSocket + Redis kombinatsiyasi navbat va o'yin holatini tez boshqarish uchun mos. PostgreSQL doimiy saqlanadigan ma'lumotlar uchun ishlatiladi.

## 4. Ekranlar va komponentlar

1. **Bosh ekran** — foydalanuvchi ismi/avatari (Telegramdan), reyting o'rni, "Tezkor o'yin" va "Do'stni chaqirish" tugmalari
2. **Kategoriya tanlash** — MVP: 2 ta kategoriya
3. **Kutish ekrani (matchmaking)** — raqib qidirilmoqda animatsiyasi, ~15 soniya kutish
4. **Bellashuv ekrani** — savol, 4 variant, server-side taymer (10 soniya/savol), ikkala o'yinchining progress-bari
5. **Natija ekrani** — g'olib e'loni, ball taqsimoti (to'g'rilik + tezlik bonusi), "Yana o'ynash"/"Do'stga ulashish"
6. **Reyting jadvali** — O'zbekiston bo'yicha TOP-100 va do'stlar orasidagi reyting
7. **Sozlamalar/Profil** (minimal) — til, ovoz/vibratsiya yoqish-o'chirish, statistika (o'ynagan o'yinlar, g'alaba %, eng uzun seriya)

**Muhim mantiq:** WebSocket ulanishi faqat "Kutish" va "Bellashuv" ekranlarida faol. Savollar oldindan clientga yuklanmaydi — har bir savol serverdan real vaqtda, faqat savol matni va variantlar bilan yuboriladi (to'g'ri javob client kodida bo'lmasligi kerak).

## 5. Ma'lumotlar oqimi (foydalanuvchi yo'li)

1. Foydalanuvchi Telegram botdan WebApp'ni ochadi → `initData` backend tomonidan tekshiriladi va tasdiqlanadi
2. Kategoriya tanlaydi → "Tezkor o'yin" bosadi → Redis navbatiga qo'shiladi
3. Mos raqib topilsa (yoki ~15 soniyada topilmasa, bot-raqib taklif qilinadi) → WebSocket orqali ikkalasi uchun o'yin xonasi ochiladi
4. Server har bir savolni ikkalasiga bir vaqtda yuboradi, taymerni serverda hisoblaydi
5. Javob kelganda server to'g'riligini va javob tezligini tekshiradi → ball beriladi
6. 7 ta savol tugagach → g'olib e'lon qilinadi, natija PostgreSQL'ga yoziladi, reyting yangilanadi

**Do'stni taklif qilish oqimi:** "Do'stga ulashish" → Telegram native share dialogi → `t.me/bot?startapp=invite_XYZ` link → do'sti linkni bossa, navbatga tushmasdan bevosita o'sha kishi bilan bellashuvga tushadi.

## 6. Xatoliklarni boshqarish

- **Ulanish uzilishi:** 10 soniyalik qayta ulanish imkoniyati; qaytmasa avtomatik mag'lubiyat
- **Raqib topilmasa:** 15 soniyadan keyin bot-raqib taklif qilinadi (foydalanuvchi cheksiz kutmaydi)
- **Aldashning oldini olish:** to'g'ri javob hech qachon clientga yuborilmaydi; to'g'rilik va vaqt butunlay serverda hisoblanadi
- **Qayta javob yuborish:** server faqat birinchi javobni qabul qiladi
- **Bir nechta qurilma:** bir foydalanuvchi bir vaqtda faqat bitta faol sessiyada bo'la oladi (yangi qurilmadan kirsa, eskisi uzitiladi)

## 7. Testlash strategiyasi

- **Unit testlar:** ball hisoblash formulasi (to'g'rilik + tezlik bonusi), savol tanlash mantiqi
- **Integratsion testlar:** matchmaking navbati, WebSocket xona yaratish/yopish, reconnect stsenariylari
- **Yuklama testi:** 500–1000 bir vaqtdagi real-time ulanishlarda server barqarorligi
- **Qo'lda QA:** Telegram WebApp'ni iOS, Android, Desktop klientlarida real qurilmada sinash

## 8. MVP doirasi

**Kiradi:**
- 2 kategoriya (Umumiy bilim, Sport/Kino/Musiqa)
- Real-time 1v1 bellashuv
- Random matchmaking + do'stni to'g'ridan-to'g'ri chaqirish
- Reyting jadvali (umumiy + do'stlar orasida)
- Asosiy statistika va minimal sozlamalar

**Kirmaydi (keyingi versiyalarga qoldiriladi):**
- Fanlar/DTM ta'lim kategoriyasi
- Premium obuna (oyiga ~15,000 so'm, cheksiz o'yin, reklamasiz, to'liq DTM banki)
- Guruh/turnir rejimi
- Reklama orqali monetizatsiya

## 9. Ko'rib chiqilgan, lekin rad etilgan yondashuvlar

- **To'liq funksional lansing** (barcha kategoriya + Premium kunidan boshlab): rad etildi, chunki DTM savollar bankini tayyorlash katta mehnat/vaqt talab qiladi va lansingni kechiktiradi
- **Ta'lim-fokusli tor start** (faqat DTM/ta'lim): rad etildi, chunki boshlang'ich bozor torroq; umumiy auditoriya bilan boshlab, keyin ta'lim yo'nalishini kengaytirish afzal ko'rildi
- **Navbat bilan (asinxron) o'yin rejimi**: rad etildi, foydalanuvchi real vaqtli "jonli bellashuv" hissini afzal ko'rdi

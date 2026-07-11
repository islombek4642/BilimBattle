# BilimBattle — Pastki navigatsiyani scroll paytida qat'iy joyida ushlab turish (Design Spec)

**Sana:** 2026-07-11
**Holat:** Loyihalash bosqichi (tasdiqlangan, amalga oshirishga tayyor)

## 1. Muammo

`frontend/src/App.tsx`dagi `AppShell` komponenti asosiy konteynerni `min-h-dvh flex flex-col justify-between` sifatida quradi, kontent (`<Router />`) va `<BottomNav />` shu bitta flex ustunining ikkita farzandi. Kontent balandligi ekran balandligidan oshib ketganda (masalan, Reyting ro'yxati uzun bo'lganda), butun `min-h-dvh` konteyner ekrandan balandroq bo'lib qoladi va alohida scroll zonasi yo'qligi sababli **butun sahifa** (brauzer/WebView darajasida) scroll qilinadi — bu esa `BottomNav`ni ham kontent bilan birga yuqoriga-pastga siljitadi, garchi u doimiy (fixed) ko'rinishda turishi kerak bo'lsa ham.

## 2. Yechim

Standart "app shell" naqshi qo'llaniladi: tashqi qobiq qat'iy balandlikka ega bo'ladi va hech qachon o'zi scroll bo'lmaydi; faqat kontent qismi ichki scroll qiladi.

`frontend/src/App.tsx`dagi `AppShell`ning oxirgi `return` bloki:

```tsx
return (
  <div className="flex min-h-dvh flex-col justify-between bg-ios-bg">
    <div className="flex-1">
      <Router />
    </div>
    {showBottomNav && <BottomNav />}
  </div>
);
```

quyidagicha o'zgaradi:

```tsx
return (
  <div className="flex h-dvh flex-col overflow-hidden bg-ios-bg">
    <div className="flex-1 overflow-y-auto">
      <Router />
    </div>
    {showBottomNav && <BottomNav />}
  </div>
);
```

Aniq o'zgarishlar:
- `min-h-dvh` → `h-dvh`: konteyner balandligi endi **qat'iy** ekran balandligiga teng (minimal emas) — hech qachon undan katta bo'lmaydi.
- Tashqi konteynerga `overflow-hidden` qo'shiladi — butun sahifa hech qachon o'zi scroll bo'lmasligini kafolatlaydi.
- `justify-between` olib tashlanadi — endi kerak emas, chunki balandlik qat'iy belgilangan va `BottomNav` allaqachon flex oqimida kontentdan keyin joylashgan.
- Kontent o'ragichiga (`<div className="flex-1">`) `overflow-y-auto` qo'shiladi — endi FAQAT shu qism o'z ichida scroll qiladi, `BottomNav`ga ta'sir qilmaydi.

## 3. Qamrov chegarasi

Bu o'zgarish faqat `frontend/src/App.tsx`ga tegishli. Boshqa hech qanday ekran yoki komponent o'zgarmaydi — `BottomNav`, `HomeScreen`, `LeaderboardScreen`, `SettingsScreen` va boshqalarning o'z ichki JSX/stillari o'zgarishsiz qoladi, chunki muammo ularning ichida emas, ularni o'rab turgan tashqi qobiqda edi.

`showBottomNav` bo'lmagan ekranlarda (masalan `waiting`, `battle`, `result` — bularda pastki navigatsiya ko'rsatilmaydi) xatti-harakat allaqachon to'g'ri edi va o'zgarmaydi, chunki ular allaqachon o'zlarining `min-h-dvh`ga ega alohida to'liq ekranli JSX'larini chizadi (masalan `WaitingScreen`, `BattleScreen`) — ular bevosita bu umumiy qobiqning ichki scroll xatti-harakatiga bog'liq emas.

## 4. Testlash

Bu sof CSS/struktura o'zgarishi bo'lib, mavjud avtomatlashtirilgan testlar (React Testing Library) scroll xatti-harakatini haqiqiy brauzer render qilmasdan tekshira olmaydi (jsdom haqiqiy scroll/layout hisoblamaydi). Shuning uchun:

- Mavjud `frontend/src/App.test.tsx` className/struktura bo'yicha assertsiyalar qilmaydi (tekshirib ko'rildi), shuning uchun bu o'zgarishdan buzilishi kutilmaydi — baribir to'liq frontend test to'plami ishga tushiriladi (`npx vitest run`) regressiya yo'qligini tasdiqlash uchun.
- Vizual tasdiqlash: brauzerda (yoki mahalliy preview orqali) uzun kontentli ekranda (masalan, ko'p foydalanuvchili Reyting) qo'lda scroll qilib, `BottomNav`ning haqiqatan ham qat'iy joyida qolishini ko'zdan kechirish.

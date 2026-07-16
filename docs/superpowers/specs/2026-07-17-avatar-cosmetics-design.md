# Avatar Kosmetikasi (Liga Ramkasi + Unvon) — Dizayn Spetsifikatsiyasi

**Sana:** 2026-07-17
**Maqsad:** Auditda (`bilimbattle_audit_javob.txt`, 5-qism, "Avatar System — o'yin-ichi avatar customization (ramka, unvon/badge)") va 6-qismda ("Liga progressiyasi vizuali — ... har birining o'ziga xos rang gradienti") tavsiya etilgan kosmetik moslashtirishni amalga oshirish — foydalanuvchining joriy Liga darajasi avatar atrofidagi rangli ramka orqali, Mastery Rank esa mavjud `MasteryBadge` matni orqali ko'rsatiladi.

## Ko'lam

**Kiradi:** 7 ta Liga darajasi (Bronza/Kumush/Oltin/Platina/Olmos/Usta/Chempion) uchun rangli avatar ramkasi (`BattleAvatar`ning mavjud `borderColorClass` prop'idan foydalanib), `ProfileScreen`/`HomeScreen`/`SettingsScreen`da qo'llanilishi; mavjud `MasteryBadge` komponentining `HomeScreen`/`SettingsScreen`ga qo'shilishi (ProfileScreen'da allaqachon bor).

**Kirmaydi:** Foydalanuvchi TANLAY oladigan ramka/unvon inventarizatsiyasi (bu — Shop/Inventory tizimi, auditning "SHART EMAS" bandida ataylab rad etilgan), `WaitingScreen`/`BattleHeader`/`LeaderboardScreen`ga o'zgarish (quyida asoslanadi), yangi DB jadvali yoki ustun (hammasi mavjud `user_league.tier`/`profile.masteryRank`dan hisoblanadi — bu doim JORIY holatni aks ettiradi, "egallab olingan" narsa emas).

## Nega `WaitingScreen`/`BattleHeader`/`LeaderboardScreen` chiqarib tashlangan

`BattleAvatar`ning `borderColorClass` prop'i bu uchta ekranda ALLAQACHON boshqa semantik maqsadda ishlatiladi:
- `WaitingScreen.tsx:130,135` va `BattleHeader.tsx:90,95` — "siz" (`border-ios-blue`) va "raqib" (`border-ios-red`) ni farqlash uchun.
- `LeaderboardScreen.tsx:31` — podium o'rni (`style.ringClass`, oltin/kumush/bronza) uchun.

Liga ramkasini shu yerlarga qo'shish ikki muammoni keltirib chiqaradi: (1) mavjud semantikani buzadi (masalan, raqibning haqiqiy Liga darajasi ma'lumoti frontend'da yo'q — bu qo'shimcha backend ishi talab qiladi, ko'lamdan tashqarida), (2) LeaderboardScreen'ning Global/Do'stlar varag'idagi yozuvlar strukturasida `tier` maydoni umuman yo'q.

## Ramka rang xaritasi

| Liga | Tailwind klassi | Izoh |
|---|---|---|
| Bronza | `border-ios-bronze` | mavjud token qayta ishlatiladi |
| Kumush | `border-ios-silver` | mavjud token qayta ishlatiladi |
| Oltin | `border-ios-gold` | mavjud token qayta ishlatiladi |
| Platina | `border-league-platinum` | YANGI token, `#7FDBDA` (auditning 7.1-qismida taklif qilingan qiymat) |
| Olmos | `border-league-diamond` | YANGI token, `#B983FF` (auditning 7.1-qismida taklif qilingan qiymat) |
| Usta | `border-league-master` | YANGI token, `#C026D3` (to'q fuksiya/magenta — Olmosdan keyingi, Chempiondan oldingi bosqich; dastlab tanlangan to'q qizil `#E63946` mavjud `--color-ios-red` (#ff3b30)ga juda yaqin bo'lib chiqdi — kod ko'rikida topildi va almashtirildi, chunki bu ranglar avatar ramkasi hajmida "raqib/xato" belgisi bilan chalkashib ketishi mumkin edi) |
| Chempion | `border-ios-gold` + porlash (`shadow-[0_0_12px_rgba(255,192,46,0.6)]`) | Oltin bilan BIR XIL rang, lekin porlaydi — `MasteryBadge`ning "Professor" darajasidagi xuddi shu naqsh (`shadow-[0_0_12px_rgba(255,192,46,0.5)]`) qayta ishlatiladi, eng yuqori bosqich "oltindan ham porloqroq" degan ma'noni beradi |

`frontend/src/index.css`ga 2 ta yangi CSS custom property qo'shiladi: `--color-league-platinum: #7FDBDA;` va `--color-league-diamond: #B983FF;` va `--color-league-master: #E63946;` (Tailwind v4 bu qiymatlardan avtomatik `border-league-platinum` va h.k. utility klasslarini generatsiya qiladi, xuddi mavjud `--color-ios-*` tokenlar kabi).

## Arxitektura

Yangi, sof funksiya `frontend/src/utils/leagueTierStyle.ts`:
```typescript
export function leagueTierBorderClass(tier: LeagueTier): string { ... }
```
Yuqoridagi jadvalga mos `borderColorClass` qiymatini qaytaradi — bitta joyda markazlashtirilgan, uchala ekran ham shu funksiyani chaqiradi (kod takrorlanmaydi).

**`ProfileScreen.tsx`** — `getMyLeague()` YANGI fetch sifatida qo'shiladi (mavjud `getProfile`/`getMyStats`/`getAchievements` fetch'lari qatoriga, bir xil "mustaqil, bir-birini blok qilmaydigan" naqshda). Asosiy avatar (72px)ga `borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}` qo'shiladi. `MasteryBadge` allaqachon bor, o'zgarmaydi.

**`HomeScreen.tsx`** — hech qanday yangi fetch kerak emas (`profile` va `league` ALLAQACHON mavjud state'lar, avvalgi ikkita feature'dan). Avatar (44px)ga `borderColorClass` qo'shiladi, yoniga `{profile && <MasteryBadge rank={profile.masteryRank} />}` qo'shiladi.

**`SettingsScreen.tsx`** — `getProfile()` VA `getMyLeague()` ikkalasi ham YANGI fetch sifatida qo'shiladi (hozir faqat `getMyStats` bor). "Mening profilim" tugmasidagi avatar (48px)ga `borderColorClass` qo'shiladi, yoniga (label matni bilan bir qatorda, kichikroq) `MasteryBadge` qo'shiladi.

## Retroaktivlik haqida

Bu funksiya hech qanday "birinchi marta ko'rsatiladigan" holatga ega emas — ramka/unvon HAR DOIM foydalanuvchining JORIY Liga darajasi/Mastery Rank'ini aks ettiradi (kesh, tarix yoki "yangi narsa" emas). Shuning uchun retroaktivlik masalasi umuman qo'zg'almaydi — bu Achievements feature'idan farqli, chunki bu yerda "bir martalik hodisa" yo'q, faqat doimiy hisoblanadigan holat bor.

## Testlash

Frontend (Vitest + RTL):
- `leagueTierStyle.test.ts` — barcha 7 ta Liga darajasi uchun to'g'ri klass qaytarilishini tasdiqlovchi test.
- `ProfileScreen.test.tsx` — `league` yuklangandan keyin avatar to'g'ri `borderColorClass` bilan render qilinishini tasdiqlovchi test (mavjud `BattleAvatar` render'ini tekshirish orqali, masalan `container.querySelector('.border-ios-gold')` yoki shunga o'xshash).
- `HomeScreen.test.tsx` — avatar ramkasi VA `MasteryBadge` ikkalasi ham ko'rinishini tasdiqlovchi test.
- `SettingsScreen.test.tsx` — yangi `getProfile`/`getMyLeague` fetch'lari qo'shilgandan keyin ham mavjud testlar buzilmasligini (mock qo'shish orqali) va yangi ramka/badge ko'rinishini tasdiqlovchi test.

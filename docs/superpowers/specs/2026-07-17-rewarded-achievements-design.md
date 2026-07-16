# Mukofotli Achievements — Dizayn Spetsifikatsiyasi

**Sana:** 2026-07-17
**Maqsad:** Auditda (`bilimbattle_audit_javob.txt`, 5-qism) tavsiya etilgan "Achievement System — allaqachon bor, mukofotli qilib kengaytirish mumkin" bandini amalga oshirish — hozirgi 14 ta "faqat maqtanish uchun" nishonni kichik XP mukofoti bilan boyitish.

## Ko'lam

**Kiradi:** har bir nishonga bosqichga qarab o'sib boruvchi XP mukofoti (50/100/200/300), mukofotning Liga haftalik XP'siga (`league_weekly_xp`) qo'shilishi, frontend'da XP miqdorining ko'rsatilishi (AchievementsScreen kartalari + ResultScreen banner).

**Kirmaydi:** retroaktiv XP (funksiya chiqishidan oldin qo'lga kiritilgan nishonlar uchun), yangi jadval/migratsiya, nishon katalogining o'zgarishi (14 ta nishon soni va shartlari o'zgarmaydi — faqat XP maydoni qo'shiladi).

## Nega Liga haftalik XP'si

Nishonlar (`games`/`streak`/`rating` kategoriyalari) barcha fanlar bo'yicha umumiy hisoblanadi (`users` jadvalidagi global statistikaga asoslanadi), lekin `subject_xp` faqat `ingliz_tili` fani uchun ishlaydi (XP+Mastery dizaynida ataylab shunday cheklangan). Shuning uchun nishon mukofotini `subject_xp`ga qo'shish semantik jihatdan noto'g'ri bo'lardi (masalan, "Sport"da g'alaba ketma-ketligi uchun Ingliz tili XP'si oshishi mantiqsiz).

`league_weekly_xp` — allaqachon mavjud, fan-agnostik, umumiy "xom XP" hisoblagichi (`accumulateWeeklyXp()` funksiyasi orqali to'ldiriladi, hozir faqat match ballari uchun ishlatiladi). Nishon mukofotini shu yerga qo'shish: (a) yangi jadval/migratsiya talab qilmaydi, (b) darhol seziladigan natija beradi — nishon olish shu haftadagi Liga o'rningizni oshiradi.

## XP miqdori (bosqich bo'yicha)

| Bosqich | XP | Nishonlar |
|---|---|---|
| 1 (oson) | 50 | `games_1`, `streak_3` |
| 2 (o'rta) | 100 | `games_10`, `streak_5`, `rating_1200`, `level_10` |
| 3 (qiyin) | 200 | `games_50`, `streak_10`, `rating_1500`, `level_50` |
| 4 (eng qiyin) | 300 | `games_100`, `rating_2000`, `level_100`, `level_perfect` |

`level_perfect` (biror bosqichda 3 yulduz olish) 4-bosqichga joylashtirilgan — bu vaqtga bog'liq emas, balki mahoratga bog'liq yagona nishon, shuning uchun eng yuqori mukofotga loyiq.

## Backend arxitekturasi

`backend/src/achievements/achievements.ts`dagi `Achievement` interfeysiga yangi maydon qo'shiladi:
```typescript
export interface Achievement {
  key: string;
  category: AchievementCategory;
  label: string;
  description: string;
  threshold: number;
  xpReward: number; // YANGI
}
```

`ACHIEVEMENTS` katalogidagi har bir yozuvga yuqoridagi jadvalga mos `xpReward` qiymati qo'shiladi.

`awardAchievements(userId, candidateKeys)` funksiyasi o'zgartiriladi: hozir u `INSERT ... ON CONFLICT DO NOTHING RETURNING achievement_key` orqali FAQAT haqiqatan ham YANGI qo'lga kiritilgan kalitlarni qaytaradi (allaqachon bor nishonlar `RETURNING`da chiqmaydi — bu PostgreSQL semantikasi, `ON CONFLICT DO NOTHING` mos tushgan qatorlar uchun ON CONFLICT harakati bajarilganda RETURNING orqali hech narsa qaytarmaydi). Shu qaytgan (haqiqatan yangi) kalitlar ro'yxati bo'yicha, har biri uchun mos `xpReward`ni `ACHIEVEMENTS` katalogidan topib, `accumulateWeeklyXp(userId, xpReward)` (`../league/leagueRepository`dan import qilinadi — aylanma import xavfi yo'q, chunki `leagueRepository.ts` faqat `pool`, `mostRecentMonday`, `LeagueTier`ni import qiladi) chaqiriladi. Bu — funksiyaning mavjud "faqat genuinely-yangi kalitlarni qaytaradi" xatti-harakatini o'zgartirmaydi, faqat shu qaytgan ro'yxat ustiga bitta qo'shimcha side-effect qo'shadi.

Chaqiruv joylari (`checkAndAwardMatchAchievements`, `checkAndAwardLevelAchievements`, `gameEngine.ts`dagi ikkala chaqiruv nuqtasi) o'zgarishsiz qoladi — ular allaqachon `awardAchievements`ni chaqiradi, yangi XP-berish logikasi shu funksiya ICHIDA joylashadi, chaqiruvchilar buni bilishi shart emas.

`achievementsRoutes.ts`dagi `GET /api/achievements` javobi o'zgarishsiz qoladi (`res.json({ catalog: ACHIEVEMENTS, earned })`) — `xpReward` maydoni katalog orqali avtomatik frontend'ga o'tadi.

## Frontend arxitekturasi

`frontend/src/api/achievements.ts`dagi `Achievement` interfeysiga `xpReward: number` maydoni qo'shiladi.

`AchievementsScreen.tsx` — har bir nishon kartasida (`description` ostida) kichik `+{xpReward} XP` yozuvi qo'shiladi, HAM qulflangan, HAM ochilgan nishonlar uchun (foydalanuvchi oldindan qancha mukofot borligini bilishi uchun — bu allaqachon `description` ko'rsatilish tartibiga mos).

`ResultScreen.tsx` — hozirgi `newAchievementLabel: string | null` state'i `newAchievement: {label: string; xpReward: number} | null`ga aylantiriladi (`res.catalog`dan topilgan achievement obyektining o'zi saqlanadi, faqat `label`i emas). Banner matni ikkala joyda (level-mode va oddiy natija bloklarida) `🏆 Yangi nishon: {label}`dan `🏆 Yangi nishon: {label} (+{xpReward} XP)`ga o'zgaradi.

## Retroaktivlik yo'qligi haqida aniq qaror

Funksiya chiqishidan OLDIN qo'lga kiritilgan nishonlar uchun HECH QANDAY backfill/migratsiya skripti yozilmaydi. Bu ataylab shunday — production hali kichik foydalanuvchi bazasiga ega, va bir martalik yo'qotish xavfli backfill skriptidan (production DB'da qo'lda ishga tushiriladigan, xato ehtimoli bor operatsiya) ko'ra arzonroq.

## Testlash

Backend (Jest, real Postgres+Redis, mavjud konvensiyalarga mos):
- `awardAchievements` haqiqatan YANGI nishon uchun `league_weekly_xp`ga mos XP qo'shishini tasdiqlovchi test.
- Xuddi shu nishonni IKKINCHI marta `awardAchievements`ga uzatish (allaqachon bor holatda) XP'ni QAYTA qo'shmasligini (ya'ni faqat bir marta hisoblanishini) tasdiqlovchi regressiya testi — bu funksiyaning "faqat genuinely-yangi kalitlar" semantikasiga to'g'ridan-to'g'ri bog'liq muhim invariant.
- Turli bosqichdagi ikkita nishon (masalan `games_1` va `games_100`) uchun mos XP miqdori farqli ekanligini tasdiqlovchi test.

Frontend (Vitest + RTL):
- `AchievementsScreen.test.tsx` — kamida bitta kartada `+50 XP` (yoki mos qiymat) matni ko'rinishini tasdiqlovchi test.
- `ResultScreen.test.tsx` — yangi nishon banner'ida XP miqdori ko'rsatilishini tasdiqlovchi test (mavjud "yangi nishon ko'rsatiladi" testiga qo'shimcha assertion yoki yangi test sifatida).

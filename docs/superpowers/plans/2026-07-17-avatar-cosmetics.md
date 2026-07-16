# Avatar Cosmetics (League Frame + Mastery Title) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each user's current League tier as a colored avatar border (reusing `BattleAvatar`'s existing `borderColorClass` prop) and their Mastery Rank as the existing `MasteryBadge` component, on `ProfileScreen`, `HomeScreen`, and `SettingsScreen`.

**Architecture:** A new pure function `leagueTierBorderClass(tier)` maps each of the 7 League tiers to a Tailwind border class (3 new CSS custom properties added to `index.css` for tiers without an existing token; the other 4 tiers reuse existing tokens). Each of the 3 screens applies this function's result to its own avatar's `borderColorClass` and renders `MasteryBadge` alongside it, using data each screen either already fetches or gains one new non-blocking fetch for.

**Tech Stack:** Vite/React/TypeScript/Tailwind v4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-17-avatar-cosmetics-design.md`

---

### Task 1: `leagueTierBorderClass` util + new CSS tokens

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/utils/leagueTierStyle.ts`
- Create: `frontend/src/utils/leagueTierStyle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/leagueTierStyle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { leagueTierBorderClass } from './leagueTierStyle';

describe('leagueTierBorderClass', () => {
  it('returns the correct border class for each league tier', () => {
    expect(leagueTierBorderClass('Bronza')).toBe('border-ios-bronze');
    expect(leagueTierBorderClass('Kumush')).toBe('border-ios-silver');
    expect(leagueTierBorderClass('Oltin')).toBe('border-ios-gold');
    expect(leagueTierBorderClass('Platina')).toBe('border-league-platinum');
    expect(leagueTierBorderClass('Olmos')).toBe('border-league-diamond');
    expect(leagueTierBorderClass('Usta')).toBe('border-league-master');
    expect(leagueTierBorderClass('Chempion')).toBe('border-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.6)]');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/utils/leagueTierStyle.test.ts
```
Expected: FAIL — `leagueTierStyle.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Add the new CSS tokens**

In `frontend/src/index.css`, replace:

```css
  --color-ios-gold: #ffc02e;
  --color-ios-silver: #b0b3b8;
  --color-ios-bronze: #cd7f32;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

with:

```css
  --color-ios-gold: #ffc02e;
  --color-ios-silver: #b0b3b8;
  --color-ios-bronze: #cd7f32;
  /* League-tier-only accents (Platina/Olmos/Usta) - Bronza/Kumush/Oltin
     reuse the tokens above instead of duplicating them, and Chempion
     reuses --color-ios-gold with an added glow rather than a 5th new hue
     (see leagueTierStyle.ts). */
  --color-league-platinum: #7fdbda;
  --color-league-diamond: #b983ff;
  --color-league-master: #c026d3;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

- [ ] **Step 4: Implement the function**

Create `frontend/src/utils/leagueTierStyle.ts`:

```typescript
// frontend/src/utils/leagueTierStyle.ts
import { LeagueTier } from '../api/league';

const LEAGUE_TIER_BORDER_CLASS: Record<LeagueTier, string> = {
  Bronza: 'border-ios-bronze',
  Kumush: 'border-ios-silver',
  Oltin: 'border-ios-gold',
  Platina: 'border-league-platinum',
  Olmos: 'border-league-diamond',
  Usta: 'border-league-master',
  // Same color as Oltin, with an added glow - the top tier reads as
  // "beyond gold" rather than needing a whole separate hue, mirroring
  // MasteryBadge's identical glow treatment for its own top ("Professor")
  // tier.
  Chempion: 'border-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.6)]',
};

export function leagueTierBorderClass(tier: LeagueTier): string {
  return LEAGUE_TIER_BORDER_CLASS[tier];
}
```

- [ ] **Step 5: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/utils/leagueTierStyle.test.ts
```
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/utils/leagueTierStyle.ts frontend/src/utils/leagueTierStyle.test.ts
git commit -m "Add leagueTierBorderClass util and new league-tier CSS tokens"
```

---

### Task 2: `ProfileScreen` — league-tier avatar border

**Files:**
- Modify: `frontend/src/screens/ProfileScreen.tsx`
- Modify: `frontend/src/screens/ProfileScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/src/screens/ProfileScreen.test.tsx`, add this import alongside the existing ones:

```typescript
import * as leagueApi from '../api/league';
```

Add this default mock inside the existing `beforeEach` block, right after the `getAchievements` mock:

```typescript
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Bronza', weeklyXp: 0, bracket: [],
    });
```

Add this new test, right after the `'shows the user's XP, mastery rank and daily streak once the profile loads'` test:

```typescript
  it("applies the league-tier border color to the main avatar once the league loads", async () => {
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin', weeklyXp: 120, bracket: [],
    });

    render(<ProfileScreen />);
    await screen.findByText('340');

    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-ios-gold');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ProfileScreen.test.tsx
```
Expected: FAIL — the avatar `<img>` doesn't have the `border-ios-gold` class yet.

- [ ] **Step 3: Add the league fetch and apply the border class**

In `frontend/src/screens/ProfileScreen.tsx`, add these imports alongside the existing ones:

```typescript
import { getMyLeague, LeagueResponse } from '../api/league';
import { leagueTierBorderClass } from '../utils/leagueTierStyle';
```

Add this state declaration alongside the existing ones:

```typescript
  const [league, setLeague] = useState<LeagueResponse | null>(null);
```

Add this fetch inside the existing `useEffect`, alongside the other three independent fetches (`getProfile`, `getMyStats`, `getAchievements`):

```typescript
    getMyLeague(token)
      .then((res) => {
        if (cancelled) return;
        setLeague(res);
      })
      .catch(() => {});
```

Replace:

```typescript
        <BattleAvatar telegramId={user.telegramId} size={72} />
```

with:

```typescript
        <BattleAvatar
          telegramId={user.telegramId}
          size={72}
          borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}
        />
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ProfileScreen.test.tsx
```
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/ProfileScreen.tsx frontend/src/screens/ProfileScreen.test.tsx
git commit -m "Show the league-tier border on ProfileScreen's avatar"
```

---

### Task 3: `HomeScreen` — league-tier avatar border + Mastery title

**Files:**
- Modify: `frontend/src/screens/HomeScreen.tsx`
- Modify: `frontend/src/screens/HomeScreen.test.tsx`

**Context:** `HomeScreen` already fetches both `profile` (for `masteryRank`) and `league` (for `tier`) — no new fetch needed here, only new rendering.

- [ ] **Step 1: Write the failing test**

In `frontend/src/screens/HomeScreen.test.tsx`, add this new test, right after the `'shows the current streak and rating once stats load'` test:

```typescript
  it('shows the league-tier avatar border and mastery title once profile and league load', async () => {
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Usta', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin', weeklyXp: 0, bracket: [],
    });

    render(<HomeScreen />);

    await screen.findByText('Usta');
    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-ios-gold');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```
Expected: FAIL — neither the mastery title text nor the border class render yet.

- [ ] **Step 3: Add the imports, border class, and Mastery badge**

In `frontend/src/screens/HomeScreen.tsx`, add these imports alongside the existing ones:

```typescript
import { MasteryBadge } from '../components/MasteryBadge';
import { leagueTierBorderClass } from '../utils/leagueTierStyle';
```

Replace:

```typescript
      <div className="flex items-center gap-3">
        <BattleAvatar telegramId={user.telegramId} size={44} />
        {stats && (
```

with:

```typescript
      <div className="flex items-center gap-3">
        <BattleAvatar
          telegramId={user.telegramId}
          size={44}
          borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}
        />
        {profile && <MasteryBadge rank={profile.masteryRank} />}
        {stats && (
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/HomeScreen.tsx frontend/src/screens/HomeScreen.test.tsx
git commit -m "Show the league-tier border and mastery title on HomeScreen's avatar"
```

---

### Task 4: `SettingsScreen` — league-tier avatar border + Mastery title (new fetches)

**Files:**
- Modify: `frontend/src/screens/SettingsScreen.tsx`
- Modify: `frontend/src/screens/SettingsScreen.test.tsx`

**Context:** Unlike `HomeScreen`, `SettingsScreen` does not currently fetch `profile` or `league` at all — this task adds both, as NEW, independent, non-blocking fetches that must NOT affect the screen's existing `loading`/`error` state (which stays tied only to the pre-existing `getMyStats` call, exactly as before).

- [ ] **Step 1: Write the failing test**

In `frontend/src/screens/SettingsScreen.test.tsx`, add these imports alongside the existing ones:

```typescript
import * as profileApi from '../api/profile';
import * as leagueApi from '../api/league';
```

Add this new test, right after the `'shows a "Mening profilim" entry point and navigates to the profile screen when clicked'` test:

```typescript
  it('shows the league-tier avatar border and mastery title on the "Mening profilim" entry point once loaded', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Yuqori', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Olmos', weeklyXp: 0, bracket: [],
    });

    render(<SettingsScreen />);

    await screen.findByText('Yuqori');
    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-league-diamond');
  });

  it('still shows the "Mening profilim" entry point normally when the profile/league fetches fail', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });
    vi.spyOn(profileApi, 'getProfile').mockRejectedValue(new Error('network down'));
    vi.spyOn(leagueApi, 'getMyLeague').mockRejectedValue(new Error('network down'));

    render(<SettingsScreen />);

    expect(await screen.findByText('Mening profilim')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/SettingsScreen.test.tsx
```
Expected: FAIL on the first new test (`getMyLeague`/`getProfile` aren't called at all yet, so the mastery title never renders and the border class is empty). The second new test may already incidentally pass (nothing to break yet) — that's fine, it becomes a real regression guard once Step 3 lands.

- [ ] **Step 3: Add the new fetches and rendering**

In `frontend/src/screens/SettingsScreen.tsx`, add these imports alongside the existing ones:

```typescript
import { getProfile, ProfileResponse } from '../api/profile';
import { getMyLeague, LeagueResponse } from '../api/league';
import { MasteryBadge } from '../components/MasteryBadge';
import { leagueTierBorderClass } from '../utils/leagueTierStyle';
```

Add these state declarations alongside the existing ones:

```typescript
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [league, setLeague] = useState<LeagueResponse | null>(null);
```

Replace the existing `useEffect`:

```typescript
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    getMyStats(token)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);
```

with:

```typescript
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    getMyStats(token)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    // Independent of the stats fetch above (which alone gates this screen's
    // loading/error state) - these two only decorate the "Mening profilim"
    // avatar with a league-tier border and mastery title, so a slow or
    // failed fetch here must never block or error out the rest of the
    // settings screen.
    getProfile(token)
      .then((res) => {
        if (cancelled) return;
        setProfile(res);
      })
      .catch(() => {});

    getMyLeague(token)
      .then((res) => {
        if (cancelled) return;
        setLeague(res);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [token]);
```

Replace:

```typescript
        <BattleAvatar telegramId={user?.telegramId ?? null} size={48} />
        <span className="flex-1 font-medium text-ios-label">Mening profilim</span>
        <CaretRight size={16} className="text-ios-secondary-label" />
```

with:

```typescript
        <BattleAvatar
          telegramId={user?.telegramId ?? null}
          size={48}
          borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}
        />
        <span className="flex-1 font-medium text-ios-label">Mening profilim</span>
        {profile && <MasteryBadge rank={profile.masteryRank} />}
        <CaretRight size={16} className="text-ios-secondary-label" />
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/SettingsScreen.test.tsx
```
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 5: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/SettingsScreen.tsx frontend/src/screens/SettingsScreen.test.tsx
git commit -m "Show the league-tier border and mastery title on SettingsScreen's avatar"
```

---

## After all 4 tasks

Run the full frontend suite one final time:
```bash
cd frontend && npx vitest run && npx tsc --noEmit
```
Expected: both green.

No backend changes, no deployment steps beyond the normal `git pull && docker compose up -d --build` (pure frontend feature, no schema/API change).

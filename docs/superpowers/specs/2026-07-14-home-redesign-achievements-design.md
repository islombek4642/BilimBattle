# Home Screen Redesign + Achievements Design

## Problem

`HomeScreen` is currently just two buttons on a flat background — no identity, no sense of progress, no reason to open the app beyond "I want to play right now." Meanwhile the backend already tracks real engagement data (`rating`, `games_played`, `current_streak`, `best_streak` on `users`; per-level stars in `level_progress`) that's fully wired up elsewhere (`SettingsScreen`, `LeaderboardScreen`) but invisible on the screen a player actually opens first. The app reads as "a quiz test," not a game worth returning to.

## Goal

Make the home screen feel alive and give players a reason to come back: surface existing progress data as a game HUD, add a lightweight, permanent achievements system players can collect, and show a "just unlocked!" moment right after a match when it happens.

## Scope decisions (confirmed with the user)

1. **Achievements are pure recognition, no rewards/unlocks.** No new currency, cosmetics, or avatar-frame system — earning a badge is the whole point. Keeps this shippable without inventing an economy.
2. **Starter achievement catalog** (~15 entries, thresholds on already-tracked data):
   - **Faollik (games played):** 1, 10, 50, 100 games
   - **Olov (win streak):** `current_streak` reaches 3, 5, 10
   - **Yuksalish (rating):** `rating` reaches 1200, 1500, 2000
   - **Bosqichlar ustasi (levels completed):** finish a Level Mode match for level 10, 50, or 100 (any star count — `upsertLevelProgress` was called for that level number at all, not a minimum-stars requirement)
   - **Mukammal (perfect level):** earn 3 stars on any level
3. **Achievements are permanent once earned** — a `user_achievements` table persists `(user_id, achievement_key, earned_at)`. A later streak reset must NOT remove an already-earned streak badge (this is why it can't be computed on the fly from current stats alone).
4. **Real-time "new achievement!" moment uses a client-side diff, not a socket protocol change.** `ResultScreen` re-fetches `GET /achievements` after a match and compares against a `localStorage` set of previously-seen achievement keys; anything earned-but-unseen gets a small celebratory reveal, then gets marked seen. This deliberately avoids touching `gameEngine.ts`, the `game_over` socket payload, or `useGameSocket.ts` — all heavily tested, production code from the recent Level Mode feature — for a purely cosmetic addition. Tradeoff: clearing browser storage (or a fresh device/reinstall) can cause an already-earned badge to "pop up as new" again once; acceptable, not worth solving for v1.
5. **Achievements screen is reachable from Home**, not a new bottom-nav tab — `BottomNav` stays `Bosh sahifa / Reyting / Sozlamalar`. A small badge row on Home links to the full list via "hammasi."
6. **Home screen additions**, on top of the existing two CTA buttons (unchanged):
   - A HUD row: avatar, current streak (🔥), rating (⭐) — small chips, not the full `SettingsScreen`-style profile card (that removal was deliberate in an earlier task; this doesn't reintroduce it).
   - An earned-achievements showcase (last few badges + "hammasi" link to the new `AchievementsScreen`).
   - A "Davom etish" (continue) shortcut to the next unlocked-but-not-3-starred Level Mode level, when one exists — skips the player having to hunt through `LevelSelectScreen` for where they left off.
   - A mini leaderboard preview (top 3 + the player's own rank if outside the top 3), linking to the full `LeaderboardScreen`.

## Architecture

### Achievement catalog — code, not database

The list of possible achievements (key, category, label, description, threshold) is a static TypeScript array in the backend, not a database table — it's fixed, versioned-with-the-code data, not something an admin edits at runtime. Only *which user has earned which* needs persistence.

```sql
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  achievement_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_key)
);
```

### Award checking — two trigger points, both already-existing hooks

- **Match-result achievements** (games played, streak, rating): checked right after `backend/src/game/gameEngine.ts`'s existing `persistMatchResult(gameId, params)` succeeds, at both its call sites (`finishGame`'s normal completion and `forfeitIfStillDisconnected`) — for each **non-bot** player only, mirroring the existing `!player.isBot` convention already used elsewhere in this file for level-mode star persistence. Re-fetches the player's updated `User` row (`getUserById`) and checks it against the games/streak/rating thresholds.
- **Level-mode achievements** (levels completed, perfect stars): checked right after `backend/src/game/levelProgress.ts`'s existing `upsertLevelProgress(userId, levelNumber, stars)` succeeds — checks the just-upserted `levelNumber` against the "finished level N" thresholds (10/50/100, any star count — reaching the threshold just means a level_progress row for that level number now exists), and checks `stars === 3` on this specific upsert call for the perfect-level achievement (not "any level has ever reached 3 stars historically" via a separate query — the star value from the call that just happened is sufficient and cheaper).
- Both paths call a shared `checkAndAwardAchievements(userId, candidateKeys): Promise<string[]>` in a new `backend/src/achievements/achievements.ts` module, which `INSERT ... ON CONFLICT (user_id, achievement_key) DO NOTHING` any newly-qualifying key and returns which ones were genuinely new (so callers COULD react to it server-side later, though nothing does yet — the client-diff approach in decision 4 is what actually drives the UI).

### Read path

New `GET /achievements` (authenticated): returns `{ catalog: Achievement[], earned: { key: string, earnedAt: string }[] }` — the full static catalog plus this user's earned set, so the frontend can render locked vs. unlocked without needing to duplicate threshold logic client-side.

### Frontend

- `frontend/src/api/achievements.ts` — thin wrapper, mirrors the existing `api/leaderboard.ts`/`api/stats.ts` pattern.
- New `frontend/src/screens/AchievementsScreen.tsx` — full catalog, grouped by category, locked (grayed, padlock) vs. earned (colored, "earned N kun oldin").
- `HomeScreen.tsx` gains: the HUD row (reusing `BattleAvatar`, reading `stats`/`user` the same way `SettingsScreen` already does via `getMyStats`), an achievement badge row (top few earned, "hammasi" → navigates to the new `AchievementsScreen`), a conditional "Davom etish" shortcut (computed from `getLevelProgress`'s existing `progress`/`tierBoundaries`-adjacent data — reuses `LevelSelectScreen`'s existing `isLevelUnlocked` logic to find the lowest unlocked, non-3-star level), and a mini leaderboard preview (reuses `getGlobalLeaderboard`, already used by `LeaderboardScreen`).
- `ResultScreen.tsx` gains a post-match `GET /achievements` fetch + `localStorage`-diff check (new small utility, e.g. `frontend/src/utils/achievementSeen.ts`) that surfaces a brief celebratory reveal for anything newly earned. This is additive to the existing win/lose/draw and level-complete branches — neither existing branch's logic changes, this just conditionally renders an extra element when a new achievement is detected.

## What does NOT change

- `BottomNav` — still exactly 3 tabs (Home/Leaderboard/Settings).
- `gameEngine.ts`'s `game_over` socket payload, `useGameSocket.ts`, matchmaking, and the Level Mode question/star flow — completely untouched. Achievement-awarding is called *after* these existing flows already did their job, not woven into them.
- `SettingsScreen`'s existing full stats card — stays as-is, this doesn't duplicate it, Home's HUD is intentionally smaller/lighter.
- No currency, cosmetics, avatar frames, or reward unlocks (per decision 1).

## Risks / things to watch

- **Achievement-check calls add extra DB round-trips to two hot paths** (`finishGame`, `upsertLevelProgress`) — both already do several sequential queries per call, so this should stay cheap (a handful of threshold comparisons + one conditional insert), but worth confirming it doesn't materially slow down match completion under load.
- **`localStorage`-based "seen" tracking is per-device/per-browser**, not synced server-side — a player switching devices, or Telegram clearing WebView storage, could see an old badge "announced" again. Explicitly accepted in decision 4, not a bug to fix later unless it becomes a real complaint.
- **The "Davom etish" shortcut's logic duplicates `LevelSelectScreen`'s `isLevelUnlocked`** a second time (the codebase already accepts one duplication between backend `levelProgress.ts` and frontend `LevelSelectScreen.tsx` — this would be a third copy). Worth a shared frontend utility (`frontend/src/utils/levelUnlock.ts`) that both `LevelSelectScreen` and `HomeScreen` import, rather than a third independent copy-paste, to keep this at "two places to keep in sync" instead of three.

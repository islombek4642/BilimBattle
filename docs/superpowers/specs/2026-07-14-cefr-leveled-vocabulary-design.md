# CEFR-Leveled Vocabulary Design

## Problem

The `ingliz_tili` question pool (466,357 rows) was imported from a raw English dictionary dataset (MongoDB's `english-words-definitions` on Hugging Face) with no notion of difficulty. Level Mode's `getQuestionsForLevel(level)` maps level N to a fixed 15-row slice of that pool in insertion order, and insertion order was only randomly shuffled once at import time — so "level 1" can surface obscure/rare words (e.g. "turriculated", "luculently") right alongside common ones, with no meaningful difficulty progression across levels.

## Goal

Replace the pool with a smaller, CEFR-graded one (A1 → C2), so level number correlates with real difficulty: early levels are common, easy words; later levels get progressively harder; the whole thing is still built from data we can source and verify today.

## Data source

[Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) (MIT license) — 172,782 distinct English words, each with a **continuous CEFR difficulty score** (not just a discrete label): `1.0` = easiest (A1) ... `6.0` = hardest/rarest (C2), derived from Google N-gram frequency data blended with curated CEFR reference lists. Verified directly against known words: "the"/"of"/"and"/"cat"/"dog"/"happy"/"beautiful" all score exactly `1` (A1); "ubiquitous"/"perspicacious" score exactly `6` (C2/rare). The two relevant files are `csv/words.csv` (word text) and `csv/word_pos.csv` (per part-of-speech: `level` score, `frequency_count`).

This dataset has **no definitions** — only word + difficulty + frequency. It gets joined against our *existing* bundled definitions dataset (`backend/data/english-words-definitions.parquet`, word → definitions) by exact word-text match (case-insensitive).

**Verified match rate** (real join run against the actual files, not estimated): 172,767 of 172,782 CEFR words (99.99%) have a matching definition in our existing dataset.

**Per-tier word counts after the join** (tier = CEFR score rounded to nearest integer, clamped to [1,6]):

| Tier | CEFR | Matched words | 15-word levels |
|---|---|---|---|
| 1 | A1 | 6,394 | 426 |
| 2 | A2 | 8,410 | 560 |
| 3 | B1 | 13,046 | 869 |
| 4 | B2 | 13,211 | 880 |
| 5 | C1 | 5,759 | 383 |
| 6 | C2 (+ everything else the source dataset couldn't confidently place) | 125,947 | 8,396 |

~11,514 levels total (172,767 words ÷ 15) — far more than any real player will reach; tier 6 alone absorbs the long tail of rare/unclassified words as an effectively bottomless "advanced" bucket.

## Scope decisions (confirmed with the user)

1. **Full replace, not additive**: the existing 466,357 `ingliz_tili` rows are deleted and replaced with only the ~172,767 CEFR-matched rows. The ~293,890 unmatched words (not in the CEFR list at all) are dropped entirely — they're the source of the "too obscure" complaint, and 172k words already yields ~11.5k levels, which is more than enough.
2. **`level_progress` is wiped**: since "level N" now points at a completely different word set, existing stars/unlocks (production has only just started accumulating some) are cleared. Everyone restarts at level 1, this time in a meaningful order.
3. **Distractors drawn from the same rounded CEFR tier** as the correct word (not the whole pool as before) — keeps wrong answers plausible-but-wrong at a consistent difficulty, rather than an obviously-easy or nonsensically-obscure distractor next to an A1 word.
4. **Ordering within a tier**: primarily by the *continuous* CEFR score ascending (finer-grained than the 6 rounded tiers — e.g. within A1, a 1.0-scored word still sorts before a 1.4-scored one), tie-broken by frequency descending (more common words first when scores are equal/very close).
5. **`cefr_level` is persisted per question** (`'A1'`...`'C2'` string), for transparency/debugging and so the frontend can show which CEFR tier a given level belongs to. It does not change how `getQuestionsForLevel` maps level → questions (still pure `id` order — see Architecture below) — it's metadata riding along, not a query dimension.
6. **The frontend shows a small tier badge** on each level card in `LevelSelectScreen` (e.g. "A1") so players can see their real-world progress, not just an opaque level number.

## Architecture

### Why `getQuestionsForLevel` doesn't need to change

The existing mapping (`backend/src/questions/questionRepository.ts`) is `WHERE category = 'ingliz_tili' ORDER BY id ASC OFFSET (level-1)*15 LIMIT 15`. As long as the **import script inserts rows in the exact final desired order** — tier 1 (A1) fully sorted first, then tier 2, ... tier 6 last, each internally sorted per decision 4 above — level N still lands on the right 15-word slice with zero query changes. All the new logic lives in the *import script*, not the runtime path.

### Schema change

```sql
ALTER TABLE questions ADD COLUMN IF NOT EXISTS cefr_level TEXT;
```

Nullable, so the two other categories (`umumiy_bilim`, `sport_kino_musiqa`) are unaffected. Populated only by the new `ingliz_tili` import.

### New import script

Replaces `backend/scripts/importEnglishVocabulary.ts`'s body (keeping the existing bundled-file-first / staged-file / network-download fallback pattern for **both** data files — the CEFR CSVs get bundled into `backend/data/` alongside the existing parquet file, same reasoning as before: don't depend on GitHub's raw-content servers being reachable from the production host at deploy time, given the prior Hugging Face CDN IP-blocking incident on this same server).

Steps:
1. `DELETE FROM questions WHERE category = 'ingliz_tili'` and `DELETE FROM level_progress` (both explicit, both logged) — this is destructive, so the script requires an explicit `--confirm-replace` CLI flag to actually run the deletes (refuses otherwise), so it can never be fired accidentally the way the original "refuse if already imported" guard prevented double-imports.
2. Load `words.csv` + `word_pos.csv`. For each distinct word (case-insensitive), take the **minimum** CEFR score across its part-of-speech entries (its easiest sense) and the frequency associated with that entry.
3. Load the existing bundled definitions parquet (unchanged loader code). Join by lowercased word text; keep only CEFR words with a match.
4. Round each word's score to its tier (`Math.min(6, Math.max(1, Math.round(score)))`, mapped to `'A1'`..`'C2'`).
5. Group by tier, sort each tier's words by continuous score ascending, then frequency descending.
6. Concatenate tiers in order (A1 → C2). This concatenated list's index order **is** the final `id` order after insert.
7. For each word, build a question row exactly like today (`buildQuestionRow`), except `pickRandomDistractors` draws from **that word's own tier's word list only** (not the global pool) — reusing the same index-exclusion approach, just scoped to a per-tier array instead of the full 172k-word array. All 6 real tiers have well over the required minimum of 4 words, so the existing "pool too small" guard stays as a safety net, not something expected to fire.
8. Insert in that exact order, now including `cefr_level` in the INSERT.

### New backend read path: tier boundaries

`questionRepository.ts` gains `getLevelTierBoundaries(): Promise<{ tier: string; fromLevel: number; toLevel: number }[]>` — one query grouping `ingliz_tili` rows by `cefr_level` in `id` order, converting row counts to level ranges (cumulative count ÷ 15). Six rows, cheap, computed on request (no caching needed at this scale).

`GET /level-progress` (`backend/src/game/levelProgressRoutes.ts`) response gains a `tierBoundaries` field alongside the existing `progress`/`maxAvailableLevel`.

### Frontend

`frontend/src/api/levelProgress.ts`'s `LevelProgressResponse` gains `tierBoundaries: { tier: string; fromLevel: number; toLevel: number }[]`. `LevelSelectScreen.tsx` does a simple linear range lookup (6 entries, no per-card request) to render a small tier badge (e.g. "A1") on each level card.

## What does NOT change

- `getQuestionsForLevel`/`maxAvailableLevel` (still pure `id`-order, per Architecture above).
- The `level_progress` table schema, star-calculation/unlock-rule logic (`calculateLevelStars`, `isLevelUnlocked`) — a level is still 15 questions, still 1-3 stars, still the same stage/unlock thresholds. Only *which* 15 words a given level number contains changes.
- Matchmaking, game engine, socket events — none of this is level-content-aware beyond calling `getQuestionsForLevel`.
- The other two categories (`umumiy_bilim`, `sport_kino_musiqa`) and their questions — untouched.

## Risks / things to watch

- **Destructive production operation**: this permanently deletes 466k rows and all `level_progress` rows. The deploy script already takes a DB backup before every deploy, but this should still be run deliberately (the `--confirm-replace` flag), not as part of a routine redeploy.
- **Tier 6 is a mixed bag**: 125,947 of the matched words are tier 6, including both genuine C2 vocabulary and words the source dataset simply couldn't confidently place (defaults to hardest). This is fine functionally (it's an effectively bottomless "advanced" tier nobody will exhaust), but it means "C2" as a label is a bit generous for some of what's in there.
- **Word-matching is exact-text, case-insensitive only** — no lemmatization. A CEFR entry like "runs" and a definitions-dataset entry "run" would not match each other; each is only found if the *exact* same surface form exists in both datasets. This is why match rate is 99.99% and not literally 100%, but it's not expected to introduce anything worse than a small, evenly-distributed loss across tiers.

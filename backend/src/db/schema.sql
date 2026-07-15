-- backend/src/db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT NOT NULL,
  invited_by_telegram_id BIGINT,
  rating INTEGER NOT NULL DEFAULT 1000,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index SMALLINT NOT NULL,
  extra_definitions JSONB,
  cefr_level TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The column is declared both inline above (for fresh databases) and via this
-- ALTER (for databases where the table already existed): migrate.ts re-runs
-- this whole file every time, and CREATE TABLE IF NOT EXISTS is a no-op when
-- the table is already present, so it would never pick up the new column on
-- its own. Follow this same pattern for future column additions.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS extra_definitions JSONB;

-- Nullable: only ingliz_tili rows (imported by the CEFR-aware
-- importEnglishVocabulary.ts) ever populate this; umumiy_bilim and
-- sport_kino_musiqa rows leave it NULL. Does not affect
-- getQuestionsForLevel's level->question mapping (still pure `id` order) -
-- this column is metadata for transparency/debugging and for
-- getLevelTierBoundaries (see questionRepository.ts), not a query dimension.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS cefr_level TEXT;

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

INSERT INTO categories (key, label) VALUES
  ('umumiy_bilim', 'Umumiy bilim'),
  ('sport_kino_musiqa', 'Sport/Kino/Musiqa'),
  ('ingliz_tili', 'Ingliz tili')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  player1_id INTEGER NOT NULL REFERENCES users(id),
  player2_id INTEGER NOT NULL REFERENCES users(id),
  player1_score INTEGER NOT NULL,
  player2_score INTEGER NOT NULL,
  winner_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS level_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  level_number INTEGER NOT NULL,
  stars SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level_number)
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  achievement_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_key)
);

-- One row per (user, category) - only 'ingliz_tili' is populated in this
-- first version (see the design spec's Scope section). xp only ever grows
-- (both a win and a loss add points); mastery_points only grows from
-- correct answers, weighted by the question's CEFR difficulty tier.
CREATE TABLE IF NOT EXISTS subject_xp (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  mastery_points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);

-- One row per (user, calendar day). Keying by quest_date instead of storing
-- a single mutable "today" row per user is what makes Daily Quest reset
-- "lazy" (see the design spec) - a new calendar day simply has no row yet,
-- so every counter naturally reads back as zero via getTodayProgress's
-- COALESCE-to-zero, with no explicit reset step required anywhere.
CREATE TABLE IF NOT EXISTS daily_quest_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  quest_date DATE NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  best_stars_today SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, quest_date)
);

-- Daily-activity streak (distinct from users.current_streak, which counts
-- consecutive match WINS, not consecutive days with any activity). Nullable
-- date columns since a brand new user has never been active nor spent a
-- freeze yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS best_daily_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_used_at DATE;

CREATE INDEX IF NOT EXISTS idx_questions_category_id ON questions(category, id);
-- idx_questions_category (category) is now redundant: the composite
-- idx_questions_category_id (category, id) already satisfies any query the
-- single-column index could serve, via the leftmost-prefix rule. Explicitly
-- DROP it (rather than just deleting its old CREATE INDEX statement) since
-- schema.sql is re-applied on every deploy via migrate.ts, and already-
-- migrated databases still have the old index physically present - editing
-- the CREATE statement alone would never remove it there. Same pattern as
-- the extra_definitions column's ALTER TABLE ADD COLUMN above.
DROP INDEX IF EXISTS idx_questions_category;
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);

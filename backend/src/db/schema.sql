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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The column is declared both inline above (for fresh databases) and via this
-- ALTER (for databases where the table already existed): migrate.ts re-runs
-- this whole file every time, and CREATE TABLE IF NOT EXISTS is a no-op when
-- the table is already present, so it would never pick up the new column on
-- its own. Follow this same pattern for future column additions.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS extra_definitions JSONB;

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

CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_category_id ON questions(category, id);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);

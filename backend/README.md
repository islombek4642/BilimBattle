# BilimBattle Backend

Backend server for **BilimBattle**, a Telegram Mini App where two players are
matched in real time and battle head-to-head in a 1v1 quiz: a shared set of
multiple-choice questions, answered under a time limit, with the faster
correct answer scoring more points. The backend owns matchmaking (queue-based
and invite-link-based), the live game loop (questions, answers, scoring,
disconnect/reconnect handling), authentication via Telegram, and match
history/leaderboards.

Built with Express (HTTP/auth routes), Socket.io (real-time gameplay),
PostgreSQL (users, questions, match history), and Redis (matchmaking queues,
invites, live game state).

## Prerequisites

- Node.js
- A local PostgreSQL instance
- A local Redis instance

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Copy the example environment file and fill it in:

   ```
   cp .env.example .env
   ```

   `.env.example` documents every required variable:

   | Variable | Description |
   | --- | --- |
   | `PORT` | Port the HTTP/Socket.io server listens on (defaults to `3000`). |
   | `DATABASE_URL` | PostgreSQL connection string, e.g. `postgres://postgres:postgres@localhost:5432/bilimbattle`. |
   | `REDIS_URL` | Redis connection string, e.g. `redis://localhost:6379`. |
   | `JWT_SECRET` | Long random string used to sign/verify session tokens. |
   | `TELEGRAM_BOT_TOKEN` | Token for the Telegram bot used to authenticate users. |
   | `WEBAPP_URL` | Origin of the frontend Mini App (used for CORS). |

3. Create the database referenced by `DATABASE_URL` (e.g. `createdb bilimbattle`,
   or via `psql -c "CREATE DATABASE bilimbattle;"`) if it doesn't exist yet.

4. Apply the schema:

   ```
   npm run migrate
   ```

5. Seed starter quiz questions:

   ```
   npm run seed
   ```

## Running

- Development (auto-reload on file changes):

  ```
  npm run dev
  ```

- Production:

  ```
  npm run build
  npm start
  ```

## Testing

```
npm test
```

Runs the Jest suite. These tests hit a **real** local PostgreSQL and Redis
instance (as configured in `.env`) rather than mocking them — make sure both
are running and reachable, and that migrations/seed data are in place, before
running `npm test`.

## Load testing

`npm run loadtest` runs `scripts/loadTest.ts`, a standalone script (not part
of the Jest suite) that opens many concurrent Socket.io connections against a
locally running `npm run dev` server, has them all join the matchmaking
queue, and reports how many got matched vs. errored out over a fixed window —
useful for eyeballing matchmaking behavior under load. Configure it with the
`LOAD_TEST_SERVER_URL` (default `http://localhost:3000`) and
`LOAD_TEST_CLIENTS` (default `200`) environment variables.

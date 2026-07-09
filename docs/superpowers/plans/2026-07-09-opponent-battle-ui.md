# Opponent-Visibility Battle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each player their opponent's name/photo during a 1v1 match (a brief "VS" reveal, then a persistent tug-of-war score bar), with bot opponents disguised behind a random Uzbek display name so they're indistinguishable from real players.

**Architecture:** `matchmaker.ts`'s `createMatch` now looks up both players' real user records and emits a per-socket (not per-room) `match_found` event so each side receives the OTHER side's `{telegramId, firstName}` as `opponent` — bots get a randomly-picked display name instead of the DB's literal "Bot". The same `opponent` shape is added to the `reconnect_game` ack so a reconnecting player doesn't lose the panel. A new backend endpoint proxies Telegram profile photos (never exposing the bot token to the client) with a 24h Redis cache, including negative-caching for users with no photo. On the frontend, `WaitingScreen` shows a ~1.8s "VS" reveal before navigating to `battle`, and `BattleScreen` replaces its old `ScoreBar` with a new `BattleHeader` tug-of-war bar.

**Tech Stack:** Existing stack only — Node 20's built-in `fetch()` for calling the Telegram Bot API (no new dependency), `ioredis`'s Buffer-aware `getBuffer`/`set` for image caching, Express, Socket.io, React + Vitest/RTL.

---

## Spec coverage check

Every numbered section of `docs/superpowers/specs/2026-07-09-opponent-battle-ui-design.md` maps to a task below:
- §2.1 (`opponent` on `match_found`/`reconnect_game`) → Tasks 2, 3
- §2.2 (bot random name) → Task 2
- §2.3 (avatar proxy endpoint) → Tasks 4, 5
- §3.1 (`GameSocketContext`/`opponent` state) → Task 6
- §3.2 (VS reveal) → Task 10
- §3.3 (tug-of-war `BattleHeader`) → Task 9
- §3.4 (avatar fallback) → Task 8
- §4 (reconnect keeps `opponent`) → Task 3
- §5/§6 (testing, error handling) → covered inline in every task below

**Deviation from the spec, found during planning:** §2.3 said the avatar endpoint would be "`requireAuth` bilan himoyalangan" (protected by `requireAuth`). That's not actually possible here — a plain `<img src>` tag cannot attach a custom `Authorization` header, so a `requireAuth`-gated endpoint would 401 on every image load and the feature would never work. Task 5 mounts the route with **no auth** instead: Telegram profile photos aren't sensitive (anyone with the user's Telegram username can already see it), and `telegramId` is already public elsewhere in this app (e.g. the invite deep link `t.me/bot?startapp=invite_<telegramId>`).

---

## Task 1: `GameState`/`startGame` — plumbing for a per-match bot display name

**Why this can't just be "pick a random name and pass it along" inline in Task 2:** the random name has to be **the same** at match-start and at a later `reconnect_game` call for the same match. `GameState` is the only thing that survives between those two moments (it's the Redis-backed record of the match), so it needs a new field to hold it.

**Files:**
- Modify: `backend/src/game/gameState.ts`
- Modify: `backend/src/game/gameEngine.ts:23` (`startGame`)
- Test: `backend/tests/game/gameEngine.test.ts` (existing suite — verifying no regression, no new test needed for this task; the field is exercised by Task 2's tests instead)

- [ ] **Step 1: Add the field to `GameState`**

In `backend/src/game/gameState.ts`, change:

```ts
export interface GameState {
  gameId: string;
  category: string;
  questions: QuestionRecord[];
  currentQuestionIndex: number;
  questionStartedAt?: number;
  players: [PlayerState, PlayerState];
  status: 'active' | 'finished';
}
```

to:

```ts
export interface GameState {
  gameId: string;
  category: string;
  questions: QuestionRecord[];
  currentQuestionIndex: number;
  questionStartedAt?: number;
  players: [PlayerState, PlayerState];
  status: 'active' | 'finished';
  // Only set when one of the two players is the bot fallback (see
  // matchmaking/matchmaker.ts's BOT_DISPLAY_NAMES) - a random Uzbek first
  // name picked ONCE at match creation, so the bot looks like the same
  // "person" for the whole match (including across a reconnect), never the
  // DB's literal "Bot" name.
  botDisplayName?: string;
}
```

- [ ] **Step 2: Add the parameter to `startGame`**

In `backend/src/game/gameEngine.ts`, change:

```ts
export async function startGame(gameId: string, category: string, player1: PlayerInfo, player2: PlayerInfo): Promise<void> {
  const questions = await getRandomQuestions(category, QUESTIONS_PER_GAME);
  const game: GameState = {
    gameId,
    category,
    questions,
    currentQuestionIndex: -1,
    players: [
      { userId: player1.userId, socketId: player1.socketId, score: 0, answers: [], isBot: player1.isBot ?? false },
      { userId: player2.userId, socketId: player2.socketId, score: 0, answers: [], isBot: player2.isBot ?? false },
    ],
    status: 'active',
  };
  await saveGame(game);
  await sendNextQuestion(gameId);
}
```

to:

```ts
export async function startGame(
  gameId: string,
  category: string,
  player1: PlayerInfo,
  player2: PlayerInfo,
  botDisplayName?: string
): Promise<void> {
  const questions = await getRandomQuestions(category, QUESTIONS_PER_GAME);
  const game: GameState = {
    gameId,
    category,
    questions,
    currentQuestionIndex: -1,
    players: [
      { userId: player1.userId, socketId: player1.socketId, score: 0, answers: [], isBot: player1.isBot ?? false },
      { userId: player2.userId, socketId: player2.socketId, score: 0, answers: [], isBot: player2.isBot ?? false },
    ],
    status: 'active',
    botDisplayName,
  };
  await saveGame(game);
  await sendNextQuestion(gameId);
}
```

- [ ] **Step 3: Verify nothing broke**

Run: `cd backend && npx tsc --noEmit && npx jest tests/game/gameEngine.test.ts tests/game/gameEngineDisconnect.test.ts`
Expected: PASS, no TypeScript errors. The new parameter is optional and appended last, so every existing call site (`startGame(gameId, category, p1, p2)`) is still valid.

- [ ] **Step 4: Commit**

```bash
git add backend/src/game/gameState.ts backend/src/game/gameEngine.ts
git commit -m "feat: add botDisplayName field to GameState/startGame"
```

---

## Task 2: `matchmaker.ts` — random bot names + per-socket `match_found` with `opponent`

**Why per-socket instead of `io.to(gameId).emit(...)`:** the two players now need to see **different** payloads (each other's info), and `.to(room).emit()` broadcasts the identical payload to everyone in the room. Emitting on each individual socket lets each side get its own `opponent`.

**Files:**
- Modify: `backend/src/matchmaking/matchmaker.ts`
- Modify: `backend/tests/matchmaking/matchmaker.test.ts` (existing test's assertion changes: 2 `match_found` events now, not 1)
- Modify: `backend/tests/matchmaking/concurrent-join.test.ts` (same reason, plus the fake socket needs an `emit` method)
- Test: new test in `backend/tests/matchmaking/matchmaker.test.ts` for the bot random-name behavior

- [ ] **Step 1: Write the failing tests**

Replace the whole contents of `backend/tests/matchmaking/matchmaker.test.ts` with:

```ts
import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { handleJoinQueue, createMatch, BOT_DISPLAY_NAMES } from '../../src/matchmaking/matchmaker';
import { upsertUser, getOrCreateBotUser } from '../../src/users/userRepository';

function createFakeIO() {
  const events: { socketId: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; joinedRooms: string[] }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, {
              id,
              data: {},
              joinedRooms: [],
              join(room: string) {
                sockets.get(id)!.joinedRooms.push(room);
              },
              emit(event: string, payload: unknown) {
                events.push({ socketId: id, event, payload });
              },
            } as any);
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ socketId: room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}

describe('matchmaker', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7201, 'm1', 'Match1', null);
    const p2 = await upsertUser(7202, 'm2', 'Match2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7201, 7202)`);
    await redis.del('queue:umumiy_bilim');
    await pool.end();
    await closeRedis();
  });

  it('matches two queued players immediately and emits match_found individually to each socket with the OTHER player as opponent', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    await handleJoinQueue(fakeIO as any, 'sockA', player1Id, 'umumiy_bilim');
    await handleJoinQueue(fakeIO as any, 'sockB', player2Id, 'umumiy_bilim');

    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    // One per socket now, not one room-wide broadcast.
    expect(matchFoundEvents.length).toBe(2);

    const sockAEvent = matchFoundEvents.find((e) => e.socketId === 'sockA')!.payload as any;
    const sockBEvent = matchFoundEvents.find((e) => e.socketId === 'sockB')!.payload as any;
    expect(sockAEvent.opponent.telegramId).toBe(7202);
    expect(sockAEvent.opponent.firstName).toBe('Match2');
    expect(sockBEvent.opponent.telegramId).toBe(7201);
    expect(sockBEvent.opponent.firstName).toBe('Match1');

    const questionEvents = events.filter((e) => e.event === 'question');
    expect(questionEvents.length).toBe(1);
  });

  it('createMatch gives the bot a random display name from BOT_DISPLAY_NAMES, never the DB literal "Bot"', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const human = await upsertUser(7203, 'm3', 'Match3', null);
    const bot = await getOrCreateBotUser();

    await createMatch(
      fakeIO as any,
      'umumiy_bilim',
      { userId: human.id, socketId: 'sockC' },
      { userId: bot.id, socketId: 'bot' },
      true
    );

    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    expect(matchFoundEvents.length).toBe(1); // bot has no real socket to emit to
    const payload = matchFoundEvents[0].payload as any;
    expect(payload.opponent.firstName).not.toBe('Bot');
    expect(BOT_DISPLAY_NAMES).toContain(payload.opponent.firstName);

    await pool.query(`DELETE FROM users WHERE telegram_id = 7203`);
  });
});
```

Also update `backend/tests/matchmaking/concurrent-join.test.ts`'s `createFakeIO` helper to add the `emit` method (it's currently missing one, same as the old `matchmaker.test.ts` had), and update its assertion. Change:

```ts
function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; joinedRooms: string[] }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, {
              id,
              data: {},
              joinedRooms: [],
              join(room: string) {
                sockets.get(id)!.joinedRooms.push(room);
              },
            } as any);
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}
```

to:

```ts
function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; joinedRooms: string[] }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, {
              id,
              data: {},
              joinedRooms: [],
              join(room: string) {
                sockets.get(id)!.joinedRooms.push(room);
              },
              emit(event: string, payload: unknown) {
                events.push({ room: id, event, payload });
              },
            } as any);
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}
```

And in the same file, change:

```ts
    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    expect(matchFoundEvents.length).toBe(1);
```

to:

```ts
    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    // One per socket now (each gets the OTHER player as `opponent`), not one
    // room-wide broadcast.
    expect(matchFoundEvents.length).toBe(2);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/matchmaking/matchmaker.test.ts tests/matchmaking/concurrent-join.test.ts`
Expected: FAIL — `BOT_DISPLAY_NAMES` is not exported yet, `createMatch` still broadcasts one `match_found` per room with no `opponent` field.

- [ ] **Step 3: Implement**

Replace the whole contents of `backend/src/matchmaking/matchmaker.ts` with:

```ts
import { randomUUID } from 'crypto';
import type { AppServer } from '../socket/socketServer';
import { joinQueue, leaveQueue, popTwoIfAvailable, QueuedPlayer } from './queue';
import { startGame } from '../game/gameEngine';
import { isValidCategory } from '../questions/questionRepository';
import { getOrCreateBotUser, getUserById } from '../users/userRepository';

const BOT_MATCH_TIMEOUT_MS = 15_000;
// Tracks users currently waiting in a queue (joined, not yet paired), keyed
// by userId, so their bot-fallback timer can be found and cancelled on a
// real pairing or an explicit leave_queue. handleJoinQueue guards against a
// duplicate join for a user already present here (see below), so — unlike
// gameEngine.ts's activeTimers — an entry can't be silently orphaned by a
// double-join; it's always removed by exactly one of: a real pairing, an
// explicit cancelWaiting, or the bot-timeout callback itself firing.
const waitingTimers = new Map<number, NodeJS.Timeout>();

// Per-category serialization for every operation that touches the queue's
// Redis list (join, pop-pair, leave). queue.ts's popTwoIfAvailable is
// documented as NOT ATOMIC (LLEN + two LPOPs = three round-trips) and calls
// out that its caller — this module — must serialize calls per category to
// avoid double-pairing/stranded pops. Two players calling join_queue at
// nearly the same wall-clock moment is the normal case for a matchmaker, not
// a rare edge case, so this is a real hazard, not a theoretical one.
//
// Fix: chain every queue-touching operation for a given category onto a
// single promise so at most one is ever "in flight" against Redis for that
// category at a time. This is a simple async mutex keyed by category — far
// simpler than a Lua script and sufficient for this MVP's single-instance,
// small-queue scale (matches the same tradeoff already made in
// gameEngine.ts's submitAnswer). If this ever needs to hold across multiple
// server instances, it must become a Lua script (or Redis-based lock)
// instead, since an in-memory Map obviously can't serialize across processes.
const categoryLocks = new Map<string, Promise<unknown>>();

// Presentation-only display names for the bot fallback opponent - picked
// fresh per match so the same human never sees a literal "Bot" (the DB
// user's real first_name), and so a user playing many matches doesn't
// always see the identical fake name either. The underlying bot `users` row
// (telegram_id 0, first_name "Bot") is never changed - this only affects
// what gets sent over the wire in match_found/reconnect_game.
export const BOT_DISPLAY_NAMES = [
  'Aziz', 'Malika', 'Sardor', 'Dilnoza', 'Jasur', 'Nodira', 'Bekzod',
  'Zarina', 'Otabek', 'Madina', 'Sherzod', 'Gulnora', 'Farrux', 'Shahnoza',
  "Ulug'bek",
];

export function pickRandomBotDisplayName(): string {
  return BOT_DISPLAY_NAMES[Math.floor(Math.random() * BOT_DISPLAY_NAMES.length)];
}

function runSerialized<T>(category: string, fn: () => Promise<T>): Promise<T> {
  const previous = categoryLocks.get(category) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  // Swallow errors here only for chaining purposes so one failed operation
  // doesn't permanently wedge the lock for the category; the real error still
  // propagates to the caller via `result`.
  categoryLocks.set(
    category,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

export async function handleJoinQueue(io: AppServer, socketId: string, userId: number, category: string): Promise<void> {
  if (!isValidCategory(category)) return;

  // Idempotency guard: a duplicate join_queue call (double-tap, client
  // retry) for a user already waiting must be ignored. Without this,
  // waitingTimers.set(userId, timer) below would silently overwrite the
  // first timer's map entry without clearing its underlying setTimeout (the
  // stray timer fires later and deletes the SECOND timer's map entry
  // instead of its own), and joinQueue would push a second Redis entry for
  // the same user, letting popTwoIfAvailable return [thisUser, thisUser] —
  // a user matched against themselves.
  if (waitingTimers.has(userId)) {
    console.log(`matchmaker: ignoring duplicate join_queue from userId=${userId} (already waiting) category=${category}`);
    return;
  }

  console.log(`matchmaker: join_queue received userId=${userId} socketId=${socketId} category=${category}`);

  const pair = await runSerialized(category, async () => {
    await joinQueue(category, { userId, socketId });
    return popTwoIfAvailable(category);
  });

  if (pair) {
    const [player1, player2] = pair;
    console.log(`matchmaker: paired userId=${player1.userId} with userId=${player2.userId} category=${category}`);
    clearWaitingTimer(player1.userId);
    clearWaitingTimer(player2.userId);
    await createMatch(io, category, player1, player2);
    return;
  }

  console.log(`matchmaker: no opponent yet for userId=${userId} category=${category} - waiting up to ${BOT_MATCH_TIMEOUT_MS}ms before bot fallback`);

  const timer = setTimeout(() => {
    waitingTimers.delete(userId);
    void runSerialized(category, () => leaveQueue(category, userId)).then(async (removed) => {
      // Narrow but real race: this setTimeout callback and a concurrent
      // real player joining the same category are asynchronous relative to
      // each other. It's possible for both to be "in flight" at once: this
      // callback has already fired (and deleted the waitingTimer entry
      // above) at the exact moment a second real player's handleJoinQueue
      // call reaches popTwoIfAvailable first and pairs this user with a
      // real opponent before this callback's own (serialized) leaveQueue
      // turn runs. In that case leaveQueue finds nothing to remove (this
      // user is already gone from the Redis list, and already has/will have
      // a real match) — `removed` is false, and we must NOT proceed to
      // create a second, duplicate bot match for the same user.
      if (!removed) {
        console.log(`matchmaker: bot-fallback timer fired for userId=${userId} but they were already paired/removed - skipping`);
        return;
      }
      console.log(`matchmaker: bot-fallback timeout reached for userId=${userId} category=${category} - matching with a bot`);
      const bot = await getOrCreateBotUser();
      await createMatch(io, category, { userId, socketId }, { userId: bot.id, socketId: 'bot' }, true);
    }).catch((err) => {
      console.error('matchmaker: bot-fallback match failed', err);
    });
  }, BOT_MATCH_TIMEOUT_MS);
  waitingTimers.set(userId, timer);
}

// Called from the 'leave_queue' socket event. Also reachable (harmlessly) if
// a client emits leave_queue after already being matched: by then
// handleJoinQueue's match branch has already cleared this user's waiting
// timer (clearWaitingTimer is a no-op the second time), and leaveQueue itself
// is a no-op search-and-remove that finds nothing because popTwoIfAvailable
// already popped this user out of the Redis list. So this function is safe
// to call at any point in a player's queue lifecycle, matched or not.
export function cancelWaiting(userId: number, category: string): void {
  clearWaitingTimer(userId);
  runSerialized(category, () => leaveQueue(category, userId)).catch((err) => {
    console.error('matchmaker: failed to leave queue', err);
  });
}

function clearWaitingTimer(userId: number): void {
  const timer = waitingTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(userId);
  }
}

export async function createMatch(
  io: AppServer,
  category: string,
  player1: QueuedPlayer,
  player2: QueuedPlayer,
  player2IsBot = false
): Promise<void> {
  const gameId = randomUUID();

  const socket1 = io.sockets.sockets.get(player1.socketId);
  socket1?.join(gameId);
  if (socket1) socket1.data.gameId = gameId;

  const socket2 = player2.socketId !== 'bot' ? io.sockets.sockets.get(player2.socketId) : undefined;
  if (socket2) {
    socket2.join(gameId);
    socket2.data.gameId = gameId;
  }

  const botDisplayName = player2IsBot ? pickRandomBotDisplayName() : undefined;

  // Each side needs the OTHER side's identity, so both are fetched up front
  // and match_found is emitted to each socket individually below (not
  // broadcast via io.to(gameId).emit, which would send the identical
  // payload to both - the whole point here is the payloads differ).
  const [player1User, player2User] = await Promise.all([
    getUserById(player1.userId),
    getUserById(player2.userId),
  ]);

  if (socket1 && player2User) {
    socket1.emit('match_found', {
      gameId,
      category,
      opponent: {
        telegramId: player2User.telegramId,
        firstName: player2IsBot ? (botDisplayName ?? player2User.firstName) : player2User.firstName,
      },
    });
  }
  if (socket2 && player1User) {
    socket2.emit('match_found', {
      gameId,
      category,
      opponent: { telegramId: player1User.telegramId, firstName: player1User.firstName },
    });
  }

  await startGame(gameId, category, player1, { ...player2, isBot: player2IsBot }, botDisplayName);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/matchmaking/matchmaker.test.ts tests/matchmaking/concurrent-join.test.ts`
Expected: PASS (3 tests in matchmaker.test.ts, 1 in concurrent-join.test.ts)

- [ ] **Step 5: Run the full backend suite to check for other regressions**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS, all suites green (this also re-runs `tests/integration/socketServer.test.ts`, which calls `createMatch` indirectly via `join_invite` — confirm it still passes since it doesn't assert on `match_found`'s exact shape).

- [ ] **Step 6: Commit**

```bash
git add backend/src/matchmaking/matchmaker.ts backend/tests/matchmaking/matchmaker.test.ts backend/tests/matchmaking/concurrent-join.test.ts
git commit -m "feat: emit match_found per-socket with opponent info, random bot names"
```

---

## Task 3: `socketServer.ts` — add `opponent` to the `reconnect_game` ack

**Files:**
- Modify: `backend/src/socket/socketServer.ts`
- Test: `backend/tests/integration/socketServer.test.ts` (new test added; existing tests unaffected since they don't assert the full ack shape)

- [ ] **Step 1: Write the failing test**

Add this test to `backend/tests/integration/socketServer.test.ts` (place it near the other `reconnect_game`-focused test around line 148, using the same `saveGame`/fabricated-`GameState` pattern already used there — read the file first to match the exact imports already present):

```ts
  it('includes opponent info in the reconnect_game ack, using the bot display name when the other player is a bot', async () => {
    const category = 'umumiy_bilim';
    const gameId = 'reconnect-opponent-test-game';
    const human = await upsertUser(8901, 'reconA', 'ReconA', null);
    const bot = await getOrCreateBotUser();

    const fakeGame: GameState = {
      gameId,
      category,
      questions: [{ id: 1, text: 'q', options: ['a', 'b'], correctIndex: 0 }],
      currentQuestionIndex: 0,
      players: [
        { userId: human.id, socketId: 'placeholder', score: 0, answers: [], isBot: false },
        { userId: bot.id, socketId: 'bot', score: 0, answers: [], isBot: true },
      ],
      status: 'active',
      botDisplayName: 'Sardor',
    };
    await saveGame(fakeGame);

    const token = signSession({ userId: human.id, telegramId: 8901 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    try {
      const ack = await new Promise<any>((resolve, reject) => {
        client.on('connect_error', reject);
        client.on('connect', () => {
          client.emit('reconnect_game', { gameId }, (state: any) => resolve(state));
        });
      });

      expect(ack.found).toBe(true);
      expect(ack.opponent).toEqual({ telegramId: 0, firstName: 'Sardor' });
    } finally {
      client.close();
      await deleteGame(gameId);
      await pool.query(`DELETE FROM users WHERE telegram_id = 8901`);
    }
  });
```

Also add `getOrCreateBotUser` to the existing `import { upsertUser } from '../../src/users/userRepository';` line at the top of the file (change it to `import { upsertUser, getOrCreateBotUser } from '../../src/users/userRepository';`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/integration/socketServer.test.ts -t "includes opponent info"`
Expected: FAIL — `ack.opponent` is `undefined`.

- [ ] **Step 3: Implement**

In `backend/src/socket/socketServer.ts`, add the import:

```ts
import { getUserById } from '../users/userRepository';
```

Then change the `reconnect_game` handler from:

```ts
    socket.on('reconnect_game', ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      // A client that emits this event with no ack callback (buggy client,
      // or an old client build) would otherwise crash this handler on
      // `ack(...)` below ("ack is not a function") - there's no global
      // unhandledRejection handler in this backend, so that's a real
      // process-crash vector, not just a logged error.
      if (typeof ack !== 'function') return;

      // handleReconnect returns the GameState directly (or null) instead of
      // a boolean specifically so we don't need a second getGame() call here.
      // A second fetch would have its own gap between handleReconnect's
      // internal saveGame and this handler's own read - if the game
      // finishes/forfeits in that gap, getGame() would return null and
      // `game!.currentQuestionIndex` below would throw inside this handler.
      handleReconnect(gameId, socket.data.userId, socket.id)
        .then((game) => {
          if (!game) {
            ack({ found: false });
            return;
          }
          socket.join(gameId);
          socket.data.gameId = gameId;
          ack({
            found: true,
            currentQuestionIndex: game.currentQuestionIndex,
            scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
          });
        })
        .catch((err) => {
          console.error(`socketServer: failed to reconnect game ${gameId}`, err);
        });
    });
```

to:

```ts
    socket.on('reconnect_game', ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      // A client that emits this event with no ack callback (buggy client,
      // or an old client build) would otherwise crash this handler on
      // `ack(...)` below ("ack is not a function") - there's no global
      // unhandledRejection handler in this backend, so that's a real
      // process-crash vector, not just a logged error.
      if (typeof ack !== 'function') return;

      // handleReconnect returns the GameState directly (or null) instead of
      // a boolean specifically so we don't need a second getGame() call here.
      // A second fetch would have its own gap between handleReconnect's
      // internal saveGame and this handler's own read - if the game
      // finishes/forfeits in that gap, getGame() would return null and
      // `game!.currentQuestionIndex` below would throw inside this handler.
      handleReconnect(gameId, socket.data.userId, socket.id)
        .then(async (game) => {
          if (!game) {
            ack({ found: false });
            return;
          }
          socket.join(gameId);
          socket.data.gameId = gameId;

          // Same "who's the other player" derivation as matchmaker.ts's
          // createMatch: a bot's presented name comes from the match's own
          // botDisplayName (picked once at match start), never the DB's
          // literal "Bot" first_name.
          const opponentPlayer = game.players.find((p) => p.userId !== socket.data.userId);
          let opponent: { telegramId: number; firstName: string } | undefined;
          if (opponentPlayer) {
            const opponentUser = await getUserById(opponentPlayer.userId);
            if (opponentUser) {
              opponent = {
                telegramId: opponentUser.telegramId,
                firstName: opponentPlayer.isBot ? (game.botDisplayName ?? opponentUser.firstName) : opponentUser.firstName,
              };
            }
          }

          ack({
            found: true,
            currentQuestionIndex: game.currentQuestionIndex,
            scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
            opponent,
          });
        })
        .catch((err) => {
          console.error(`socketServer: failed to reconnect game ${gameId}`, err);
        });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/integration/socketServer.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/socketServer.ts backend/tests/integration/socketServer.test.ts
git commit -m "feat: include opponent info in the reconnect_game ack"
```

---

## Task 4: Avatar service — fetch + cache Telegram profile photos

**Files:**
- Create: `backend/src/users/avatarService.ts`
- Test: `backend/tests/users/avatarService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/users/avatarService.test.ts`:

```ts
import { redis, closeRedis } from '../../src/config/redis';
import { getAvatarBuffer } from '../../src/users/avatarService';

describe('avatarService', () => {
  const telegramId = 555001;

  afterEach(async () => {
    await redis.del(`avatar:${telegramId}`);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await closeRedis();
  });

  it('fetches and caches a photo from the Telegram API on a cold cache', async () => {
    const fakeImageBytes = Buffer.from('fake-jpeg-bytes');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              total_count: 1,
              photos: [[
                { file_id: 'small', width: 100, height: 100 },
                { file_id: 'big', width: 400, height: 400 },
              ]],
            },
          }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { file_id: 'big', file_path: 'photos/file_1.jpg' } }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageBytes.buffer.slice(fakeImageBytes.byteOffset, fakeImageBytes.byteOffset + fakeImageBytes.byteLength)),
      } as any);

    const result = await getAvatarBuffer(telegramId);

    expect(result).toEqual(fakeImageBytes);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const cached = await redis.getBuffer(`avatar:${telegramId}`);
    expect(cached).toEqual(fakeImageBytes);
  });

  it('returns the cached buffer on a second call without calling fetch again', async () => {
    const fakeImageBytes = Buffer.from('cached-bytes');
    await redis.set(`avatar:${telegramId}`, fakeImageBytes, 'EX', 3600);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await getAvatarBuffer(telegramId);

    expect(result).toEqual(fakeImageBytes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null and negative-caches when the user has no profile photos', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { total_count: 0, photos: [] } }),
    } as any);

    const result = await getAvatarBuffer(telegramId);
    expect(result).toBeNull();

    const cached = await redis.getBuffer(`avatar:${telegramId}`);
    expect(cached).toEqual(Buffer.alloc(0));
  });

  it('returns null on a second call for a negatively-cached user without calling fetch again', async () => {
    await redis.set(`avatar:${telegramId}`, Buffer.alloc(0), 'EX', 3600);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await getAvatarBuffer(telegramId);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null without throwing when the Telegram API call fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const result = await getAvatarBuffer(telegramId);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/users/avatarService.test.ts`
Expected: FAIL — `Cannot find module '../../src/users/avatarService'`.

- [ ] **Step 3: Implement**

Create `backend/src/users/avatarService.ts`:

```ts
import { redis } from '../config/redis';
import { env } from '../config/env';

const AVATAR_CACHE_TTL_SECONDS = 60 * 60 * 24;
// A confirmed "this user has no profile photo" is cached as an empty
// buffer (distinct from "we've never checked", which is a cache miss - i.e.
// redis.getBuffer returns null). Without this, every avatar request for a
// user with no photo would re-hit the Telegram API's two lookup calls on
// every single request (every match, both players) - real latency and
// unnecessary load for something that rarely changes.
const NO_PHOTO_SENTINEL = Buffer.alloc(0);

function avatarCacheKey(telegramId: number): string {
  return `avatar:${telegramId}`;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TelegramUserProfilePhotos {
  total_count: number;
  photos: TelegramPhotoSize[][];
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
}

export async function getAvatarBuffer(telegramId: number): Promise<Buffer | null> {
  const cached = await redis.getBuffer(avatarCacheKey(telegramId));
  if (cached !== null) {
    return cached.length === 0 ? null : cached;
  }

  const buffer = await fetchAvatarFromTelegram(telegramId);
  await redis.set(avatarCacheKey(telegramId), buffer ?? NO_PHOTO_SENTINEL, 'EX', AVATAR_CACHE_TTL_SECONDS);
  return buffer;
}

async function fetchAvatarFromTelegram(telegramId: number): Promise<Buffer | null> {
  try {
    const photosRes = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/getUserProfilePhotos?user_id=${telegramId}&limit=1`
    );
    const photosBody = (await photosRes.json()) as TelegramApiResponse<TelegramUserProfilePhotos>;
    if (!photosBody.ok || !photosBody.result || photosBody.result.photos.length === 0) return null;

    const sizes = photosBody.result.photos[0];
    const largest = sizes[sizes.length - 1];

    const fileRes = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/getFile?file_id=${largest.file_id}`
    );
    const fileBody = (await fileRes.json()) as TelegramApiResponse<TelegramFile>;
    if (!fileBody.ok || !fileBody.result?.file_path) return null;

    // Deliberately fetched server-side and returned as raw bytes below -
    // this URL embeds our bot token, so it must never reach the client (no
    // redirecting the browser here).
    const downloadRes = await fetch(
      `https://api.telegram.org/file/bot${env.telegramBotToken}/${fileBody.result.file_path}`
    );
    if (!downloadRes.ok) return null;

    const arrayBuffer = await downloadRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`avatarService: failed to fetch avatar for telegramId ${telegramId}`, err);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/users/avatarService.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/avatarService.ts backend/tests/users/avatarService.test.ts
git commit -m "feat: add avatarService to fetch/cache Telegram profile photos"
```

---

## Task 5: Avatar route + mount in `app.ts`

**Files:**
- Create: `backend/src/users/avatarRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/users/avatarRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/users/avatarRoutes.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import * as avatarService from '../../src/users/avatarService';
import { avatarRouter } from '../../src/users/avatarRoutes';

describe('GET /users/:telegramId/avatar', () => {
  const app = express();
  app.use(avatarRouter);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the image bytes with an image/jpeg content type when a photo is found', async () => {
    jest.spyOn(avatarService, 'getAvatarBuffer').mockResolvedValue(Buffer.from('fake-bytes'));

    const res = await request(app).get('/users/12345/avatar');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body).toEqual(Buffer.from('fake-bytes'));
  });

  it('returns 404 when no photo is available', async () => {
    jest.spyOn(avatarService, 'getAvatarBuffer').mockResolvedValue(null);

    const res = await request(app).get('/users/12345/avatar');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-numeric telegramId without calling the service', async () => {
    const spy = jest.spyOn(avatarService, 'getAvatarBuffer');

    const res = await request(app).get('/users/not-a-number/avatar');

    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/users/avatarRoutes.test.ts`
Expected: FAIL — `Cannot find module '../../src/users/avatarRoutes'`.

- [ ] **Step 3: Implement**

Create `backend/src/users/avatarRoutes.ts`:

```ts
import { Router } from 'express';
import { getAvatarBuffer } from './avatarService';

// Deliberately NOT behind requireAuth: a plain <img src> tag can't attach a
// Bearer token header, so a requireAuth-gated route would 401 on every image
// load and the feature would never work. Telegram profile photos aren't
// sensitive (anyone with the user's Telegram username can already see one),
// and telegramId is already public elsewhere in this app (the invite deep
// link t.me/bot?startapp=invite_<telegramId>).
export const avatarRouter = Router();

avatarRouter.get('/users/:telegramId/avatar', async (req, res) => {
  const telegramId = Number(req.params.telegramId);
  if (!Number.isFinite(telegramId)) {
    res.status(404).end();
    return;
  }

  const buffer = await getAvatarBuffer(telegramId);
  if (!buffer) {
    res.status(404).end();
    return;
  }

  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});
```

Then in `backend/src/app.ts`, add the import:

```ts
import { avatarRouter } from './users/avatarRoutes';
```

and mount it alongside the other `/api` routers - change:

```ts
  app.use('/api', statsRouter);
  app.use('/api', adminApiRouter);
  return app;
```

to:

```ts
  app.use('/api', statsRouter);
  app.use('/api', adminApiRouter);
  app.use('/api', avatarRouter);
  return app;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/users/avatarRoutes.test.ts && npx tsc --noEmit`
Expected: PASS, no TypeScript errors.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, all suites green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/users/avatarRoutes.ts backend/src/app.ts backend/tests/users/avatarRoutes.test.ts
git commit -m "feat: mount GET /api/users/:telegramId/avatar"
```

---

## Task 6: Frontend `useGameSocket.ts` — `OpponentInfo` type + `opponent` state

**Files:**
- Modify: `frontend/src/socket/useGameSocket.ts`
- Modify: `frontend/src/socket/useGameSocket.test.ts`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/socket/useGameSocket.test.ts`, change the `match_found` test from:

```ts
  it('exposes match_found, question, question_result, and game_over payloads as they arrive', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('match_found', { gameId: 'g1', category: 'umumiy_bilim' }));
    await waitFor(() => expect(result.current.matchFound).toEqual({ gameId: 'g1', category: 'umumiy_bilim' }));
```

to:

```ts
  it('exposes match_found, question, question_result, and game_over payloads as they arrive', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('match_found', {
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    await waitFor(() =>
      expect(result.current.matchFound).toEqual({
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    expect(result.current.opponent).toEqual({ telegramId: 999, firstName: 'Vali' });
```

Then add two new tests right after the `reconnectGame emits reconnect_game...` test:

```ts
  it('sets opponent from a reconnect_game ack when it includes one', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    fakeSocket.emit.mockImplementation((event: string, _payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        ack({ found: true, currentQuestionIndex: 2, scores: [], opponent: { telegramId: 42, firstName: 'Aziz' } });
      }
    });

    await result.current.reconnectGame('game-1');

    await waitFor(() => expect(result.current.opponent).toEqual({ telegramId: 42, firstName: 'Aziz' }));
  });

  it('clearOpponent resets opponent to null', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('match_found', {
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    await waitFor(() => expect(result.current.opponent).not.toBeNull());

    act(() => result.current.clearOpponent());
    expect(result.current.opponent).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/socket/useGameSocket.test.ts`
Expected: FAIL — `result.current.opponent` is `undefined`, `clearOpponent` is not a function.

- [ ] **Step 3: Implement**

In `frontend/src/socket/useGameSocket.ts`, add the new type right after `ScoreEntry` is imported:

```ts
export interface OpponentInfo {
  telegramId: number;
  firstName: string;
}
```

Change `MatchFoundPayload`:

```ts
export interface MatchFoundPayload {
  gameId: string;
  category: string;
}
```

to:

```ts
export interface MatchFoundPayload {
  gameId: string;
  category: string;
  opponent: OpponentInfo;
}
```

Change `ReconnectAck`:

```ts
export interface ReconnectAck {
  found: boolean;
  currentQuestionIndex?: number;
  scores?: ScoreEntry[];
}
```

to:

```ts
export interface ReconnectAck {
  found: boolean;
  currentQuestionIndex?: number;
  scores?: ScoreEntry[];
  opponent?: OpponentInfo;
}
```

In `UseGameSocketResult`, add `opponent`/`clearOpponent` - change:

```ts
export interface UseGameSocketResult {
  connected: boolean;
  matchFound: MatchFoundPayload | null;
  question: QuestionPayload | null;
  questionResult: QuestionResultPayload | null;
  gameOver: GameOverPayload | null;
  sessionReplaced: boolean;
  inviteCreated: boolean;
  inviteExpired: boolean;
```

to:

```ts
export interface UseGameSocketResult {
  connected: boolean;
  matchFound: MatchFoundPayload | null;
  opponent: OpponentInfo | null;
  question: QuestionPayload | null;
  questionResult: QuestionResultPayload | null;
  gameOver: GameOverPayload | null;
  sessionReplaced: boolean;
  inviteCreated: boolean;
  inviteExpired: boolean;
```

and further down in the same interface, add `clearOpponent` next to the other clear functions:

```ts
  clearMatchFound: () => void;
  clearQuestion: () => void;
```

to:

```ts
  clearMatchFound: () => void;
  clearOpponent: () => void;
  clearQuestion: () => void;
```

Inside the `useGameSocket` function body, add the new state right after `matchFound`'s:

```ts
  const [matchFound, setMatchFound] = useState<MatchFoundPayload | null>(null);
```

to:

```ts
  const [matchFound, setMatchFound] = useState<MatchFoundPayload | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
```

Change the `match_found` listener from:

```ts
    socket.on('match_found', (payload: MatchFoundPayload) => setMatchFound(payload));
```

to:

```ts
    socket.on('match_found', (payload: MatchFoundPayload) => {
      setMatchFound(payload);
      setOpponent(payload.opponent);
    });
```

Change the `reconnectGame` implementation from:

```ts
  const reconnectGame = useCallback((gameId: string): Promise<ReconnectAck> => {
    const socket = socketRef.current;
    const requestEpoch = epochRef.current;
    return new Promise((resolve) => {
      socket?.emit('reconnect_game', { gameId }, (ack: ReconnectAck) => {
        // The effect's cleanup bumps epochRef synchronously before it
        // disconnects the socket, so if that has already happened by the
        // time this ack arrives, the component has unmounted (or `token`
        // changed and a new socket has taken over) - resolving now would
        // hand a stale result to a caller that may no longer exist, or race
        // with state belonging to the new socket. Just drop it.
        if (epochRef.current !== requestEpoch) return;
        resolve(ack);
      });
    });
  }, []);
```

to:

```ts
  const reconnectGame = useCallback((gameId: string): Promise<ReconnectAck> => {
    const socket = socketRef.current;
    const requestEpoch = epochRef.current;
    return new Promise((resolve) => {
      socket?.emit('reconnect_game', { gameId }, (ack: ReconnectAck) => {
        // The effect's cleanup bumps epochRef synchronously before it
        // disconnects the socket, so if that has already happened by the
        // time this ack arrives, the component has unmounted (or `token`
        // changed and a new socket has taken over) - resolving now would
        // hand a stale result to a caller that may no longer exist, or race
        // with state belonging to the new socket. Just drop it.
        if (epochRef.current !== requestEpoch) return;
        if (ack.opponent) setOpponent(ack.opponent);
        resolve(ack);
      });
    });
  }, []);
```

Add `clearOpponent` next to the other clear callbacks - change:

```ts
  const clearMatchFound = useCallback(() => setMatchFound(null), []);
  const clearQuestion = useCallback(() => setQuestion(null), []);
```

to:

```ts
  const clearMatchFound = useCallback(() => setMatchFound(null), []);
  const clearOpponent = useCallback(() => setOpponent(null), []);
  const clearQuestion = useCallback(() => setQuestion(null), []);
```

Finally, add both to the returned object - change:

```ts
  return {
    connected,
    matchFound,
    question,
```

to:

```ts
  return {
    connected,
    matchFound,
    opponent,
    question,
```

and change:

```ts
    clearMatchFound,
    clearQuestion,
```

to:

```ts
    clearMatchFound,
    clearOpponent,
    clearQuestion,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/socket/useGameSocket.test.ts && npx tsc --noEmit`
Expected: PASS, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/socket/useGameSocket.ts frontend/src/socket/useGameSocket.test.ts
git commit -m "feat: add opponent state to useGameSocket"
```

---

## Task 7: `api/client.ts` — `getAvatarUrl` helper

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/api/client.test.ts`, at the end of the `describe` block:

```ts
  it('getAvatarUrl builds the avatar endpoint URL for a telegramId', () => {
    expect(getAvatarUrl(12345)).toBe('http://localhost:3000/api/users/12345/avatar');
  });
```

Update the import at the top of the file from:

```ts
import { apiGet, apiPost, ApiError } from './client';
```

to:

```ts
import { apiGet, apiPost, ApiError, getAvatarUrl } from './client';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `getAvatarUrl` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/api/client.ts`, add this export anywhere after the `API_URL` constant is declared:

```ts
export function getAvatarUrl(telegramId: number): string {
  return `${API_URL}/users/${telegramId}/avatar`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat: add getAvatarUrl helper"
```

---

## Task 8: `BattleAvatar` component

**Files:**
- Create: `frontend/src/components/BattleAvatar.tsx`
- Test: `frontend/src/components/BattleAvatar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/BattleAvatar.test.tsx`:

```tsx
// frontend/src/components/BattleAvatar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BattleAvatar } from './BattleAvatar';
import * as client from '../api/client';

describe('BattleAvatar', () => {
  it('renders an img pointed at the avatar URL when a telegramId is given', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} />);

    const img = screen.getByAltText('Foydalanuvchi rasmi') as HTMLImageElement;
    expect(img.src).toBe('https://api.example.com/users/123/avatar');
  });

  it('falls back to a generic icon when the image fails to load', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} />);

    const img = screen.getByAltText('Foydalanuvchi rasmi');
    fireEvent.error(img);

    expect(screen.queryByRole('img', { name: 'Foydalanuvchi rasmi' })).not.toHaveProperty('src');
    expect(screen.getByTestId('battle-avatar-fallback')).toBeInTheDocument();
  });

  it('shows the generic icon immediately when telegramId is null (no fetch attempted)', () => {
    const spy = vi.spyOn(client, 'getAvatarUrl');

    render(<BattleAvatar telegramId={null} />);

    expect(screen.getByTestId('battle-avatar-fallback')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('applies the given border color class', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} borderColorClass="border-ios-blue" />);

    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-ios-blue');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/BattleAvatar.test.tsx`
Expected: FAIL — `Cannot find module './BattleAvatar'`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/BattleAvatar.tsx`:

```tsx
// frontend/src/components/BattleAvatar.tsx
import { useState } from 'react';
import { getAvatarUrl } from '../api/client';

export function BattleAvatar({
  telegramId,
  size = 40,
  borderColorClass = '',
}: {
  telegramId: number | null;
  size?: number;
  borderColorClass?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (telegramId === null || errored) {
    return (
      <div
        data-testid="battle-avatar-fallback"
        className={`flex items-center justify-center rounded-full border-2 bg-ios-divider ${borderColorClass}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label="Foydalanuvchi rasmi"
      >
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="currentColor" className="text-ios-secondary-label">
          <path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9v2.4h19.6v-2.4c0-3.3-6.5-4.9-9.8-4.9z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={getAvatarUrl(telegramId)}
      alt="Foydalanuvchi rasmi"
      onError={() => setErrored(true)}
      className={`rounded-full border-2 object-cover ${borderColorClass}`}
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/BattleAvatar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BattleAvatar.tsx frontend/src/components/BattleAvatar.test.tsx
git commit -m "feat: add BattleAvatar component with fallback icon"
```

---

## Task 9: `BattleHeader` component (tug-of-war bar)

**Files:**
- Create: `frontend/src/components/BattleHeader.tsx`
- Test: `frontend/src/components/BattleHeader.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/BattleHeader.test.tsx`:

```tsx
// frontend/src/components/BattleHeader.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BattleHeader } from './BattleHeader';
import * as authContext from '../context/AuthContext';

describe('BattleHeader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 111, firstName: 'Aziz' } as any, loading: false, error: null,
    });
  });

  it('shows my name and the opponent name', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
      />
    );

    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('shows a fallback label when opponent is not yet known', () => {
    render(<BattleHeader scores={[]} opponent={null} />);
    expect(screen.getByText('Raqib')).toBeInTheDocument();
  });

  it('splits the bar 50/50 when scores are tied', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '50%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '50%' });
  });

  it('shifts the bar toward me when I am ahead', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 500 }, { userId: 2, score: 250 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
      />
    );

    // (500-250)/500*50 = 25 -> 50+25 = 75%
    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '75%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '25%' });
  });

  it('clamps the bar at 100%/0% for a very large lead', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 2000 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '0%' });
  });

  it('clamps the bar at 0%/100% for a very large deficit', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 2000 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '0%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '100%' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/BattleHeader.test.tsx`
Expected: FAIL — `Cannot find module './BattleHeader'`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/BattleHeader.tsx`:

```tsx
// frontend/src/components/BattleHeader.tsx
import { useAuth } from '../context/AuthContext';
import { BattleAvatar } from './BattleAvatar';
import { ScoreEntry } from '../api/types';
import { OpponentInfo } from '../socket/useGameSocket';
import { findMyScore, findOpponentScore } from '../utils/score';

// At a 500-point lead, the bar is fully at one edge. Chosen as a simple,
// legible starting point (a 7-question match's realistic score spread) -
// adjustable later without needing to touch anything else.
const MAX_SWING_POINTS = 500;

export function BattleHeader({
  scores,
  opponent,
}: {
  scores: ScoreEntry[];
  opponent: OpponentInfo | null;
}) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;
  const myScore = findMyScore(scores, myUserId);
  const opponentScore = findOpponentScore(scores, myUserId);

  const rawPosition = 50 + ((myScore - opponentScore) / MAX_SWING_POINTS) * 50;
  const position = Math.min(100, Math.max(0, rawPosition));

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BattleAvatar telegramId={user?.telegramId ?? null} size={36} borderColorClass="border-ios-blue" />
          <span className="text-sm font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          <BattleAvatar telegramId={opponent?.telegramId ?? null} size={36} borderColorClass="border-ios-red" />
        </div>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div data-testid="tugofwar-blue" className="h-full bg-ios-blue transition-all duration-300" style={{ width: `${position}%` }} />
        <div data-testid="tugofwar-red" className="h-full bg-ios-red transition-all duration-300" style={{ width: `${100 - position}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/BattleHeader.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BattleHeader.tsx frontend/src/components/BattleHeader.test.tsx
git commit -m "feat: add BattleHeader tug-of-war score bar"
```

---

## Task 10: `WaitingScreen.tsx` — "VS" reveal before entering battle

**Files:**
- Modify: `frontend/src/screens/WaitingScreen.tsx`
- Modify: `frontend/src/screens/WaitingScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/screens/WaitingScreen.test.tsx`, update `buildDefaultSocket()` to add the new fields - change:

```ts
  function buildDefaultSocket() {
    return {
      matchFound: null,
      clearMatchFound,
      leaveQueue,
      inviteCreated: false,
      clearInviteCreated,
      inviteExpired: false,
      clearInviteExpired,
      connected: true,
    };
  }
```

to:

```ts
  function buildDefaultSocket() {
    return {
      matchFound: null,
      opponent: null,
      clearMatchFound,
      leaveQueue,
      inviteCreated: false,
      clearInviteCreated,
      inviteExpired: false,
      clearInviteExpired,
      connected: true,
    };
  }
```

Add `beforeEach(() => vi.useFakeTimers())` / `afterEach(() => vi.useRealTimers())` to the top of the `describe` block - change:

```ts
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    replace.mockClear();
    goBack.mockClear();
    leaveQueue.mockClear();
    clearMatchFound.mockClear();
    clearInviteCreated.mockClear();
    clearInviteExpired.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate, goBack, replace, reset: vi.fn(),
    });
  });
```

to:

```ts
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    navigate.mockClear();
    replace.mockClear();
    goBack.mockClear();
    leaveQueue.mockClear();
    clearMatchFound.mockClear();
    clearInviteCreated.mockClear();
    clearInviteExpired.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate, goBack, replace, reset: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
```

Now replace the existing "replaces the current screen with battle when matchFound arrives" test - change:

```ts
  it('replaces the current screen with battle when matchFound arrives', async () => {
    mockSocket({ matchFound: { gameId: 'g1', category: 'umumiy_bilim' } as any });
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1' })
    );
    expect(clearMatchFound).toHaveBeenCalledOnce();
  });
```

to:

```ts
  it('shows a "VS" reveal with both names when matchFound arrives, then replaces with battle after the reveal delay', () => {
    mockSocket({
      matchFound: { gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' } } as any,
      opponent: { telegramId: 999, firstName: 'Vali' },
    });
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1' });
    expect(clearMatchFound).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/screens/WaitingScreen.test.tsx`
Expected: FAIL — no "VS" text rendered, `replace` is called immediately instead of after the delay.

- [ ] **Step 3: Implement**

Replace the whole contents of `frontend/src/screens/WaitingScreen.tsx` with:

```tsx
// frontend/src/screens/WaitingScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { categoryLabel } from '../utils/category';
import { buildInviteLink, shareInviteLink } from '../telegram/webApp';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';

const VS_REVEAL_MS = 1800;

export function WaitingScreen({
  category,
  intent,
}: {
  category: string;
  intent: 'quick' | 'invite' | 'joining';
}) {
  const { user } = useAuth();
  const { replace, goBack } = useNavigation();
  const {
    matchFound,
    opponent,
    clearMatchFound,
    leaveQueue,
    inviteCreated,
    clearInviteCreated,
    inviteExpired,
    clearInviteExpired,
    connected,
  } = useGameSocketContext();
  const [showVs, setShowVs] = useState(false);

  useEffect(() => {
    if (matchFound) {
      setShowVs(true);
    }
    // `GameSocketProvider` sits above `NavigationProvider`, so `matchFound`/
    // `inviteCreated`/`inviteExpired` persist across mount/unmount as the
    // user navigates between screens. Without this cleanup, a match that
    // lands right as the user cancels (leave_queue is fire-and-forget, no
    // ack) would sit in state and get picked up as stale data the next time
    // this screen mounts for an unrelated queue/invite. `opponent` is
    // deliberately NOT cleared here - it needs to survive into BattleScreen
    // (see BattleScreen's own unmount cleanup for where it's cleared).
    // clearMatchFound/clearInviteCreated/clearInviteExpired are all
    // idempotent, so this is safe to run unconditionally on unmount.
    return () => {
      clearMatchFound();
      clearInviteCreated();
      clearInviteExpired();
    };
  }, [matchFound, clearMatchFound, clearInviteCreated, clearInviteExpired]);

  useEffect(() => {
    if (!showVs || !matchFound) return;
    const timer = setTimeout(() => {
      replace({ name: 'battle', gameId: matchFound.gameId });
      clearMatchFound();
    }, VS_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [showVs, matchFound, replace, clearMatchFound]);

  const handleCancel = () => {
    if (intent === 'quick') {
      leaveQueue(category);
    }
    goBack();
  };

  const handleShare = () => {
    if (!user) return;
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    const link = buildInviteLink(botUsername, user.telegramId);
    shareInviteLink(link, "BilimBattle'da men bilan o'ynang!");
  };

  if (showVs) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-8 p-6 text-center">
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <BattleAvatar telegramId={user?.telegramId ?? null} size={72} borderColorClass="border-ios-blue" />
            <span className="font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
          </div>
          <span className="text-3xl font-black text-ios-label">VS</span>
          <div className="flex flex-col items-center gap-2">
            <BattleAvatar telegramId={opponent?.telegramId ?? null} size={72} borderColorClass="border-ios-red" />
            <span className="font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute h-20 w-20 animate-ping rounded-full bg-ios-blue/20" />
        <div className="h-14 w-14 rounded-full bg-ios-blue/10" />
      </div>
      <p className="text-lg font-medium text-ios-label">
        {intent === 'joining'
          ? "Do'stingiz o'yiniga ulanmoqda..."
          : `${categoryLabel(category)} bo'yicha raqib qidirilmoqda...`}
      </p>
      {!connected && (
        <p className="text-sm text-ios-red">Aloqa uzildi. Qayta ulanmoqda...</p>
      )}
      {inviteExpired && (
        <p className="text-sm text-ios-red">Taklif muddati tugadi yoki band.</p>
      )}
      {intent === 'invite' && inviteCreated && (
        <p className="text-sm text-ios-secondary-label">Havola yuborildi, do'stingiz kutilmoqda</p>
      )}
      <div className="flex w-full flex-col gap-3">
        {intent === 'invite' && (
          <PrimaryButton onClick={handleShare}>Do'stga ulashish</PrimaryButton>
        )}
        <SecondaryButton onClick={handleCancel}>Bekor qilish</SecondaryButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/WaitingScreen.test.tsx`
Expected: PASS, all tests in the file green (the other pre-existing tests - cancel, share, invite-expired, etc. - are unaffected since they never set `matchFound`, so `showVs` stays false and the normal waiting view renders exactly as before).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/WaitingScreen.tsx frontend/src/screens/WaitingScreen.test.tsx
git commit -m "feat: show a VS reveal in WaitingScreen before entering battle"
```

---

## Task 11: `BattleScreen.tsx` — swap `ScoreBar` for `BattleHeader`, wire `opponent`; delete `ScoreBar`

**Files:**
- Modify: `frontend/src/screens/BattleScreen.tsx`
- Modify: `frontend/src/screens/BattleScreen.test.tsx`
- Delete: `frontend/src/components/ScoreBar.tsx`
- Delete: `frontend/src/components/ScoreBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/screens/BattleScreen.test.tsx`, update the `mockSocket` default object - change:

```ts
  function mockSocket(overrides: Record<string, unknown> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      question: null,
      questionResult: null,
      gameOver: null,
      connected: true,
      submitAnswer,
      clearGameOver,
      clearQuestionResult,
      clearQuestion,
      reconnectGame,
      ...overrides,
    } as any);
  }
```

to:

```ts
  const clearOpponent = vi.fn();

  function mockSocket(overrides: Record<string, unknown> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      question: null,
      questionResult: null,
      gameOver: null,
      opponent: null,
      clearOpponent,
      connected: true,
      submitAnswer,
      clearGameOver,
      clearQuestionResult,
      clearQuestion,
      reconnectGame,
      ...overrides,
    } as any);
  }
```

Add `clearOpponent.mockClear();` to the existing `beforeEach`'s block of `.mockClear()` calls (right after `clearQuestion.mockClear();`).

Add two new tests at the end of the `describe` block, right before the final closing `});`:

```ts
  it('renders the opponent name from context inside the header', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      opponent: { telegramId: 222, firstName: 'Vali' },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('clears opponent on unmount', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { unmount } = render(<BattleScreen gameId="g1" />);

    unmount();

    expect(clearOpponent).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: FAIL — `clearOpponent` was never called, "Vali" isn't rendered (BattleScreen still renders the old `ScoreBar`, which doesn't show names).

- [ ] **Step 3: Implement**

In `frontend/src/screens/BattleScreen.tsx`, change the imports from:

```tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { ScoreBar } from '../components/ScoreBar';
import { CountdownTimer } from '../components/CountdownTimer';
import { ScoreEntry } from '../api/types';
import { playSelectFeedback, playCorrectFeedback, playIncorrectFeedback } from '../utils/feedback';
```

to:

```tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { BattleHeader } from '../components/BattleHeader';
import { CountdownTimer } from '../components/CountdownTimer';
import { ScoreEntry } from '../api/types';
import { playSelectFeedback, playCorrectFeedback, playIncorrectFeedback } from '../utils/feedback';
```

Change the destructured context values from:

```tsx
  const {
    question,
    questionResult,
    gameOver,
    connected,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    clearQuestion,
    reconnectGame,
  } = useGameSocketContext();
```

to:

```tsx
  const {
    question,
    questionResult,
    gameOver,
    opponent,
    clearOpponent,
    connected,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    clearQuestion,
    reconnectGame,
  } = useGameSocketContext();
```

Change the unmount-cleanup effect from:

```tsx
  useEffect(() => {
    return () => {
      clearQuestion();
      clearQuestionResult();
      clearGameOver();
    };
  }, [clearQuestion, clearQuestionResult, clearGameOver]);
```

to:

```tsx
  useEffect(() => {
    return () => {
      clearQuestion();
      clearQuestionResult();
      clearGameOver();
      clearOpponent();
    };
  }, [clearQuestion, clearQuestionResult, clearGameOver, clearOpponent]);
```

Change the JSX from:

```tsx
      <div className="flex items-center justify-between gap-4">
        <ScoreBar scores={questionResult?.scores ?? restoredScores} />
        <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
      </div>
```

to:

```tsx
      <div className="flex flex-col gap-3">
        <BattleHeader scores={questionResult?.scores ?? restoredScores} opponent={opponent} />
        <div className="flex justify-end">
          <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
        </div>
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Delete the now-unused `ScoreBar`**

`ScoreBar` was only ever used from `BattleScreen.tsx` (confirmed by searching the whole `frontend/src` tree for other references before writing this plan) - now that BattleScreen uses `BattleHeader` instead, it's dead code.

```bash
rm frontend/src/components/ScoreBar.tsx frontend/src/components/ScoreBar.test.tsx
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, no TypeScript errors (deleting ScoreBar.tsx must not leave any dangling import anywhere - `tsc --noEmit` will catch it if it does), production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/BattleScreen.tsx frontend/src/screens/BattleScreen.test.tsx
git rm frontend/src/components/ScoreBar.tsx frontend/src/components/ScoreBar.test.tsx
git commit -m "feat: wire BattleHeader/opponent into BattleScreen, remove ScoreBar"
```

---

## Final check

- [ ] Run the full backend suite: `cd backend && npx tsc --noEmit && npm test` — expect all suites green.
- [ ] Run the full frontend suite: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` — expect all suites green, build succeeds.
- [ ] Manually verify in a real Telegram session (two accounts) per the project's established manual-QA habit: start a quick match, confirm the "VS" reveal shows both names/avatars, confirm the tug-of-war bar shifts correctly as each side answers, confirm a bot-fallback match shows a random Uzbek name (never "Bot"), and confirm reconnecting mid-match still shows the opponent panel.

## Type consistency check (self-review)

- `OpponentInfo { telegramId: number; firstName: string }` — defined once in `frontend/src/socket/useGameSocket.ts` (Task 6), imported by `BattleHeader.tsx` (Task 9) and referenced identically in `WaitingScreen.tsx` (Task 10) via the context's `opponent` field. Same shape used on the backend in `matchmaker.ts`'s inline `match_found` payload and `socketServer.ts`'s `reconnect_game` ack (Tasks 2, 3) - not a shared type across the language boundary (as expected; wire payloads are just plain JSON matching this shape).
- `BOT_DISPLAY_NAMES`/`pickRandomBotDisplayName` — defined and exported once in `matchmaker.ts` (Task 2), imported in its own test file only.
- `getAvatarBuffer` — defined once in `avatarService.ts` (Task 4), used only by `avatarRoutes.ts` (Task 5) and its own test.
- `getAvatarUrl` — defined once in `api/client.ts` (Task 7), used by `BattleAvatar.tsx` (Task 8).
- `startGame`'s new `botDisplayName?: string` parameter (Task 1) is threaded through by `createMatch` (Task 2) exactly as declared - no signature drift.

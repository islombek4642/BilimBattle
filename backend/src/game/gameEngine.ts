import { getIO } from '../socket/socketServer';
import { getGame, saveGame, deleteGame, GameState } from './gameState';
import { calculateScore, QUESTION_TIME_LIMIT_MS } from './scoring';
import { getRandomQuestions, QuestionRecord } from '../questions/questionRepository';
import { recordMatchResult } from '../users/userRepository';
import { env } from '../config/env';

export interface PlayerInfo {
  userId: number;
  socketId: string;
  isBot?: boolean;
}

const QUESTIONS_PER_GAME = 15;
// A player's HP is derived, not stored: myHP = HP_MAX - opponentScore. So
// "opponent's score has reached HP_MAX" and "opponent's HP has reached 0"
// are the exact same condition - this constant is the only new piece of
// state this feature needs.
const HP_MAX = 500;
// In-process only (not persisted, not shared across instances). A game that
// never reaches finishGame (process crash, or a player abandoning mid-game
// with no reconnect support yet) simply leaves its entry here until the
// pending timer fires after QUESTION_TIME_LIMIT_MS, at which point it
// self-cleans via the resolveQuestion()/finishGame() chain (see the .catch()
// below for what happens if that chain itself fails). Task 18 adds
// disconnect/reconnect handling to this file and may need to revisit this.
const activeTimers = new Map<string, NodeJS.Timeout>();

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

async function sendNextQuestion(gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.currentQuestionIndex += 1;
  if (game.currentQuestionIndex >= game.questions.length) {
    await finishGame(gameId);
    return;
  }
  game.questionStartedAt = Date.now();
  await saveGame(game);
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question', {
    index: game.currentQuestionIndex,
    total: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitMs: QUESTION_TIME_LIMIT_MS,
  });

  const botPlayer = game.players.find((p) => p.isBot);
  if (botPlayer) {
    scheduleBotAnswer(gameId, botPlayer.userId, game.currentQuestionIndex, question);
  }

  const timer = setTimeout(() => {
    // resolveQuestion is async; if it rejects (e.g. Redis/Postgres is down,
    // or — as happens in tests — the connection was already torn down for an
    // abandoned game) an unawaited rejection here would surface as an
    // unhandled promise rejection and can crash the process. Log and swallow
    // instead so one bad game can't take down the server.
    resolveQuestion(gameId).catch((err) => {
      console.error(`gameEngine: failed to resolve question timeout for game ${gameId}`, err);
    });
  }, QUESTION_TIME_LIMIT_MS);
  activeTimers.set(gameId, timer);
}

function scheduleBotAnswer(gameId: string, botUserId: number, questionIndex: number, question: QuestionRecord): void {
  const delay = 2000 + Math.random() * 6000;
  const willAnswerCorrectly = Math.random() < 0.7;
  const selected = willAnswerCorrectly ? question.correctIndex : (question.correctIndex + 1) % question.options.length;
  setTimeout(() => {
    // Pass the question index this answer was computed for — submitAnswer
    // re-validates it against the live game state atomically (in the same
    // fetch used to apply the answer) so a delayed bot timer that fires after
    // the game has already moved to a later question can never misapply a
    // stale `selected` choice (computed from THIS question's correctIndex)
    // to a DIFFERENT question. Also guards against the game having finished
    // or been abandoned/deleted in the meantime.
    submitAnswer(gameId, botUserId, selected, questionIndex).catch((err) => {
      console.error(`gameEngine: bot answer failed for game ${gameId}`, err);
    });
  }, delay);
}

export async function submitAnswer(
  gameId: string,
  userId: number,
  selectedOption: number,
  expectedQuestionIndex?: number
): Promise<void> {
  // NOT ATOMIC: getGame -> mutate in memory -> saveGame is a read-modify-write
  // across two separate Redis round-trips (same class of issue documented in
  // matchmaking/queue.ts's popTwoIfAvailable). Safe for the current
  // single-instance MVP since each Socket.io event handler runs to
  // completion within one event-loop tick before the next 'submit_answer'
  // event is processed, but this would need a Lua script / WATCH-based
  // transaction if this ever needs to be safe against truly concurrent
  // writers to the same game (e.g. multiple server instances).
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  if (expectedQuestionIndex !== undefined && game.currentQuestionIndex !== expectedQuestionIndex) return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return;
  if (player.answers[game.currentQuestionIndex] != null) return;

  const answerTimeMs = Date.now() - (game.questionStartedAt ?? Date.now());
  const question = game.questions[game.currentQuestionIndex];
  const isCorrect = selectedOption === question.correctIndex;
  const points = calculateScore(isCorrect, answerTimeMs);
  player.answers[game.currentQuestionIndex] = { selectedOption, points };
  player.score += points;
  await saveGame(game);

  const bothAnswered = game.players.every((p) => p.answers[game.currentQuestionIndex] != null);
  if (bothAnswered) {
    const timer = activeTimers.get(gameId);
    if (timer) clearTimeout(timer);
    await resolveQuestion(gameId);
  }
}

async function resolveQuestion(gameId: string): Promise<void> {
  activeTimers.delete(gameId);
  const game = await getGame(gameId);
  if (!game) return;
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question_result', {
    index: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
  });
  // Give clients a moment to actually see the correct-answer reveal before
  // the next question replaces it - without this, sendNextQuestion below ran
  // in the very same tick as the emit above, so the green/red highlight was
  // effectively invisible (reported from live testing: "bosilishi bilan
  // tezda keyingi savolga o'tib ketyapti"). env.resultRevealMs defaults to 0
  // (no delay) so local dev and the test suite - which play through full
  // matches in a tight loop - stay fast; production sets a real value via
  // docker-compose.
  if (env.resultRevealMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.resultRevealMs));
  }

  // A player's score reaching HP_MAX means the OPPONENT's derived HP has
  // reached 0 - end the match right now instead of waiting for the
  // remaining questions. If both players cross HP_MAX in the very same
  // round (both answered this question correctly), finishGame's existing
  // winner-determination logic (higher score wins, exact tie = draw)
  // handles it correctly with no extra logic needed here.
  const anyoneKnockedOut = game.players.some((p) => p.score >= HP_MAX);
  if (anyoneKnockedOut) {
    await finishGame(gameId, { knockout: true });
    return;
  }

  await sendNextQuestion(gameId);
}

// recordMatchResult() runs strictly AFTER the game_over event has already
// been emitted to clients (both callers below emit first). If it throws - a
// transient Postgres error, pool exhaustion, or - as actually happened during
// the Task 24 load test - a caller's userId not corresponding to a real
// `users` row, tripping the `matches` table's FK constraint - that must not
// stop deleteGame() from running afterward. Clients already believe the match
// is over; leaving the Redis key around wouldn't undo that belief, it would
// just leave stale "finished" game state occupying Redis for up to
// GAME_TTL_SECONDS on top of the match record being lost. So this is
// deliberately swallow-and-log rather than swallow-and-retry: there's no
// retry queue at this MVP stage, and keeping the game "alive" in Redis just
// to retry a DB write later would leave clients who were already told
// game_over stuck in limbo for no benefit - the match is over either way. The
// error log carries every field needed to hand-reconstruct and manually
// re-insert the match later (gameId, category, both player IDs/scores,
// winnerId) since there is currently no automated way to recover it.
async function persistMatchResult(
  gameId: string,
  params: Parameters<typeof recordMatchResult>[0]
): Promise<void> {
  try {
    await recordMatchResult(params);
  } catch (err) {
    console.error(
      `gameEngine: recordMatchResult FAILED for game ${gameId} - match result was NOT persisted ` +
        `(clients were already told the game is over). Context for manual recovery: ` +
        `category=${params.category}, player1Id=${params.player1Id}, player1Score=${params.player1Score}, ` +
        `player2Id=${params.player2Id}, player2Score=${params.player2Score}, winnerId=${params.winnerId}`,
      err
    );
  }
}

// `socket.data.gameId` is set once when a match starts (matchmaker.ts) or a
// reconnect succeeds (socketServer.ts's reconnect_game handler), but nothing
// ever cleared it back to undefined when the match ended - so every
// join_queue/create_invite/join_invite call on that same long-lived socket
// after a player's FIRST game would be silently ignored forever by the
// `if (socket.data.gameId) return;` guards in socketServer.ts, since the
// socket still looked like it was "in an active game" that no longer
// existed. This is called from every path that ends a game (finishGame,
// forfeitIfStillDisconnected) so a player's socket becomes queueable again
// the moment their match is actually over. Bot "sockets" (socketId: 'bot')
// simply resolve to `undefined` here and are skipped harmlessly.
function clearSocketGameId(players: { socketId: string }[]): void {
  for (const player of players) {
    const socket = getIO().sockets.sockets.get(player.socketId);
    if (socket) socket.data.gameId = undefined;
  }
}

async function finishGame(gameId: string, opts?: { knockout?: boolean }): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId,
    knockout: opts?.knockout ?? false,
  });

  await persistMatchResult(gameId, {
    category: game.category,
    player1Id: p1.userId,
    player2Id: p2.userId,
    player1Score: p1.score,
    player2Score: p2.score,
    winnerId,
  });

  const timer = activeTimers.get(gameId);
  if (timer) clearTimeout(timer);
  activeTimers.delete(gameId);

  clearSocketGameId(game.players);
  await deleteGame(gameId);
}

const RECONNECT_GRACE_MS = 10_000;

interface DisconnectEntry {
  timer: NodeJS.Timeout;
  version: number;
}

// Same lifecycle caveat as activeTimers above: in-process only, keyed by
// `${gameId}:${userId}` so each player's grace period is tracked
// independently. Always cleared by exactly one of: a reconnect
// (handleReconnect), the grace timer itself firing (forfeitIfStillDisconnected
// deletes its own entry first thing), or superseded by a later disconnect.
//
// Each entry also carries a monotonically increasing `version`. This isn't
// just for the same-tick double-disconnect case (clearing a stale timer
// before scheduling a new one) - it's required because handleDisconnect and
// handleReconnect are both async with a `getGame`/`saveGame` round trip in
// the middle, so a *slower* handleReconnect call started before a *faster*
// handleDisconnect call can still finish after it: disconnect(D1) schedules
// timer T1 -> reconnect(R) starts awaiting getGame/saveGame -> disconnect(D2)
// arrives and runs to completion first (clears T1, schedules T2) -> R finally
// resumes and would, without a version check, clear whatever timer is
// CURRENTLY in the map (T2) and delete the map entry - leaving
// player.disconnectedAt set (from D2) but with NO pending timer at all. The
// game would then be stuck with a disconnected player and no forfeit would
// ever fire until the 30-minute Redis TTL silently drops it. Stamping each
// scheduled timer with the version that was current when *it* was created,
// and having every consumer (reconnect, and the timer callback itself)
// compare against the CURRENT map entry's version before acting, makes each
// operation only affect the timer it actually knows about.
const disconnectTimers = new Map<string, DisconnectEntry>();
let nextDisconnectVersion = 0;

export async function handleDisconnect(gameId: string, userId: number): Promise<void> {
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return;
  player.disconnectedAt = Date.now();
  await saveGame(game);

  const timerKey = `${gameId}:${userId}`;
  // A flaky connection can call handleDisconnect twice in a row with no
  // reconnect in between (disconnect -> disconnect again). Without clearing
  // any previous timer first, disconnectTimers.set() below would silently
  // overwrite the map entry while the FIRST setTimeout keeps running
  // underneath - forfeitIfStillDisconnected would then fire twice for the same
  // (gameId, userId). Clearing the existing timer first guarantees at most
  // one pending forfeit timer per (gameId, userId) and makes repeated
  // disconnects simply restart the grace window, which is also the right
  // user-facing behavior.
  const existing = disconnectTimers.get(timerKey);
  if (existing) clearTimeout(existing.timer);

  const version = ++nextDisconnectVersion;
  const timer = setTimeout(() => {
    // Fire-and-forget, same discipline as the question-timeout timer above:
    // forfeitIfStillDisconnected is async and this callback isn't awaited by
    // anything, so an unhandled rejection here would crash the process.
    forfeitIfStillDisconnected(gameId, userId, version).catch((err) => {
      console.error(`gameEngine: failed to process forfeit for game ${gameId}, user ${userId}`, err);
    });
  }, RECONNECT_GRACE_MS);
  disconnectTimers.set(timerKey, { timer, version });
}

export async function handleReconnect(gameId: string, userId: number, newSocketId: string): Promise<GameState | null> {
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return null;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return null;

  player.socketId = newSocketId;
  player.disconnectedAt = undefined;
  await saveGame(game);

  // Clear whatever timer is currently registered for this key. saveGame()
  // above just wrote disconnectedAt = undefined, so no forfeit timer should
  // be left pending for this player regardless of which disconnect it
  // originally belonged to - if a newer disconnect raced ahead of this
  // reconnect and is still genuinely in effect, its own handleDisconnect call
  // is the one that wrote the last disconnectedAt value into Redis (RMW: last
  // saveGame wins), not this one, so there's nothing to reconcile here. The
  // version check in forfeitIfStillDisconnected below is what actually
  // guarantees correctness even if this ends up clearing a timer that another
  // in-flight disconnect/reconnect call still thinks is "theirs" - a cleared
  // timer callback simply never runs, and a callback that isn't cleared but
  // has since been superseded is a no-op because its version no longer
  // matches the map.
  const timerKey = `${gameId}:${userId}`;
  const existing = disconnectTimers.get(timerKey);
  if (existing) {
    clearTimeout(existing.timer);
    disconnectTimers.delete(timerKey);
  }
  return game;
}

async function forfeitIfStillDisconnected(gameId: string, userId: number, version: number): Promise<void> {
  const timerKey = `${gameId}:${userId}`;
  const current = disconnectTimers.get(timerKey);
  // A newer disconnect (or a reconnect) has superseded this callback's timer
  // since it was scheduled - it's no longer the current/authoritative one for
  // this key, so it must not act. This is exactly what prevents the
  // lost-forfeit race described above.
  if (!current || current.version !== version) return;
  disconnectTimers.delete(timerKey);
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player?.disconnectedAt) return;

  const opponent = game.players.find((p) => p.userId !== userId)!;

  // RECONNECT_GRACE_MS currently equals QUESTION_TIME_LIMIT_MS, so it's
  // possible for this timer and the pending question-timeout timer
  // (activeTimers) to be scheduled for the exact same instant and both fire
  // in the same tick (this happens in gameEngineDisconnect.test.ts, which
  // disconnects a player immediately after startGame - i.e. right as the
  // first question's timer is armed). Clearing whatever question timer is
  // currently registered for this game prevents a stale next-question timer
  // from firing after we've already ended the match via forfeit below.
  //
  // There remains the same class of non-atomic read-modify-write race already
  // documented on submitAnswer()/finishGame(): resolveQuestion()'s own
  // saveGame() could race with this function's saveGame() if both read the
  // game before either writes. In practice this is benign here -
  // resolveQuestion() only ever advances the question index or calls
  // finishGame(); it never resets status back to 'active', and both this
  // function and finishGame() null-check getGame()'s result before acting, so
  // whichever of "forfeit" or "natural finish" writes `status: 'finished'`
  // and deletes the game first "wins", and the other observes a missing/
  // non-active game and safely no-ops. A true simultaneous forfeit-and-finish
  // could in the worst case double-call recordMatchResult - the same
  // MVP-acceptable tradeoff already made elsewhere in this file.
  // Matches finishGame()'s cleanup exactly (clear AND remove the map entry,
  // not just clearTimeout) so no stale handle for this gameId lingers in
  // activeTimers after the match ends via forfeit.
  const timer = activeTimers.get(gameId);
  if (timer) clearTimeout(timer);
  activeTimers.delete(gameId);

  game.status = 'finished';
  await saveGame(game);

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId: opponent.userId,
    forfeited: true,
  });

  await persistMatchResult(gameId, {
    category: game.category,
    player1Id: game.players[0].userId,
    player2Id: game.players[1].userId,
    player1Score: game.players[0].score,
    player2Score: game.players[1].score,
    winnerId: opponent.userId,
  });

  clearSocketGameId(game.players);
  await deleteGame(gameId);
}

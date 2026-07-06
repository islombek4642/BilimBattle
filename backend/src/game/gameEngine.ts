import { getIO } from '../socket/socketServer';
import { getGame, saveGame, deleteGame, GameState } from './gameState';
import { calculateScore, QUESTION_TIME_LIMIT_MS } from './scoring';
import { getRandomQuestions, QuestionRecord } from '../questions/questionRepository';
import { recordMatchResult } from '../users/userRepository';

export interface PlayerInfo {
  userId: number;
  socketId: string;
  isBot?: boolean;
}

const QUESTIONS_PER_GAME = 7;
// In-process only (not persisted, not shared across instances). A game that
// never reaches finishGame (process crash, or a player abandoning mid-game
// with no reconnect support yet) simply leaves its entry here until the
// pending timer fires after QUESTION_TIME_LIMIT_MS, at which point it
// self-cleans via the resolveQuestion()/finishGame() chain (see the .catch()
// below for what happens if that chain itself fails). Task 18 adds
// disconnect/reconnect handling to this file and may need to revisit this.
const activeTimers = new Map<string, NodeJS.Timeout>();

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
  await sendNextQuestion(gameId);
}

async function finishGame(gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId,
  });

  await recordMatchResult({
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

  await deleteGame(gameId);
}

import { redis } from '../config/redis';
import { QuestionRecord } from '../questions/questionRepository';

export interface PlayerAnswer {
  selectedOption: number;
  points: number;
}

export interface PlayerState {
  userId: number;
  socketId: string;
  score: number;
  answers: (PlayerAnswer | null)[];
  isBot: boolean;
  disconnectedAt?: number;
}

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
  // Only set for level-mode matches (see matchmaking/matchmaker.ts's
  // handleJoinLevelQueue). Its presence is what gameEngine.ts's
  // resolveQuestion() checks to skip the knockout early-ending entirely -
  // level-mode matches always play through the full question pool.
  level?: number;
}

const GAME_TTL_SECONDS = 60 * 30;

function gameKey(gameId: string): string {
  return `game:${gameId}`;
}

export async function saveGame(game: GameState): Promise<void> {
  await redis.set(gameKey(game.gameId), JSON.stringify(game), 'EX', GAME_TTL_SECONDS);
}

export async function getGame(gameId: string): Promise<GameState | null> {
  const raw = await redis.get(gameKey(gameId));
  return raw ? JSON.parse(raw) : null;
}

export async function deleteGame(gameId: string): Promise<void> {
  await redis.del(gameKey(gameId));
}

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
  answers: (PlayerAnswer | undefined)[];
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

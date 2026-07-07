import { ScoreEntry } from '../api/types';

export function findMyScore(scores: ScoreEntry[], myUserId: number): number {
  return scores.find((s) => s.userId === myUserId)?.score ?? 0;
}

export function findOpponentScore(scores: ScoreEntry[], myUserId: number): number {
  return scores.find((s) => s.userId !== myUserId)?.score ?? 0;
}

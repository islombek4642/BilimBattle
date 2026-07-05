import { redis } from '../../src/config/redis';
import { saveGame, getGame, deleteGame, GameState } from '../../src/game/gameState';

describe('gameState', () => {
  const sampleGame: GameState = {
    gameId: 'test-game-1',
    category: 'umumiy_bilim',
    questions: [{ id: 1, text: 'Q1?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
    currentQuestionIndex: -1,
    players: [
      { userId: 1, socketId: 'sock1', score: 0, answers: [], isBot: false },
      { userId: 2, socketId: 'sock2', score: 0, answers: [], isBot: false },
    ],
    status: 'active',
  };

  afterEach(async () => {
    await deleteGame('test-game-1');
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('saves and retrieves a game by id', async () => {
    await saveGame(sampleGame);
    const loaded = await getGame('test-game-1');
    expect(loaded).toEqual(sampleGame);
  });

  it('returns null for a game that does not exist', async () => {
    const loaded = await getGame('nonexistent');
    expect(loaded).toBeNull();
  });

  it('deletes a game', async () => {
    await saveGame(sampleGame);
    await deleteGame('test-game-1');
    const loaded = await getGame('test-game-1');
    expect(loaded).toBeNull();
  });
});

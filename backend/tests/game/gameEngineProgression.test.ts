import { pool } from '../../src/config/db';
import { closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { getGame } from '../../src/game/gameState';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';
import * as questionRepository from '../../src/questions/questionRepository';
import * as xpRepository from '../../src/progression/xpRepository';
import { getSubjectProgress } from '../../src/progression/xpRepository';
import { getTodayProgress } from '../../src/progression/dailyProgressRepository';

function createFakeIO() {
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; emit: () => void }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, { id, data: {}, emit() {} });
          }
          return sockets.get(id);
        },
      },
    },
    to() {
      return { emit() {} };
    },
  };
  return { fakeIO };
}

describe('gameEngine progression integration', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7101, 'progressionP1', 'ProgressionP1', null);
    const p2 = await upsertUser(7102, 'progressionP2', 'ProgressionP2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM level_progress WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM matches WHERE player1_id IN ($1, $2) OR player2_id IN ($1, $2)`, [player1Id, player2Id]);
    // Real ingliz_tili matches with real correct answers award real
    // user_achievements rows via the existing awardMatchAchievementsForRealPlayers
    // call in gameEngine.ts - must be cleared before the final DELETE FROM
    // users below, or that DELETE trips user_achievements_user_id_fkey. Same
    // pattern as gameEngineDisconnect.test.ts's afterAll.
    await pool.query(`DELETE FROM user_achievements WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7101, 7102)`);
    await pool.end();
    await closeRedis();
  });

  it('awards XP and CEFR-weighted mastery points to both real players after an ingliz_tili level match', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // Mixed CEFR tiers so the mastery-points assertion below actually
    // exercises the weighting, not just a flat per-question count.
    const fixtureQuestions = [
      { id: 910100, text: 'Q0', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'A1' },
      { id: 910101, text: 'Q1', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'C2' },
    ];
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 77);

    // player1 answers both correctly (A1 weight 1 + C2 weight 6 = 7 mastery points).
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);
    await submitAnswer(gameId, player1Id, 0, 1);
    await submitAnswer(gameId, player2Id, 1, 1);

    const progress1 = await getSubjectProgress(player1Id, 'ingliz_tili');
    expect(progress1.masteryPoints).toBe(7);
    expect(progress1.xp).toBeGreaterThan(0);

    const progress2 = await getSubjectProgress(player2Id, 'ingliz_tili');
    expect(progress2.masteryPoints).toBe(0); // answered every question wrong

    getQuestionsForLevelSpy.mockRestore();
  });

  it("counts the match toward today's Daily Quest progress for the real player", async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 910200 + i,
      text: `DAILY_Q${i}`,
      options: ['a', 'b'],
      correctIndex: 0,
      cefrLevel: 'A1',
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 78);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round); // always correct -> 3 stars
      await submitAnswer(gameId, player2Id, 1, round); // always wrong
    }

    const daily1 = await getTodayProgress(player1Id);
    expect(daily1.matchesPlayed).toBeGreaterThanOrEqual(1);
    expect(daily1.bestStarsToday).toBe(3);

    getQuestionsForLevelSpy.mockRestore();
  });

  it('does not create a subject_xp row for a bot opponent', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = [{ id: 910300, text: 'Q0', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'A1' }];
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(
      gameId,
      'ingliz_tili',
      { userId: player1Id, socketId: 'sock1' },
      { userId: player2Id, socketId: 'sock2', isBot: true },
      undefined,
      79
    );

    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);

    const botProgress = await getSubjectProgress(player2Id, 'ingliz_tili');
    expect(botProgress).toEqual({ xp: 0, masteryPoints: 0 });

    getQuestionsForLevelSpy.mockRestore();
  });

  it('does not track progression for non-English categories', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = [{ id: 910400, text: 'Q0', options: ['a', 'b'], correctIndex: 0 }];
    const getRandomQuestionsSpy = jest
      .spyOn(questionRepository, 'getRandomQuestions')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);

    const progress = await getSubjectProgress(player1Id, 'umumiy_bilim');
    expect(progress).toEqual({ xp: 0, masteryPoints: 0 });

    getRandomQuestionsSpy.mockRestore();
  });

  it("keeps player2's progression update and still completes match cleanup when player1's progression update throws", async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = [{ id: 910500, text: 'Q0', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'A1' }];
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    // Simulate exactly the risk progressionService.ts's per-player try/catch
    // is meant to guard against: player1's addSubjectProgress call rejects
    // (standing in for recordDailyActivity's documented "throws for a bad
    // userId" behavior), while player2's call goes through normally via the
    // real implementation.
    const originalAddSubjectProgress = xpRepository.addSubjectProgress;
    const addSubjectProgressSpy = jest
      .spyOn(xpRepository, 'addSubjectProgress')
      .mockImplementation((userId, category, xpDelta, masteryPointsDelta) => {
        if (userId === player1Id) {
          return Promise.reject(new Error('simulated progression failure for player1'));
        }
        return originalAddSubjectProgress(userId, category, xpDelta, masteryPointsDelta);
      });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 81);

    // Both answer correctly - only player1's write is made to fail.
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 0, 0);

    // The match still finished cleanly: finishGame's cleanup (timer teardown,
    // clearSocketGameId, deleteGame) ran to completion despite player1's
    // progression update throwing partway through the loop.
    const gameAfter = await getGame(gameId);
    expect(gameAfter).toBeNull();

    // Player2's update was NOT skipped just because player1's update threw
    // first in the same loop - this is the actual behavior the per-player
    // try/catch exists to guarantee.
    const progress2 = await getSubjectProgress(player2Id, 'ingliz_tili');
    expect(progress2.masteryPoints).toBe(1);
    expect(progress2.xp).toBeGreaterThan(0);

    // The failure was logged with enough context to identify it, not
    // silently swallowed with no trace (same discipline persistMatchResult's
    // failure path is tested for elsewhere in gameEngine.test.ts).
    const failureLog = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('updateProgressionForRealPlayers FAILED')
    );
    expect(failureLog).toBeDefined();
    expect(failureLog![0]).toContain(String(player1Id));

    getQuestionsForLevelSpy.mockRestore();
    addSubjectProgressSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

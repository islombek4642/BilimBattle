import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { handleJoinQueue, handleJoinLevelQueue, createMatch, cancelWaiting, BOT_DISPLAY_NAMES } from '../../src/matchmaking/matchmaker';
import { upsertUser, getOrCreateBotUser } from '../../src/users/userRepository';
import { upsertLevelProgress } from '../../src/game/levelProgress';
import * as gameEngine from '../../src/game/gameEngine';

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
    await redis.del('queue:level:1');
    await redis.del('queue:level:2');
    await redis.del('queue:level:50');
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

  it('handleJoinLevelQueue pairs two players who queued for the SAME level and starts a level-mode game', async () => {
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValueOnce(undefined);

    await handleJoinLevelQueue(fakeIO as any, 'sockA', player1Id, 1);
    await handleJoinLevelQueue(fakeIO as any, 'sockB', player2Id, 1);

    expect(startGameSpy).toHaveBeenCalledWith(
      expect.any(String),
      'ingliz_tili',
      expect.objectContaining({ userId: player1Id }),
      expect.objectContaining({ userId: player2Id, isBot: false }),
      undefined,
      1
    );

    startGameSpy.mockRestore();
  });

  it('handleJoinLevelQueue does NOT pair two players who queued for DIFFERENT levels', async () => {
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValue(undefined);

    // Level 2 isn't unlocked by default - grant it directly via
    // upsertLevelProgress so this test is exercising "different levels
    // don't pair", not accidentally exercising the unlock guard instead.
    await upsertLevelProgress(player2Id, 1, 2);

    await handleJoinLevelQueue(fakeIO as any, 'sockC', player1Id, 1);
    await handleJoinLevelQueue(fakeIO as any, 'sockD', player2Id, 2);

    expect(startGameSpy).not.toHaveBeenCalled();

    startGameSpy.mockRestore();
    // Clean up: cancel both waiting entries so they don't leak into a later
    // test or trigger a real bot-fallback timer after this test finishes.
    cancelWaiting(player1Id, 'level:1');
    cancelWaiting(player2Id, 'level:2');
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1 AND level_number = 1`, [player2Id]);
  });

  it('handleJoinLevelQueue silently refuses to queue a user for a level they have not unlocked', async () => {
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValue(undefined);

    // playerA has no level_progress rows in this test's fixture data, so
    // level 50 (deep into a stage nobody has reached) must be rejected - a
    // modified client emitting join_level_queue with an arbitrary level
    // number must not be able to skip progression.
    await handleJoinLevelQueue(fakeIO as any, 'sockE', player1Id, 50);

    // Confirm nothing was even enqueued (not just "no match yet") - if this
    // silently joined the Redis queue, a second real player choosing level
    // 50 later would incorrectly get paired with this rejected attempt.
    const stillQueued = await redis.llen('queue:level:50');
    expect(stillQueued).toBe(0);
    expect(startGameSpy).not.toHaveBeenCalled();

    startGameSpy.mockRestore();
  });
});

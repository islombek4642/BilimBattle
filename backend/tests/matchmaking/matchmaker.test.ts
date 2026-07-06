import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { handleJoinQueue } from '../../src/matchmaking/matchmaker';
import { upsertUser } from '../../src/users/userRepository';

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

  it('matches two queued players immediately and emits match_found', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    await handleJoinQueue(fakeIO as any, 'sockA', player1Id, 'umumiy_bilim');
    await handleJoinQueue(fakeIO as any, 'sockB', player2Id, 'umumiy_bilim');

    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    expect(matchFoundEvents.length).toBe(1);

    const questionEvents = events.filter((e) => e.event === 'question');
    expect(questionEvents.length).toBe(1);
  });
});

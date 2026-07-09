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

describe('matchmaker - genuinely concurrent join_queue', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7301, 'c1', 'Concurrent1', null);
    const p2 = await upsertUser(7302, 'c2', 'Concurrent2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7301, 7302)`);
    await redis.del('queue:umumiy_bilim');
    await pool.end();
    await closeRedis();
  });

  it('pairs two players who call handleJoinQueue at the exact same wall-clock moment (Promise.all, not sequential awaits)', async () => {
    const { fakeIO, events, sockets } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // The key difference from the existing "matches two queued players
    // immediately" test: that test awaits call A fully before starting call
    // B. This test fires both calls in the same tick via Promise.all, the
    // way two real players' socket.io `join_queue` events would actually
    // arrive at the server - to check whether runSerialized's per-category
    // locking genuinely holds up under real concurrency, not just prove the
    // sequential-call happy path.
    await Promise.all([
      handleJoinQueue(fakeIO as any, 'sockA', player1Id, 'umumiy_bilim'),
      handleJoinQueue(fakeIO as any, 'sockB', player2Id, 'umumiy_bilim'),
    ]);

    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    // One per socket now (each gets the OTHER player as opponent), not one room-wide broadcast.
    expect(matchFoundEvents.length).toBe(2);

    const questionEvents = events.filter((e) => e.event === 'question');
    expect(questionEvents.length).toBe(1);

    // Confirm both players actually landed in the SAME game (real
    // player-vs-player pairing), not two separate bot-fallback matches -
    // the `matches` DB table only gets a row at game_over, so checking the
    // socket join-room bookkeeping here is the direct way to prove it.
    const roomA = sockets.get('sockA')!.joinedRooms;
    const roomB = sockets.get('sockB')!.joinedRooms;
    expect(roomA.length).toBe(1);
    expect(roomB.length).toBe(1);
    expect(roomA[0]).toBe(roomB[0]);
  });
});

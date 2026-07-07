import { redis, closeRedis } from '../../src/config/redis';
import { createInvite, consumeInvite } from '../../src/invite/inviteRoom';

describe('inviteRoom', () => {
  afterAll(async () => {
    await closeRedis();
  });

  it('returns null when no invite exists for the inviter', async () => {
    const result = await consumeInvite(999999);
    expect(result).toBeNull();
  });

  it('creates and consumes an invite exactly once', async () => {
    await createInvite(12345, { category: 'umumiy_bilim', socketId: 'sockA', userId: 1 });

    const first = await consumeInvite(12345);
    expect(first).toEqual({ category: 'umumiy_bilim', socketId: 'sockA', userId: 1 });

    const second = await consumeInvite(12345);
    expect(second).toBeNull();
  });

  it('only allows exactly one of two concurrent consumers to win', async () => {
    await createInvite(54321, { category: 'tarix', socketId: 'sockB', userId: 2 });

    const [resultA, resultB] = await Promise.all([consumeInvite(54321), consumeInvite(54321)]);

    const nonNullResults = [resultA, resultB].filter((r) => r !== null);
    expect(nonNullResults).toHaveLength(1);
    expect(nonNullResults[0]).toEqual({ category: 'tarix', socketId: 'sockB', userId: 2 });
  });
});

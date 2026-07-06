import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser, recordMatchResult } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { statsRouter } from '../../src/stats/statsRoutes';

describe('GET /api/stats/me', () => {
  const app = express();
  app.use('/api', statsRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (8201, 8202))`);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8201, 8202)`);
    await pool.end();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/stats/me');
    expect(res.status).toBe(401);
  });

  it('returns computed stats including win rate', async () => {
    const winner = await upsertUser(8201, 'w', 'W', null);
    const loser = await upsertUser(8202, 'l', 'L', null);
    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: winner.id,
      player2Id: loser.id,
      player1Score: 500,
      player2Score: 100,
      winnerId: winner.id,
    });

    const token = signSession({ userId: winner.id, telegramId: winner.telegramId });
    const res = await request(app).get('/api/stats/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(1);
    expect(res.body.gamesWon).toBe(1);
    expect(res.body.winRate).toBe(100);
  });
});

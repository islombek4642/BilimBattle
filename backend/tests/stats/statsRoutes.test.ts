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
    await pool.query(
      `DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (8201, 8202, 8203, 8204, 8205))`
    );
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8201, 8202, 8203, 8204, 8205)`);
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

  it('returns winRate 0 for a user with zero games played', async () => {
    const freshUser = await upsertUser(8203, 'fresh', 'Fresh', null);

    const token = signSession({ userId: freshUser.id, telegramId: freshUser.telegramId });
    const res = await request(app).get('/api/stats/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(0);
    expect(res.body.gamesWon).toBe(0);
    expect(res.body.winRate).toBe(0);
  });

  it('returns a rounded partial win rate for a user with mixed results', async () => {
    const subject = await upsertUser(8204, 'mixed', 'Mixed', null);
    const opponent = await upsertUser(8205, 'opp', 'Opp', null);

    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: subject.id,
      player2Id: opponent.id,
      player1Score: 500,
      player2Score: 100,
      winnerId: subject.id,
    });
    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: subject.id,
      player2Id: opponent.id,
      player1Score: 100,
      player2Score: 500,
      winnerId: opponent.id,
    });

    const token = signSession({ userId: subject.id, telegramId: subject.telegramId });
    const res = await request(app).get('/api/stats/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(2);
    expect(res.body.gamesWon).toBe(1);
    expect(res.body.winRate).toBe(50);
  });
});

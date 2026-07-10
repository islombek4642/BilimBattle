import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { questionsRouter } from '../../src/questions/questionsRoutes';

describe('GET /api/categories', () => {
  const app = express();
  app.use('/api', questionsRouter);

  afterAll(async () => {
    await pool.end();
  });

  it('returns the list of categories, including the two seeded defaults', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(
      expect.arrayContaining([
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ])
    );
  });
});

process.env.ADMIN_TELEGRAM_ID = '88888';

import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { adminApiRouter } from '../../src/admin/adminApiRoutes';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));
import mammoth from 'mammoth';

function mockDocxText(text: string): void {
  (mammoth.extractRawText as jest.Mock).mockResolvedValue({ value: text, messages: [] });
}

describe('POST /api/admin/questions/import', () => {
  const app = express();
  app.use('/api', adminApiRouter);

  let adminToken: string;

  beforeAll(async () => {
    const admin = await upsertUser(88888, 'admin', 'Admin', null);
    adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM questions WHERE question_text LIKE 'TEST_IMPORT_%'`);
    await pool.query(`DELETE FROM categories WHERE key LIKE 'test_import_%'`);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 88888`);
    await pool.end();
  });

  it('rejects a request with no auth token', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin session', async () => {
    const nonAdmin = await upsertUser(88889, 'notadmin', 'NotAdmin', null);
    const token = signSession({ userId: nonAdmin.id, telegramId: nonAdmin.telegramId });

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(403);
    await pool.query(`DELETE FROM users WHERE telegram_id = 88889`);
  });

  it('rejects a file that is not .docx', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.txt')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(400);
  });

  it('rejects a request with neither category nor newCategoryLabel', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx');

    expect(res.status).toBe(400);
  });

  it('rejects a request with both category and newCategoryLabel', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim')
      .field('newCategoryLabel', 'Test Import Yangi');

    expect(res.status).toBe(400);
  });

  it('rejects a category key that does not exist', async () => {
    mockDocxText("? Savol?\n+ Togri\n= Xato");

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'test_import_notreal');

    expect(res.status).toBe(400);
  });

  it('imports valid questions into an existing category', async () => {
    mockDocxText(['? TEST_IMPORT_Savol 1?', '+ Togri 1', '= Xato 1'].join('\n'));

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.category).toEqual({ key: 'umumiy_bilim', label: 'Umumiy bilim' });

    const stored = await pool.query(`SELECT * FROM questions WHERE question_text = 'TEST_IMPORT_Savol 1?'`);
    expect(stored.rows.length).toBe(1);
  });

  it('creates a new category and imports questions into it', async () => {
    mockDocxText(['? TEST_IMPORT_Yangi savol?', '+ Togri', '= Xato'].join('\n'));

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('newCategoryLabel', 'Test Import Yangi Turkum');

    expect(res.status).toBe(200);
    expect(res.body.category.label).toBe('Test Import Yangi Turkum');
    expect(res.body.inserted).toBe(1);

    const categoryRows = await pool.query(`SELECT * FROM categories WHERE label = 'Test Import Yangi Turkum'`);
    expect(categoryRows.rows.length).toBe(1);
  });

  it('rejects a corrupt/invalid docx that mammoth fails to parse', async () => {
    (mammoth.extractRawText as jest.Mock).mockRejectedValue(new Error('corrupt file'));

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejects a Multer error other than file-too-large without claiming the file is too large', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('wrongFieldName', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/hajmi juda katta/);
  });

  it('imports the valid blocks and reports errors for invalid ones in the same file', async () => {
    mockDocxText(
      [
        '? TEST_IMPORT_Yaroqli savol?',
        '+ Togri',
        '= Xato',
        '? TEST_IMPORT_Yaroqsiz savol?',
        '= Faqat xato javoblar',
      ].join('\n')
    );

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toEqual([{ line: 4, message: "to'g'ri javob belgilanmagan" }]);
  });
});

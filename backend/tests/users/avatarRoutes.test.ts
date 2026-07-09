import express from 'express';
import request from 'supertest';
import * as avatarService from '../../src/users/avatarService';
import { avatarRouter } from '../../src/users/avatarRoutes';

describe('GET /users/:telegramId/avatar', () => {
  const app = express();
  app.use(avatarRouter);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the image bytes with an image/jpeg content type when a photo is found', async () => {
    jest.spyOn(avatarService, 'getAvatarBuffer').mockResolvedValue(Buffer.from('fake-bytes'));

    const res = await request(app).get('/users/12345/avatar');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body).toEqual(Buffer.from('fake-bytes'));
  });

  it('returns 404 when no photo is available', async () => {
    jest.spyOn(avatarService, 'getAvatarBuffer').mockResolvedValue(null);

    const res = await request(app).get('/users/12345/avatar');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-numeric telegramId without calling the service', async () => {
    const spy = jest.spyOn(avatarService, 'getAvatarBuffer');

    const res = await request(app).get('/users/not-a-number/avatar');

    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 404 for a negative telegramId without calling the service', async () => {
    const spy = jest.spyOn(avatarService, 'getAvatarBuffer');

    const res = await request(app).get('/users/-5/avatar');

    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 404 for a decimal/scientific-notation telegramId without calling the service', async () => {
    const spy = jest.spyOn(avatarService, 'getAvatarBuffer');

    const res = await request(app).get('/users/1e3/avatar');

    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});

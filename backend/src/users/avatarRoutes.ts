import { Router } from 'express';
import { getAvatarBuffer } from './avatarService';

// Deliberately NOT behind requireAuth: a plain <img src> tag can't attach a
// Bearer token header, so a requireAuth-gated route would 401 on every image
// load and the feature would never work. Telegram profile photos aren't
// sensitive (anyone with the user's Telegram username can already see one),
// and telegramId is already public elsewhere in this app (the invite deep
// link t.me/bot?startapp=invite_<telegramId>).
export const avatarRouter = Router();

avatarRouter.get('/users/:telegramId/avatar', async (req, res) => {
  const telegramId = Number(req.params.telegramId);
  if (!Number.isFinite(telegramId)) {
    res.status(404).end();
    return;
  }

  const buffer = await getAvatarBuffer(telegramId);
  if (!buffer) {
    res.status(404).end();
    return;
  }

  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});

import { Router } from 'express';
import { validateInitData } from './telegramAuth';
import { signSession } from './jwt';
import { upsertUser, getUserByTelegramId } from '../users/userRepository';

export const authRouter = Router();

function parseInviterTelegramId(startParam: string | undefined): number | null {
  if (!startParam?.startsWith('invite_')) return null;
  const id = Number(startParam.slice('invite_'.length));
  return Number.isFinite(id) ? id : null;
}

authRouter.post('/auth/login', async (req, res) => {
  const { initData, startParam } = req.body as { initData?: string; startParam?: string };
  if (!initData) {
    res.status(400).json({ error: 'initData yuborilmadi' });
    return;
  }

  const telegramUser = validateInitData(initData);
  if (!telegramUser) {
    res.status(401).json({ error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
    return;
  }

  const existing = await getUserByTelegramId(telegramUser.id);
  let inviterTelegramId = existing ? existing.invitedByTelegramId : parseInviterTelegramId(startParam);

  // A user can never be their own inviter — guard both the first-login
  // (startParam-derived) and already-existing (stored) cases so a crafted
  // deep link or a legacy bad row can't create a self-referral.
  if (inviterTelegramId === telegramUser.id) {
    inviterTelegramId = null;
  }

  const user = await upsertUser(telegramUser.id, telegramUser.username, telegramUser.first_name, inviterTelegramId);
  const token = signSession({ userId: user.id, telegramId: user.telegramId });

  res.json({ token, user });
});

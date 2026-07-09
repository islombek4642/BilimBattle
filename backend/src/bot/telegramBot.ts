import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';

// A deep link like t.me/<bot>?startapp=invite_123 only lands Telegram
// directly in the Mini App (with initDataUnsafe.start_param populated) when
// the bot's Menu Button is configured in BotFather as that same Web App.
// Without that configuration, Telegram instead falls back to opening this
// chat and sending "/start invite_123" as a normal text message - in which
// case initDataUnsafe.start_param is never set, and the payload only exists
// here, as text after "/start ". Forward it onto the Web App button's own
// URL so the frontend can still recover it (see
// frontend/src/telegram/webApp.ts's getStartParam fallback).
export function extractStartPayload(messageText: string): string | undefined {
  const match = messageText.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/);
  return match?.[1];
}

export function buildWebAppUrl(baseUrl: string, startPayload: string | undefined): string {
  if (!startPayload) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('startapp', startPayload);
  return url.toString();
}

export function startTelegramBot(): TelegramBot {
  const bot = new TelegramBot(env.telegramBotToken, { polling: true });

  bot.onText(/^\/start/, (msg) => {
    const payload = extractStartPayload(msg.text ?? '');
    const url = buildWebAppUrl(env.webappUrl, payload);
    bot
      .sendMessage(msg.chat.id, "BilimBattle'ga xush kelibsiz! O'yinni boshlash uchun tugmani bosing.", {
        reply_markup: {
          inline_keyboard: [[{ text: "O'yinni ochish", web_app: { url } }]],
        },
      })
      .catch((err) => {
        console.error('telegramBot: failed to send /start reply', err);
      });
  });

  return bot;
}

import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';

const WEBAPP_URL = process.env.WEBAPP_URL ?? 'https://example.com';

export function startTelegramBot(): TelegramBot {
  const bot = new TelegramBot(env.telegramBotToken, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "BilimBattle'ga xush kelibsiz! O'yinni boshlash uchun tugmani bosing.", {
      reply_markup: {
        inline_keyboard: [[{ text: "O'yinni ochish", web_app: { url: WEBAPP_URL } }]],
      },
    });
  });

  return bot;
}

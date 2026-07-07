import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';

export function startTelegramBot(): TelegramBot {
  const bot = new TelegramBot(env.telegramBotToken, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot
      .sendMessage(msg.chat.id, "BilimBattle'ga xush kelibsiz! O'yinni boshlash uchun tugmani bosing.", {
        reply_markup: {
          inline_keyboard: [[{ text: "O'yinni ochish", web_app: { url: env.webappUrl } }]],
        },
      })
      .catch((err) => {
        console.error('telegramBot: failed to send /start reply', err);
      });
  });

  return bot;
}

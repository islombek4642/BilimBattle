import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { initSocketServer } from './socket/socketServer';
import { startTelegramBot } from './bot/telegramBot';
import { env } from './config/env';

const app = createApp();
const httpServer = createServer(app);
initSocketServer(httpServer);
startTelegramBot();

httpServer.on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

httpServer.listen(env.port, () => {
  console.log(`BilimBattle backend ${env.port}-portda ishga tushdi`);
});

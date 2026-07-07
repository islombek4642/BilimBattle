// backend/scripts/loadTest.ts
//
// Manual, standalone Socket.io load-test script. NOT part of the Jest suite
// (see jest.config.js - this file lives outside `tests/` and is never
// imported by it) and NOT wired into `npm test`. Run it by hand, against a
// locally running `npm run dev` server, to eyeball how matchmaking behaves
// under a burst of concurrent connections before considering the MVP
// launch-ready.
//
// Like backend/src/db/migrate.ts and backend/src/db/seed.ts, this is a
// standalone ts-node entry point, not something imported by the app or by
// Jest. env.ts (see backend/src/config/env.ts) deliberately does NOT call
// dotenv.config() itself - it expects the process environment to already be
// populated before it's imported. This script pulls in signSession from
// ../src/auth/jwt, which imports env.ts, so - exactly like migrate.ts and
// seed.ts - this file's very first import MUST be 'dotenv/config', or
// signSession() below will throw "Missing required environment variable:
// JWT_SECRET" the moment it runs.
import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import { signSession } from '../src/auth/jwt';

const SERVER_URL = process.env.LOAD_TEST_SERVER_URL ?? 'http://localhost:3000';
const CLIENT_COUNT = Number(process.env.LOAD_TEST_CLIENTS ?? 200);

async function runLoadTest(): Promise<void> {
  let matchedCount = 0;
  let errorCount = 0;
  const startedAt = Date.now();

  const clients = Array.from({ length: CLIENT_COUNT }, (_, i) => {
    const token = signSession({ userId: 1_000_000 + i, telegramId: 1_000_000 + i });
    const socket = ioClient(SERVER_URL, { auth: { token } });

    socket.on('connect', () => {
      socket.emit('join_queue', { category: 'umumiy_bilim' });
    });

    socket.on('match_found', () => {
      matchedCount += 1;
      socket.close();
    });

    socket.on('connect_error', () => {
      errorCount += 1;
    });

    return socket;
  });

  await new Promise((resolve) => setTimeout(resolve, 20_000));

  const durationMs = Date.now() - startedAt;
  console.log(`Ulanishlar: ${CLIENT_COUNT}`);
  console.log(`Bellashuvga tushganlar: ${matchedCount}`);
  console.log(`Xatoliklar: ${errorCount}`);
  console.log(`Davomiylik: ${durationMs}ms`);

  clients.forEach((c) => c.close());
  process.exit(0);
}

runLoadTest();

import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';
import { submitAnswer, handleDisconnect, handleReconnect } from '../game/gameEngine';
import { handleJoinQueue, cancelWaiting, createMatch } from '../matchmaking/matchmaker';
import { createInvite, consumeInvite } from '../invite/inviteRoom';
import { isValidCategory } from '../questions/questionRepository';

export interface SocketData {
  userId: number;
  telegramId: number;
  gameId?: string;
}

export type AppServer = Server<any, any, any, SocketData>;
export type AppSocket = Socket<any, any, any, SocketData>;

let io: AppServer | null = null;
let activeSocketsByUser = new Map<number, string>();

function trackActiveSocket(io: AppServer, socket: AppSocket, userId: number): void {
  const existingSocketId = activeSocketsByUser.get(userId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    existingSocket?.emit('session_replaced');
    existingSocket?.disconnect(true);
  }
  activeSocketsByUser.set(userId, socket.id);

  socket.on('disconnect', () => {
    if (activeSocketsByUser.get(userId) === socket.id) {
      activeSocketsByUser.delete(userId);
    }
  });
}

export function initSocketServer(httpServer: ReturnType<typeof createServer>): AppServer {
  activeSocketsByUser = new Map<number, string>();
  io = new Server<any, any, any, SocketData>(httpServer, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('Sessiya topilmadi'));
      return;
    }
    const payload = verifySession(token);
    if (!payload) {
      next(new Error('Sessiya yaroqsiz'));
      return;
    }
    socket.data.userId = payload.userId;
    socket.data.telegramId = payload.telegramId;
    next();
  });

  io.on('connection', (socket: AppSocket) => {
    trackActiveSocket(io!, socket, socket.data.userId);

    socket.on('submit_answer', async ({ gameId, questionIndex, selectedOption }: { gameId: string; questionIndex: number; selectedOption: number }) => {
      await submitAnswer(gameId, socket.data.userId, selectedOption, questionIndex);
    });

    socket.on('join_queue', async ({ category }: { category: string }) => {
      await handleJoinQueue(io!, socket.id, socket.data.userId, category);
    });

    socket.on('leave_queue', ({ category }: { category: string }) => {
      cancelWaiting(socket.data.userId, category);
    });

    // Fire-and-forget from Node's perspective: Socket.io invokes this async
    // handler but never awaits or catches its returned promise (that only
    // happens for emits that use an ack callback, which this event doesn't).
    // An unhandled rejection here (e.g. Redis blip inside createInvite) would
    // otherwise crash the process, same hazard already noted on the
    // 'disconnect' handler below - so this is wrapped in .catch() too.
    socket.on('create_invite', ({ category }: { category: string }) => {
      if (!isValidCategory(category)) return;
      // Refuse to create an invite while this socket is already in an active
      // game - otherwise a stray create_invite mid-match would let a friend
      // later join_invite and double-book this user into a second match on
      // top of the one they're already playing.
      if (socket.data.gameId) return;
      const telegramId = socket.data.telegramId;
      createInvite(telegramId, { category, socketId: socket.id, userId: socket.data.userId })
        .then(() => socket.emit('invite_created'))
        .catch((err) => {
          console.error(`socketServer: failed to create invite for telegramId ${telegramId}`, err);
        });
    });

    // Same fire-and-forget hazard as create_invite above - wrapped in .catch().
    // Note: the invitee's own `category` here is intentionally NOT forwarded
    // to createMatch. The match is played in the category the INVITER
    // originally queued for (invite.category, stored server-side when the
    // invite was created) - the invitee joining via a deep link doesn't get
    // to silently redirect the match to a different category. We still
    // validate the invitee's category so a malformed/garbage payload is
    // rejected up front, but it otherwise carries no weight in this handler.
    socket.on('join_invite', ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      // inviterTelegramId comes straight from client input, unlike category
      // which is checked by isValidCategory below - without this guard a
      // malformed payload (string, NaN, object) would silently build a
      // harmless-but-wrong Redis key via inviteKey() instead of being
      // rejected cleanly up front.
      if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
      if (!isValidCategory(category)) return;
      // Refuse to consume the invite if THIS socket (the invitee) is already
      // mid-match - see the matching comment on create_invite above for why.
      if (socket.data.gameId) return;

      consumeInvite(inviterTelegramId)
        .then(async (invite) => {
          if (!invite) {
            socket.emit('invite_expired');
            return;
          }

          // Look up the inviter's CURRENT live socket via activeSocketsByUser
          // rather than trusting invite.socketId, which is a snapshot taken
          // when create_invite ran and can go stale (inviter reconnected,
          // got a new socket id, or - the case this guard exists for -
          // started or finished an unrelated match since then). Using the
          // stale id for the "already in a match" check would miss exactly
          // the double-booking scenario it's meant to catch.
          const inviterCurrentSocketId = activeSocketsByUser.get(invite.userId);
          const inviterSocket = inviterCurrentSocketId ? io!.sockets.sockets.get(inviterCurrentSocketId) : undefined;
          if (inviterSocket?.data.gameId) {
            socket.emit('invite_expired');
            return;
          }

          await createMatch(
            io!,
            invite.category,
            { userId: invite.userId, socketId: inviterSocket?.id ?? invite.socketId },
            { userId: socket.data.userId, socketId: socket.id }
          );
        })
        .catch((err) => {
          console.error(`socketServer: failed to join invite from inviterTelegramId ${inviterTelegramId}`, err);
        });
    });

    socket.on('reconnect_game', async ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      // A client that emits this event with no ack callback (buggy client,
      // or an old client build) would otherwise crash this handler on
      // `ack(...)` below ("ack is not a function") - there's no global
      // unhandledRejection handler in this backend, so that's a real
      // process-crash vector, not just a logged error.
      if (typeof ack !== 'function') return;

      // handleReconnect returns the GameState directly (or null) instead of
      // a boolean specifically so we don't need a second getGame() call here.
      // A second fetch would have its own gap between handleReconnect's
      // internal saveGame and this handler's own read - if the game
      // finishes/forfeits in that gap, getGame() would return null and
      // `game!.currentQuestionIndex` below would throw inside this
      // unwrapped async handler.
      const game = await handleReconnect(gameId, socket.data.userId, socket.id);
      if (!game) {
        ack({ found: false });
        return;
      }
      socket.join(gameId);
      socket.data.gameId = gameId;
      ack({
        found: true,
        currentQuestionIndex: game.currentQuestionIndex,
        scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
      });
    });

    // Separate from trackActiveSocket's own 'disconnect' listener (which only
    // enforces single-session-per-user bookkeeping) - Socket.io supports
    // multiple listeners for the same event, and keeping this one separate
    // avoids touching trackActiveSocket's existing behavior. Only forfeit-eligible
    // if this socket was actually in an active game (socket.data.gameId is set
    // by createMatch on match start and by reconnect_game above).
    socket.on('disconnect', () => {
      if (socket.data.gameId) {
        handleDisconnect(socket.data.gameId, socket.data.userId).catch((err) => {
          console.error(`socketServer: failed to handle disconnect for game ${socket.data.gameId}`, err);
        });
      }
    });
  });

  return io;
}

export function getIO(): AppServer {
  if (!io) {
    throw new Error('Socket.io server hali ishga tushirilmagan');
  }
  return io;
}

export function setIOForTesting(mockIO: AppServer): void {
  io = mockIO;
}

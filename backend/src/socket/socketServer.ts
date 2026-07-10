import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';
import { submitAnswer, handleDisconnect, handleReconnect } from '../game/gameEngine';
import { handleJoinQueue, cancelWaiting, createMatch } from '../matchmaking/matchmaker';
import { createInvite, consumeInvite } from '../invite/inviteRoom';
import { isValidCategory } from '../questions/questionRepository';
import { getUserById } from '../users/userRepository';
import { env } from '../config/env';

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
    console.log(`socketServer: userId=${userId} reconnected on socket=${socket.id} - disconnecting previous socket=${existingSocketId} (session_replaced)`);
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    existingSocket?.emit('session_replaced');
    existingSocket?.disconnect(true);
  }
  activeSocketsByUser.set(userId, socket.id);

  socket.on('disconnect', (reason) => {
    console.log(`socketServer: socket=${socket.id} (userId=${userId}) disconnected, reason=${reason}`);
    if (activeSocketsByUser.get(userId) === socket.id) {
      activeSocketsByUser.delete(userId);
    }
  });
}

export function initSocketServer(httpServer: ReturnType<typeof createServer>): AppServer {
  activeSocketsByUser = new Map<number, string>();
  io = new Server<any, any, any, SocketData>(httpServer, { cors: { origin: env.webappUrl } });

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
    console.log(`socketServer: new connection socket=${socket.id} userId=${socket.data.userId} telegramId=${socket.data.telegramId}`);
    trackActiveSocket(io!, socket, socket.data.userId);

    // Same fire-and-forget hazard as create_invite/join_invite below - Socket.io
    // never awaits or catches a listener's returned promise, and there's no
    // global unhandledRejection handler in this backend. This is the hottest
    // path in the whole game (every answer submission from every active match
    // goes through it), so a transient Redis/Postgres error here is ordinary
    // operational noise, not an edge case - left unhandled it would crash the
    // entire process and kill every concurrent match, not just this one.
    socket.on('submit_answer', ({ gameId, questionIndex, selectedOption }: { gameId: string; questionIndex: number; selectedOption: number }) => {
      submitAnswer(gameId, socket.data.userId, selectedOption, questionIndex).catch((err) => {
        console.error(`socketServer: failed to submit answer for game ${gameId}`, err);
      });
    });

    // Same fire-and-forget hazard as submit_answer above - wrapped in .catch().
    socket.on('join_queue', ({ category }: { category: string }) => {
      // Refuse to queue this socket while it's already in an active game -
      // otherwise a stray join_queue mid-match would pair this user into a
      // second concurrent match, silently overwriting socket.data.gameId and
      // leaving the first game's disconnect/reconnect bookkeeping pointing
      // at the wrong game. Same guard as create_invite/join_invite below.
      if (socket.data.gameId) {
        console.log(`socketServer: ignoring join_queue from userId=${socket.data.userId} - socket already has an active gameId=${socket.data.gameId}`);
        return;
      }
      handleJoinQueue(io!, socket.id, socket.data.userId, category).catch((err) => {
        console.error(`socketServer: failed to join queue for user ${socket.data.userId}`, err);
      });
    });

    socket.on('leave_queue', ({ category }: { category: string }) => {
      cancelWaiting(socket.data.userId, category);
    });

    // Fire-and-forget from Node's perspective: Socket.io invokes this async
    // handler but never awaits or catches its returned promise (that only
    // happens for emits that use an ack callback, which this event doesn't).
    // An unhandled rejection here (e.g. Redis blip inside createInvite, or
    // the isValidCategory query below) would otherwise crash the process,
    // same hazard already noted on the 'disconnect' handler below - so the
    // whole body is wrapped in try/catch.
    socket.on('create_invite', async ({ category }: { category: string }) => {
      try {
        if (!(await isValidCategory(category))) return;
        // Refuse to create an invite while this socket is already in an
        // active game - otherwise a stray create_invite mid-match would let
        // a friend later join_invite and double-book this user into a
        // second match on top of the one they're already playing.
        if (socket.data.gameId) return;
        const telegramId = socket.data.telegramId;
        await createInvite(telegramId, { category, socketId: socket.id, userId: socket.data.userId });
        socket.emit('invite_created');
      } catch (err) {
        console.error(`socketServer: failed to create invite for telegramId ${socket.data.telegramId}`, err);
      }
    });

    // Same fire-and-forget hazard as create_invite above - wrapped in
    // try/catch since isValidCategory now also awaits a DB query.
    // Note: the invitee's own `category` here is intentionally NOT forwarded
    // to createMatch. The match is played in the category the INVITER
    // originally queued for (invite.category, stored server-side when the
    // invite was created) - the invitee joining via a deep link doesn't get
    // to silently redirect the match to a different category. We still
    // validate the invitee's category so a malformed/garbage payload is
    // rejected up front, but it otherwise carries no weight in this handler.
    socket.on('join_invite', async ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      try {
        // inviterTelegramId comes straight from client input, unlike
        // category which is checked by isValidCategory below - without this
        // guard a malformed payload (string, NaN, object) would silently
        // build a harmless-but-wrong Redis key via inviteKey() instead of
        // being rejected cleanly up front.
        if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
        if (!(await isValidCategory(category))) return;
        // Refuse to consume the invite if THIS socket (the invitee) is
        // already mid-match - see the matching comment on create_invite
        // above for why.
        if (socket.data.gameId) return;

        const invite = await consumeInvite(inviterTelegramId);
        if (!invite) {
          socket.emit('invite_expired');
          return;
        }

        // Look up the inviter's CURRENT live socket via activeSocketsByUser
        // rather than trusting invite.socketId, which is a snapshot taken
        // when create_invite ran and can go stale (inviter reconnected, got
        // a new socket id, or - the case this guard exists for - started or
        // finished an unrelated match since then). Using the stale id for
        // the "already in a match" check would miss exactly the
        // double-booking scenario it's meant to catch.
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
      } catch (err) {
        console.error(`socketServer: failed to join invite from inviterTelegramId ${inviterTelegramId}`, err);
      }
    });

    // Not `async (...) => {}` - same fire-and-forget hazard as submit_answer/
    // join_queue/create_invite/join_invite above: Socket.io never awaits or
    // catches a listener's returned promise, and there's no global
    // unhandledRejection handler in this backend. The async work is kicked
    // off as a promise chain terminated in .catch() instead, so a rejection
    // out of handleReconnect can't take down the process.
    socket.on('reconnect_game', ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
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
      // `game!.currentQuestionIndex` below would throw inside this handler.
      handleReconnect(gameId, socket.data.userId, socket.id)
        .then(async (game) => {
          if (!game) {
            ack({ found: false });
            return;
          }
          socket.join(gameId);
          socket.data.gameId = gameId;

          // Same "who's the other player" derivation as matchmaker.ts's
          // createMatch: a bot's presented name comes from the match's own
          // botDisplayName (picked once at match start), never the DB's
          // literal "Bot" first_name.
          const opponentPlayer = game.players.find((p) => p.userId !== socket.data.userId);
          let opponent: { telegramId: number; firstName: string } | undefined;
          if (opponentPlayer) {
            const opponentUser = await getUserById(opponentPlayer.userId);
            if (opponentUser) {
              opponent = {
                telegramId: opponentUser.telegramId,
                firstName: opponentPlayer.isBot ? (game.botDisplayName ?? opponentUser.firstName) : opponentUser.firstName,
              };
            } else {
              console.error(`socketServer: missing user record for opponent userId=${opponentPlayer.userId} - omitting opponent from reconnect_game ack (gameId=${gameId})`);
            }
          }

          ack({
            found: true,
            currentQuestionIndex: game.currentQuestionIndex,
            scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
            opponent,
          });
        })
        .catch((err) => {
          console.error(`socketServer: failed to reconnect game ${gameId}`, err);
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

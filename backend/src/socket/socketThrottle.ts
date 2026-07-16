// backend/src/socket/socketThrottle.ts

// Simple in-process, fixed-window, per-socket-per-event counter. In-process
// only (not shared across server instances) - consistent with this
// backend's other single-instance-only state (matchmaker.ts's
// categoryLocks, gameEngine.ts's activeTimers): a given socket connection
// only ever lives on one server process at a time, so per-connection
// throttling doesn't need cross-instance visibility to be effective.
interface Bucket {
  count: number;
  windowStart: number;
}

const bucketsBySocket = new Map<string, Map<string, Bucket>>();

export function isThrottled(socketId: string, eventName: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now();
  let socketBuckets = bucketsBySocket.get(socketId);
  if (!socketBuckets) {
    socketBuckets = new Map();
    bucketsBySocket.set(socketId, socketBuckets);
  }

  const bucket = socketBuckets.get(eventName);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    socketBuckets.set(eventName, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > maxPerWindow;
}

// Called on socket disconnect (see socketServer.ts's trackActiveSocket) so
// this map doesn't grow unboundedly as sockets connect and disconnect over
// the process's lifetime.
export function clearSocketThrottleState(socketId: string): void {
  bucketsBySocket.delete(socketId);
}

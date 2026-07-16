import { isThrottled, clearSocketThrottleState } from '../../src/socket/socketThrottle';

describe('isThrottled', () => {
  it('allows up to maxPerWindow calls within the window, then blocks', () => {
    const socketId = 'test-socket-1';
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(true);
  });

  it('tracks separate windows independently per event name for the same socket', () => {
    const socketId = 'test-socket-2';
    expect(isThrottled(socketId, 'event_a', 1, 1000)).toBe(false);
    expect(isThrottled(socketId, 'event_a', 1, 1000)).toBe(true);
    expect(isThrottled(socketId, 'event_b', 1, 1000)).toBe(false);
  });

  it('tracks separate windows independently per socket for the same event', () => {
    expect(isThrottled('socket-a', 'shared_event', 1, 1000)).toBe(false);
    expect(isThrottled('socket-b', 'shared_event', 1, 1000)).toBe(false);
  });

  it('resets the count once the window has elapsed', async () => {
    const socketId = 'test-socket-3';
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(false);
  });

  it('clearSocketThrottleState removes all bucket state for that socket', () => {
    const socketId = 'test-socket-4';
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(true);
    clearSocketThrottleState(socketId);
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(false);
  });
});

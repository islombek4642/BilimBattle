import { extractStartPayload, buildWebAppUrl } from '../../src/bot/telegramBot';

describe('telegramBot', () => {
  describe('extractStartPayload', () => {
    it('extracts the payload after "/start "', () => {
      expect(extractStartPayload('/start invite_12345')).toBe('invite_12345');
    });

    it('returns undefined for a bare "/start" with no payload', () => {
      expect(extractStartPayload('/start')).toBeUndefined();
    });

    it('extracts the payload when the command has a bot-username suffix (group chats)', () => {
      expect(extractStartPayload('/start@bilimbattle_bot invite_12345')).toBe('invite_12345');
    });

    it('ignores text that is not a /start command', () => {
      expect(extractStartPayload('hello there')).toBeUndefined();
    });
  });

  describe('buildWebAppUrl', () => {
    it('returns the base URL unchanged when there is no payload', () => {
      expect(buildWebAppUrl('https://app.example.com', undefined)).toBe('https://app.example.com');
    });

    it('appends the payload as a "startapp" query param', () => {
      expect(buildWebAppUrl('https://app.example.com', 'invite_12345')).toBe(
        'https://app.example.com/?startapp=invite_12345'
      );
    });

    it('preserves an existing path and query string on the base URL', () => {
      expect(buildWebAppUrl('https://app.example.com/mini?foo=bar', 'invite_12345')).toBe(
        'https://app.example.com/mini?foo=bar&startapp=invite_12345'
      );
    });
  });
});

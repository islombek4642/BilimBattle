// frontend/src/telegram/webApp.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getTelegramWebApp,
  getInitData,
  getStartParam,
  readyWebApp,
  buildInviteLink,
  shareInviteLink,
  hapticImpact,
  hapticNotification,
} from './webApp';

describe('telegram/webApp', () => {
  beforeEach(() => {
    delete window.Telegram;
  });

  it('returns null when window.Telegram is not present', () => {
    expect(getTelegramWebApp()).toBeNull();
    expect(getInitData()).toBe('');
    expect(getStartParam()).toBeUndefined();
  });

  it('reads initData and start_param from window.Telegram.WebApp', () => {
    window.Telegram = {
      WebApp: {
        initData: 'raw-init-data-string',
        initDataUnsafe: { start_param: 'invite_555' },
      },
    } as any;

    expect(getInitData()).toBe('raw-init-data-string');
    expect(getStartParam()).toBe('invite_555');
  });

  it('calls ready() and expand() on the WebApp when readyWebApp() is invoked', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    window.Telegram = { WebApp: { ready, expand } } as any;

    readyWebApp();

    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('does not throw when readyWebApp() is called with no Telegram WebApp present', () => {
    expect(() => readyWebApp()).not.toThrow();
  });

  it('builds an invite deep link with the bot username and inviter telegram id', () => {
    expect(buildInviteLink('bilimbattle_bot', 12345)).toBe(
      'https://t.me/bilimbattle_bot?startapp=invite_12345'
    );
  });

  it('shares a link via openTelegramLink when the WebApp is present', () => {
    const openTelegramLink = vi.fn();
    window.Telegram = { WebApp: { openTelegramLink } } as any;

    shareInviteLink('https://t.me/bilimbattle_bot?startapp=invite_1', "Men bilan o'ynang!");

    expect(openTelegramLink).toHaveBeenCalledOnce();
    const calledUrl = openTelegramLink.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://t.me/share/url');
    expect(calledUrl).toContain(encodeURIComponent('https://t.me/bilimbattle_bot?startapp=invite_1'));
  });

  it('falls back to window.open when no Telegram WebApp is present', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    shareInviteLink('https://t.me/bilimbattle_bot?startapp=invite_1', "Men bilan o'ynang!");

    expect(openSpy).toHaveBeenCalledOnce();
    openSpy.mockRestore();
  });

  it('calls HapticFeedback.impactOccurred with the given style when the WebApp is present', () => {
    const impactOccurred = vi.fn();
    window.Telegram = { WebApp: { HapticFeedback: { impactOccurred } } } as any;

    hapticImpact('light');

    expect(impactOccurred).toHaveBeenCalledWith('light');
  });

  it('does not throw when hapticImpact is called with no Telegram WebApp present', () => {
    expect(() => hapticImpact('medium')).not.toThrow();
  });

  it('calls HapticFeedback.notificationOccurred with the given type when the WebApp is present', () => {
    const notificationOccurred = vi.fn();
    window.Telegram = { WebApp: { HapticFeedback: { notificationOccurred } } } as any;

    hapticNotification('success');

    expect(notificationOccurred).toHaveBeenCalledWith('success');
  });

  it('does not throw when hapticNotification is called with no Telegram WebApp present', () => {
    expect(() => hapticNotification('error')).not.toThrow();
  });
});

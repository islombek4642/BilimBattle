// frontend/src/telegram/webApp.ts
//
// This is the ONLY module in the frontend allowed to touch `window.Telegram`
// directly. Everything else (React contexts, components, hooks) must go
// through the functions exported here so the rest of the app stays testable
// and decoupled from the Telegram WebApp global injected by
// https://telegram.org/js/telegram-web-app.js.

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  ready(): void;
  expand(): void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
  };
  openTelegramLink(url: string): void;
  close(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  return getTelegramWebApp()?.initData ?? '';
}

export function getStartParam(): string | undefined {
  return getTelegramWebApp()?.initDataUnsafe?.start_param;
}

export function readyWebApp(): void {
  const webApp = getTelegramWebApp();
  webApp?.ready();
  webApp?.expand();
}

export function buildInviteLink(botUsername: string, inviterTelegramId: number): string {
  return `https://t.me/${botUsername}?startapp=invite_${inviterTelegramId}`;
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy'): void {
  getTelegramWebApp()?.HapticFeedback.impactOccurred(style);
}

export function hapticNotification(type: 'success' | 'error' | 'warning'): void {
  getTelegramWebApp()?.HapticFeedback.notificationOccurred(type);
}

export function shareInviteLink(link: string, text: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, '_blank');
  }
}

export function openTelegramProfile(username: string): void {
  const profileUrl = `https://t.me/${username}`;
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.openTelegramLink(profileUrl);
  } else {
    window.open(profileUrl, '_blank');
  }
}

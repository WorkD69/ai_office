/**
 * Minimal typing of the Telegram Mini App SDK surface this app uses.
 * Docs: https://core.telegram.org/bots/webapps
 */
export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface TelegramHaptics {
  selectionChanged(): void;
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  version?: string;
  colorScheme?: 'light' | 'dark';
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHaptics;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The SDK object exists even in a normal browser; only a non-empty initData means "inside Telegram". */
export function getTelegram(): TelegramWebApp | null {
  const wa = typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

export function initTelegram(): void {
  const wa = getTelegram();
  if (!wa) return;
  wa.ready();
  wa.expand();
  if (wa.isVersionAtLeast?.('7.7')) wa.disableVerticalSwipes?.();
  if (wa.isVersionAtLeast?.('6.1')) {
    wa.setHeaderColor?.('#14121c');
    wa.setBackgroundColor?.('#14121c');
  }
}

export function haptic(): void {
  const wa = getTelegram();
  if (wa?.isVersionAtLeast?.('6.1')) wa.HapticFeedback?.selectionChanged();
}

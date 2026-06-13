/**
 * i18n entry point — composes BOTH locales, so it is safe for server code and
 * tests only. First-load client code must import lib/i18n/messages-en directly
 * (and load zh lazily) to keep the inactive locale out of the startup bundle;
 * type-only imports from here are fine anywhere (they compile away).
 * Guarded by __tests__/lib/first-load-bundle-split.test.ts.
 */
import { en } from './messages-en';
import { zh } from './messages-zh';

export { en } from './messages-en';
export { zh } from './messages-zh';

export type Locale = 'en' | 'zh';
export const messages = { en, zh } as const;
export type Messages = typeof en;

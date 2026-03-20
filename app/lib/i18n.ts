import { en } from './i18n-en';
import { zh } from './i18n-zh';

export type Locale = 'en' | 'zh';
export const messages = { en, zh } as const;
export type Messages = typeof messages['en'];

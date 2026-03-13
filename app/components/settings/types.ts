import type { Locale } from '@/lib/i18n';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiSettings {
  provider: 'anthropic' | 'openai';
  providers: {
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
  };
}

export interface SettingsData {
  ai: AiSettings;
  mindRoot: string;
  webPassword?: string;
  authToken?: string;   // masked: first-xxxx-••••-last pattern
  mcpPort?: number;
  envOverrides?: Record<string, boolean>;
  envValues?: Record<string, string>;
}

export type Tab = 'ai' | 'appearance' | 'knowledge' | 'plugins' | 'shortcuts' | 'sync';

export const CONTENT_WIDTHS = [
  { value: '680px', label: 'Narrow (680px)' },
  { value: '780px', label: 'Default (780px)' },
  { value: '960px', label: 'Wide (960px)' },
  { value: '100%', label: 'Full width' },
];

export const FONTS = [
  { value: 'lora', label: 'Lora (serif)', style: { fontFamily: 'Lora, Georgia, serif' } },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', style: { fontFamily: "'IBM Plex Sans', sans-serif" } },
  { value: 'geist', label: 'Geist', style: { fontFamily: 'var(--font-geist-sans), sans-serif' } },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono (mono)', style: { fontFamily: "'IBM Plex Mono', monospace" } },
];

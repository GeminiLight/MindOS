import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';

export const MIND_SYSTEM_CONFIG_RELATIVE_PATH = '.mindos/modules/mind-system.json';

export type MindSystemSlotKey = 'dao' | 'fa' | 'shu' | 'qi';

export interface MindSystemSlot {
  key: MindSystemSlotKey;
  label: string;
  path: string;
  role: string;
  order: number;
  primary: boolean;
  enabled: boolean;
}

export interface MindSystemConfig {
  version: 1;
  slots: Record<MindSystemSlotKey, MindSystemSlot>;
}

const DEFAULT_MIND_SYSTEM_SLOTS: readonly MindSystemSlot[] = [
  { key: 'dao', label: '道', path: '01 道', role: 'world-model', order: 10, primary: true, enabled: true },
  { key: 'fa', label: '法', path: '02 法', role: 'principles', order: 20, primary: true, enabled: true },
  { key: 'shu', label: '术', path: '03 术', role: 'methods', order: 30, primary: true, enabled: true },
  { key: 'qi', label: '器', path: '04 器', role: 'tools-assets', order: 40, primary: true, enabled: true },
] as const;

const SLOT_KEYS = new Set<MindSystemSlotKey>(DEFAULT_MIND_SYSTEM_SLOTS.map(slot => slot.key));

export function defaultMindSystemConfig(): MindSystemConfig {
  return {
    version: 1,
    slots: Object.fromEntries(
      DEFAULT_MIND_SYSTEM_SLOTS.map(slot => [slot.key, { ...slot }]),
    ) as Record<MindSystemSlotKey, MindSystemSlot>,
  };
}

export function getMindSystemConfigPath(mindRoot: string): string {
  return path.join(mindRoot, MIND_SYSTEM_CONFIG_RELATIVE_PATH);
}

export function ensureMindSystemConfig(mindRoot: string): MindSystemConfig {
  const configPath = getMindSystemConfigPath(mindRoot);
  const raw = readMindSystemConfigFile(configPath);
  const existing = parseMindSystemConfig(raw);
  const merged = mergeMindSystemConfig(raw);

  if (!existing || JSON.stringify(raw) !== JSON.stringify(merged)) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  }

  return merged;
}

export function readMindSystemConfig(mindRoot: string): MindSystemConfig {
  return ensureMindSystemConfig(mindRoot);
}

export function listMindSystemSlots(mindRoot: string): MindSystemSlot[] {
  const config = readMindSystemConfig(mindRoot);
  return Object.values(config.slots)
    .filter(slot => slot.enabled && mindSystemPathExists(mindRoot, slot))
    .map(slot => ({ ...slot }))
    .sort((a, b) => a.order - b.order);
}

export function mindSystemPathExists(mindRoot: string, slot: Pick<MindSystemSlot, 'path'>): boolean {
  try {
    const resolved = resolveExistingSafe(mindRoot, slot.path);
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function readMindSystemConfigFile(configPath: string): unknown {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseMindSystemConfig(raw: unknown): MindSystemConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.version !== 1 || !source.slots || typeof source.slots !== 'object') return null;
  return mergeMindSystemConfig(source);
}

function mergeMindSystemConfig(raw: unknown): MindSystemConfig {
  const defaults = defaultMindSystemConfig();
  const rawSlots = raw && typeof raw === 'object' && 'slots' in raw
    ? (raw as { slots?: unknown }).slots
    : undefined;

  if (!rawSlots || typeof rawSlots !== 'object') return defaults;

  const slots = { ...defaults.slots };
  for (const [key, value] of Object.entries(rawSlots as Record<string, unknown>)) {
    if (!SLOT_KEYS.has(key as MindSystemSlotKey) || !value || typeof value !== 'object') continue;
    const current = slots[key as MindSystemSlotKey];
    const override = value as Record<string, unknown>;
    slots[key as MindSystemSlotKey] = {
      ...current,
      label: safeString(override.label, current.label),
      path: safePath(override.path, current.path),
      role: safeString(override.role, current.role),
      order: safeNumber(override.order, current.order),
      primary: typeof override.primary === 'boolean' ? override.primary : current.primary,
      enabled: typeof override.enabled === 'boolean' ? override.enabled : current.enabled,
    };
  }

  return { version: 1, slots };
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safePath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes('\0')) return fallback;
  const normalized = trimmed.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return fallback;
  return normalized;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

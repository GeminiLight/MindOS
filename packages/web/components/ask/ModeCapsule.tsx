'use client';

import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import { useLocale } from '@/lib/stores/locale-store';
import type { AskMode, AskPermissionLevel, NativeRuntimePermissionMode } from '@/lib/types';

const STORAGE_KEY = 'mindos-permission-level.v1';
const LEGACY_MODE_STORAGE_KEY = 'mindos-ask-mode';

interface ModeCapsuleProps {
  mode: AskPermissionLevel;
  onChange: (mode: AskPermissionLevel) => void;
  disabled?: boolean;
}

function isPermissionLevel(value: unknown): value is AskPermissionLevel {
  return value === 'read' || value === 'ask' || value === 'auto' || value === 'full';
}

function legacyModeToPermissionLevel(mode: unknown): AskPermissionLevel | null {
  if (mode === 'chat') return 'read';
  if (mode === 'agent') return 'ask';
  return null;
}

export function permissionLevelToAskMode(level: AskPermissionLevel): AskMode {
  return 'agent';
}

export function permissionLevelToNativeRuntimePermission(level: AskPermissionLevel): NativeRuntimePermissionMode {
  return level === 'read' ? 'readonly' : 'agent';
}

export function getPersistedPermissionLevel(): AskPermissionLevel {
  if (typeof window === 'undefined') return 'ask';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPermissionLevel(stored)) return stored;

    const legacy = localStorage.getItem(LEGACY_MODE_STORAGE_KEY);
    const migrated = legacyModeToPermissionLevel(legacy);
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, migrated);
      localStorage.removeItem(LEGACY_MODE_STORAGE_KEY);
      return migrated;
    }
  } catch {
    // localStorage unavailable; keep the in-memory default.
  }
  return 'ask';
}

export function persistPermissionLevel(mode: AskPermissionLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable; the current render still uses the selected value.
  }
}

export function getPersistedMode(): AskMode {
  return permissionLevelToAskMode(getPersistedPermissionLevel());
}

export function persistMode(mode: AskMode | 'chat'): void {
  persistPermissionLevel(legacyModeToPermissionLevel(mode) ?? 'ask');
}

function permissionIcon(mode: AskPermissionLevel, size = 11) {
  if (mode === 'read') return <Shield size={size} className="shrink-0" />;
  if (mode === 'ask') return <ShieldQuestion size={size} className="shrink-0" />;
  if (mode === 'auto') return <ShieldCheck size={size} className="shrink-0" />;
  return <ShieldAlert size={size} className="shrink-0" />;
}

export default function ModeCapsule({ mode, onChange, disabled }: ModeCapsuleProps) {
  const { locale } = useLocale();
  const zh = locale === 'zh';

  const copy = {
    title: zh ? '权限' : 'Permission',
    read: zh ? '只读' : 'Read only',
    readDesc: zh ? '只读文件和知识库，不执行修改。' : 'Read files and knowledge without making edits.',
    ask: zh ? '先询问' : 'Ask first',
    askDesc: zh ? '编辑、联网和有副作用操作前先询问。' : 'Ask before edits, internet access, or side-effect tools.',
    auto: zh ? '自动批准' : 'Auto approve',
    autoDesc: zh ? '低风险操作自动执行，敏感操作再询问。' : 'Run low-risk actions automatically; ask for risky actions.',
    full: zh ? '完全访问' : 'Full access',
    fullDesc: zh ? '本地工具完全开放；仅在可信任务中使用。' : 'Unrestricted local tools. Use with care.',
  };

  const options: Array<AskOptionCapsuleOption<AskPermissionLevel>> = [
    { value: 'read', label: copy.read, description: copy.readDesc, icon: permissionIcon('read', 13) },
    { value: 'ask', label: copy.ask, description: copy.askDesc, icon: permissionIcon('ask', 13) },
    { value: 'auto', label: copy.auto, description: copy.autoDesc, icon: permissionIcon('auto', 13) },
    { value: 'full', label: copy.full, description: copy.fullDesc, icon: permissionIcon('full', 13) },
  ];

  const selected = options.find((option) => option.value === mode) ?? options[1]!;

  return (
    <AskOptionCapsule
      title="Permission"
      ariaLabel="Permission"
      icon={permissionIcon(mode)}
      label={selected.label}
      tooltip={selected.description}
      value={mode}
      options={options}
      onChange={(next) => {
        onChange(next);
        persistPermissionLevel(next);
      }}
      disabled={disabled}
      active={mode !== 'read'}
      dropdownWidthClassName="min-w-[250px] max-w-[300px]"
    />
  );
}

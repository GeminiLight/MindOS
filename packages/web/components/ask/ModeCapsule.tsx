'use client';

import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentPermissionMode } from '@/lib/types';

const STORAGE_KEY = 'mindos-permission-level.v1';

interface ModeCapsuleProps {
  mode: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
  disabled?: boolean;
}

function isPersistedPermissionMode(value: unknown): value is Exclude<AgentPermissionMode, 'read'> {
  return value === 'ask' || value === 'auto' || value === 'full';
}

export function getPersistedPermissionMode(): AgentPermissionMode {
  if (typeof window === 'undefined') return 'ask';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPersistedPermissionMode(stored)) return stored;
  } catch {
    // localStorage unavailable; keep the in-memory default.
  }
  return 'ask';
}

export function persistPermissionMode(mode: AgentPermissionMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode === 'read' ? 'ask' : mode);
  } catch {
    // localStorage unavailable; the current render still uses the selected value.
  }
}

function permissionIcon(mode: AgentPermissionMode, size = 11) {
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
    ask: zh ? '询问' : 'Ask',
    askDesc: zh ? '编辑、联网和有副作用操作前先询问。' : 'Ask before edits, internet access, or side-effect tools.',
    auto: zh ? '自动' : 'Auto',
    autoDesc: zh ? '低风险操作自动执行，敏感操作再询问。' : 'Run low-risk actions automatically; ask for risky actions.',
    full: zh ? '完全' : 'Full',
    fullDesc: zh ? '本地工具完全开放；仅在可信任务中使用。' : 'Unrestricted local tools. Use with care.',
  };

  const options: Array<AskOptionCapsuleOption<AgentPermissionMode>> = [
    { value: 'ask', label: copy.ask, description: copy.askDesc, icon: permissionIcon('ask', 13) },
    { value: 'auto', label: copy.auto, description: copy.autoDesc, icon: permissionIcon('auto', 13) },
    { value: 'full', label: copy.full, description: copy.fullDesc, icon: permissionIcon('full', 13) },
  ];

  const selected = options.find((option) => option.value === mode) ?? options[0]!;

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
        persistPermissionMode(next);
      }}
      disabled={disabled}
      active={mode !== 'read'}
      dropdownWidthClassName="min-w-[250px] max-w-[300px]"
    />
  );
}

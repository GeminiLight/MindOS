'use client';

import { ListChecks, Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import { useLocale } from '@/lib/stores/locale-store';
import {
  COMPOSER_PERMISSION_CHOICES,
  isComposerPermissionChoice,
  type ComposerPermissionChoice,
} from '@/lib/agent/composer-permission';

const STORAGE_KEY = 'mindos-permission-level.v1';

interface ModeCapsuleProps {
  choice: ComposerPermissionChoice;
  onChange: (choice: ComposerPermissionChoice) => void;
  disabled?: boolean;
}

export function getPersistedPermissionChoice(): ComposerPermissionChoice {
  if (typeof window === 'undefined') return 'ask';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isComposerPermissionChoice(stored)) return stored;
  } catch {
    // localStorage unavailable; keep the in-memory default.
  }
  return 'ask';
}

export function persistPermissionChoice(choice: ComposerPermissionChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // localStorage unavailable; the current render still uses the selection.
  }
}

function permissionIcon(choice: ComposerPermissionChoice, size = 11) {
  if (choice === 'read') return <Shield size={size} className="shrink-0" />;
  if (choice === 'plan') return <ListChecks size={size} className="shrink-0" />;
  if (choice === 'ask') return <ShieldQuestion size={size} className="shrink-0" />;
  if (choice === 'auto') return <ShieldCheck size={size} className="shrink-0" />;
  return <ShieldAlert size={size} className="shrink-0" />;
}

/**
 * One ladder, least capable first. Plan sits here rather than in a separate
 * 「模式」control because the server coerces a plan run to read-only; keeping
 * the two apart meant this capsule could read "Auto" while the run could not
 * write a thing. Goal is not on the ladder — it is an objective with a
 * lifecycle, set from the + menu.
 */
export default function ModeCapsule({ choice, onChange, disabled }: ModeCapsuleProps) {
  const { locale } = useLocale();
  const zh = locale === 'zh';

  const copy: Record<ComposerPermissionChoice, { label: string; description: string }> = zh
    ? {
      read: { label: '只读', description: '只读文件和知识库，不执行修改。' },
      plan: { label: '计划', description: '只读梳理上下文，产出可审阅的计划。' },
      ask: { label: '询问', description: '编辑、联网和有副作用操作前先询问。' },
      auto: { label: '自动', description: '低风险操作自动执行，敏感操作再询问。' },
      full: { label: '完全', description: '本地工具完全开放；仅在可信任务中使用。' },
    }
    : {
      read: { label: 'Read only', description: 'Read files and knowledge without making edits.' },
      plan: { label: 'Plan', description: 'Read-only review that produces a plan you can approve.' },
      ask: { label: 'Ask', description: 'Ask before edits, internet access, or side-effect tools.' },
      auto: { label: 'Auto', description: 'Run low-risk actions automatically; ask for risky actions.' },
      full: { label: 'Full', description: 'Unrestricted local tools. Use with care.' },
    };

  const options: Array<AskOptionCapsuleOption<ComposerPermissionChoice>> = COMPOSER_PERMISSION_CHOICES
    .map((value) => ({
      value,
      label: copy[value].label,
      description: copy[value].description,
      icon: permissionIcon(value, 13),
    }));

  const selected = options.find((option) => option.value === choice) ?? options[2]!;

  return (
    <AskOptionCapsule
      title={zh ? '权限' : 'Permission'}
      ariaLabel={zh ? '权限' : 'Permission'}
      icon={permissionIcon(choice)}
      label={selected.label}
      tooltip={selected.description}
      value={choice}
      options={options}
      onChange={(next) => {
        onChange(next);
        persistPermissionChoice(next);
      }}
      disabled={disabled}
      active={choice !== 'ask'}
      dropdownWidthClassName="min-w-[250px] max-w-[300px]"
    />
  );
}

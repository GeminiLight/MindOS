'use client';

import { Bot, ListChecks, Target } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentMode } from '@/lib/types';

interface AgentModeCapsuleProps {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

function agentModeIcon(mode: AgentMode, size = 11) {
  if (mode === 'plan') return <ListChecks size={size} className="shrink-0" />;
  if (mode === 'goal') return <Target size={size} className="shrink-0" />;
  return <Bot size={size} className="shrink-0" />;
}

export default function AgentModeCapsule({ mode, onChange, disabled }: AgentModeCapsuleProps) {
  const { locale } = useLocale();
  const zh = locale === 'zh';

  const copy = {
    title: zh ? '模式' : 'Mode',
    build: zh ? '构建' : 'Build',
    buildDesc: zh ? '默认执行模式。' : 'Default execution mode.',
    plan: zh ? '计划' : 'Plan',
    planDesc: zh ? '只读梳理上下文并产出计划。' : 'Read-only planning with a reviewable plan.',
    goal: zh ? '目标' : 'Goal',
    goalDesc: zh ? '按目标闭环，记录完成或阻塞。' : 'Run against an objective and record the result.',
  };

  const options: Array<AskOptionCapsuleOption<AgentMode>> = [
    { value: 'default', label: copy.build, description: copy.buildDesc, icon: agentModeIcon('default', 13) },
    { value: 'plan', label: copy.plan, description: copy.planDesc, icon: agentModeIcon('plan', 13) },
    { value: 'goal', label: copy.goal, description: copy.goalDesc, icon: agentModeIcon('goal', 13) },
  ];

  const selected = options.find((option) => option.value === mode) ?? options[0]!;

  return (
    <AskOptionCapsule
      title={copy.title}
      ariaLabel={copy.title}
      icon={agentModeIcon(mode)}
      label={selected.label}
      tooltip={selected.description}
      value={mode}
      options={options}
      onChange={onChange}
      disabled={disabled}
      active={mode !== 'default'}
      dropdownWidthClassName="min-w-[250px] max-w-[300px]"
    />
  );
}

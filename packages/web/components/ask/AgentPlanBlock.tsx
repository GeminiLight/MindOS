'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Circle, CircleCheck, CircleDot, ListTodo } from 'lucide-react';
import type { AgentPlanPart } from '@/lib/types';
import { useLocale } from '@/lib/stores/locale-store';

const STATUS_ICON = {
  completed: CircleCheck,
  in_progress: CircleDot,
  pending: Circle,
} as const;

/**
 * The agent's todo list for a turn. Agents resend the whole plan on every
 * change, so this renders the current state rather than a history; it stays
 * collapsed once every step is done to keep finished turns compact.
 */
export default function AgentPlanBlock({ part }: { part: AgentPlanPart }) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const done = part.entries.filter(entry => entry.status === 'completed').length;
  const allDone = done === part.entries.length;
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle ?? !allDone;

  if (part.entries.length === 0) return null;

  const title = zh ? '计划' : 'Plan';
  const progress = `${done}/${part.entries.length}`;

  return (
    <div className="my-1.5 w-full min-w-0 overflow-hidden rounded-lg border border-border/40 bg-background/50 text-xs">
      <button
        type="button"
        onClick={() => setManualToggle(value => (value === null ? !expanded : !value))}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/30"
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden />
          : <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden />}
        <ListTodo size={12} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">{title}</span>
        <span className="ml-auto shrink-0 font-mono text-muted-foreground">{progress}</span>
      </button>

      {expanded && (
        <ul className="space-y-0.5 px-2.5 pb-2.5 pt-0.5">
          {part.entries.map((entry, index) => {
            const Icon = STATUS_ICON[entry.status];
            return (
              <li key={`${index}-${entry.content}`} className="flex items-start gap-1.5">
                <Icon
                  size={12}
                  aria-hidden
                  className={`mt-0.5 shrink-0 ${
                    entry.status === 'completed'
                      ? 'text-success'
                      : entry.status === 'in_progress'
                        ? 'text-[var(--amber)]'
                        : 'text-muted-foreground/50'
                  }`}
                />
                <span
                  className={`min-w-0 flex-1 break-words ${
                    entry.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'
                  }`}
                >
                  {entry.content}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

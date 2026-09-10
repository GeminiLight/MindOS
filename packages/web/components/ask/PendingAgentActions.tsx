'use client';

import { useMemo, useState } from 'react';
import { Loader2, MessageSquareMore, ShieldAlert, Zap } from 'lucide-react';
import {
  buildAskUserQuestionAnswers,
  type AskUserQuestionDraft,
  type PendingAgentActionEntry,
  type PendingAskUserQuestionAction,
  type PendingRuntimePermissionAction,
} from '@geminilight/mindos/server/projections/pending-actions';
import { redactSensitiveText } from '@geminilight/mindos/agent/redaction';
import { usePendingAgentActions } from '@/hooks/usePendingAgentActions';

/**
 * Compact cross-process pending list for the ask panel
 * (spec-cross-process-run-events H): permission prompts, agent questions and
 * automation approvals from ANY host/process, driven by
 * `usePendingAgentActions`. Prompts already rendered inline in the current
 * message stream are excluded via `excludeRunIds` so one prompt never shows
 * up twice.
 */

export type PendingAgentActionsLabels = {
  title?: string;
  answer?: string;
  cancel?: string;
  approve?: string;
  deny?: string;
  customPlaceholder?: string;
};

const DEFAULT_LABELS: Required<PendingAgentActionsLabels> = {
  title: 'Pending agent actions',
  answer: 'Answer',
  cancel: 'Cancel',
  approve: 'Approve',
  deny: 'Deny',
  customPlaceholder: 'Custom answer…',
};

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';
const PRIMARY_BUTTON = `inline-flex h-7 items-center gap-1 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2 text-2xs font-medium text-[var(--amber-foreground)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const SECONDARY_BUTTON = `inline-flex h-7 items-center gap-1 rounded-md border border-border/45 bg-background px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/35 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

function runtimeLabel(runtime: 'codex' | 'claude'): string {
  return runtime === 'claude' ? 'Claude Code' : 'Codex';
}

function riskClass(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'text-error';
  if (level === 'medium') return 'text-[var(--amber)]';
  return 'text-muted-foreground';
}

function ActionShell({
  icon,
  title,
  meta,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md border border-[var(--amber)]/35 bg-[var(--amber-subtle)]/25 px-2 py-1.5 transition-opacity ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <span className="text-[var(--amber)]">{icon}</span>
        <span className="font-medium text-foreground">{redactSensitiveText(title)}</span>
        {meta && <span className="min-w-0 flex-1 truncate text-muted-foreground [overflow-wrap:anywhere]">{redactSensitiveText(meta)}</span>}
        {disabled && <Loader2 size={11} className="ml-auto animate-spin text-muted-foreground" />}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function PermissionRow({
  action,
  busy,
  onDecide,
}: {
  action: PendingRuntimePermissionAction;
  busy: boolean;
  onDecide: (decision: string) => void;
}) {
  const options = action.options.length > 0
    ? action.options
    : [
        { id: 'accept', label: 'Allow once', intent: 'allow' as const },
        { id: 'decline', label: 'Deny', intent: 'deny' as const },
      ];
  const meta = [
    action.toolName,
    action.resource ?? (typeof action.input === 'string' ? action.input : undefined),
  ].filter(Boolean).join(' · ');
  return (
    <ActionShell
      icon={<ShieldAlert size={12} />}
      title={`${runtimeLabel(action.runtime)} permission · ${action.action}`}
      meta={meta || undefined}
      disabled={busy}
    >
      {action.reason && (
        <div className="mb-1.5 text-2xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {redactSensitiveText(action.reason)}
        </div>
      )}
      <div className={`mb-1.5 text-2xs leading-5 ${riskClass(action.risk.level)}`}>
        {redactSensitiveText(action.risk.summary)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isAllow = option.intent === 'allow' || option.id === 'accept' || option.id === 'acceptForSession';
          return (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              title={option.description ? redactSensitiveText(option.description) : undefined}
              onClick={() => onDecide(option.id)}
              className={isAllow ? PRIMARY_BUTTON : SECONDARY_BUTTON}
            >
              {redactSensitiveText(option.label)}
            </button>
          );
        })}
      </div>
    </ActionShell>
  );
}

function QuestionRow({
  action,
  busy,
  labels,
  onAnswer,
  onCancel,
}: {
  action: PendingAskUserQuestionAction;
  busy: boolean;
  labels: Required<PendingAgentActionsLabels>;
  onAnswer: (drafts: Record<number, AskUserQuestionDraft>) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, AskUserQuestionDraft>>({});
  const [draftError, setDraftError] = useState('');

  const toggleOption = (questionIndex: number, label: string, multiSelect: boolean) => {
    setDrafts((current) => {
      const draft = current[questionIndex] ?? {};
      const selected = draft.selected ?? [];
      const nextSelected = multiSelect
        ? selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label]
        : selected[0] === label ? [] : [label];
      return { ...current, [questionIndex]: { ...draft, selected: nextSelected } };
    });
  };

  const submit = () => {
    const built = buildAskUserQuestionAnswers(action, drafts);
    if (!built.ok) {
      setDraftError(built.error);
      return;
    }
    setDraftError('');
    onAnswer(drafts);
  };

  return (
    <ActionShell
      icon={<MessageSquareMore size={12} />}
      title="Agent question"
      meta={action.questions.map((question) => question.header || question.question).join(' · ')}
      disabled={busy}
    >
      <div className="space-y-1.5">
        {action.questions.map((question, questionIndex) => {
          const draft = drafts[questionIndex] ?? {};
          return (
            <div key={`${questionIndex}-${question.question}`}>
              <div className="text-2xs font-medium text-foreground [overflow-wrap:anywhere]">
                {redactSensitiveText(question.question)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {question.options.map((option) => {
                  const selected = (draft.selected ?? []).includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={busy}
                      title={option.description ? redactSensitiveText(option.description) : undefined}
                      aria-pressed={selected}
                      onClick={() => toggleOption(questionIndex, option.label, question.multiSelect === true)}
                      className={`inline-flex h-6 items-center rounded-md border px-1.5 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${
                        selected
                          ? 'border-[var(--amber)] bg-[var(--amber-subtle)]/60 text-foreground'
                          : 'border-border/45 bg-background text-muted-foreground hover:bg-muted/35'
                      }`}
                    >
                      {redactSensitiveText(option.label)}
                    </button>
                  );
                })}
              </div>
              {!question.multiSelect && (
                <input
                  type="text"
                  disabled={busy}
                  value={draft.custom ?? ''}
                  placeholder={labels.customPlaceholder}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [questionIndex]: { ...(current[questionIndex] ?? {}), custom: event.target.value },
                  }))}
                  className={`mt-1 h-6 w-full rounded-md border border-border/45 bg-background px-1.5 text-2xs text-foreground placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy} onClick={submit} className={PRIMARY_BUTTON}>
          {labels.answer}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY_BUTTON}>
          {labels.cancel}
        </button>
        {draftError && <span className="text-2xs text-error">{draftError}</span>}
      </div>
    </ActionShell>
  );
}

export default function PendingAgentActions({
  excludeRunIds,
  labels,
}: {
  /** Run ids whose prompts already render inline in the current message stream. */
  excludeRunIds?: ReadonlySet<string>;
  labels?: PendingAgentActionsLabels;
}) {
  const pending = usePendingAgentActions();
  const t = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  const visibleActions = useMemo(
    () => pending.actions.filter((action: PendingAgentActionEntry) => {
      const runId = 'runId' in action ? action.runId : undefined;
      return !runId || !excludeRunIds?.has(runId);
    }),
    [excludeRunIds, pending.actions],
  );

  if (visibleActions.length === 0) return null;

  return (
    <section
      aria-label={t.title}
      className="shrink-0 space-y-1.5 border-b border-border/40 px-3 py-2"
      data-testid="pending-agent-actions"
    >
      <header className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
        <Zap size={11} className="text-[var(--amber)]" />
        <span>{t.title}</span>
        <span className="rounded-full bg-muted/40 px-1.5 py-px font-mono text-2xs text-foreground/80">
          {visibleActions.length}
        </span>
        {pending.error && <span className="min-w-0 flex-1 truncate text-error">{pending.error}</span>}
      </header>
      {visibleActions.map((action) => {
        const busy = pending.resolvingKey === action.key;
        if (action.kind === 'runtime-permission') {
          return (
            <PermissionRow
              key={action.key}
              action={action}
              busy={busy || pending.resolvingKey !== null}
              onDecide={(decision) => void pending.resolvePermission(action, decision)}
            />
          );
        }
        if (action.kind === 'user-question') {
          return (
            <QuestionRow
              key={action.key}
              action={action}
              busy={busy || pending.resolvingKey !== null}
              labels={t}
              onAnswer={(drafts) => {
                const built = buildAskUserQuestionAnswers(action, drafts);
                if (built.ok) void pending.answerQuestion(action, built.answers);
              }}
              onCancel={() => void pending.cancelQuestion(action)}
            />
          );
        }
        const meta = [action.jobTitle, action.toolName, action.resource].filter(Boolean).join(' · ');
        return (
          <ActionShell
            key={action.key}
            icon={<ShieldAlert size={12} />}
            title={`Automation approval · ${runtimeLabel(action.runtime)}`}
            meta={meta}
            disabled={busy || pending.resolvingKey !== null}
          >
            {action.inputPreview && (
              <pre className="mb-1.5 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/30 bg-background/75 p-1.5 font-mono text-2xs leading-4 text-foreground">
                {redactSensitiveText(action.inputPreview)}
              </pre>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || pending.resolvingKey !== null}
                onClick={() => void pending.resolveAutomationApproval(action, 'allow')}
                className={PRIMARY_BUTTON}
              >
                {t.approve}
              </button>
              <button
                type="button"
                disabled={busy || pending.resolvingKey !== null}
                onClick={() => void pending.resolveAutomationApproval(action, 'deny')}
                className={SECONDARY_BUTTON}
              >
                {t.deny}
              </button>
            </div>
          </ActionShell>
        );
      })}
    </section>
  );
}

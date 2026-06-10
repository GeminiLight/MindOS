'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Circle, Loader2, MessageSquare, PanelRightOpen, Send, X, XCircle } from 'lucide-react';
import type { AskUserQuestion, AskUserQuestionAnswer, ToolCallPart } from '@/lib/types';

type AnswerDraft = {
  mode: 'option' | 'custom' | 'chat' | 'multi';
  value?: string;
  selected?: string[];
};

function answerKey(index: number): string {
  return String(index);
}

function isAnswered(question: AskUserQuestion, draft: AnswerDraft | undefined): boolean {
  if (!draft) return false;
  if (question.multiSelect) return draft.mode === 'multi' && (draft.selected?.length ?? 0) > 0;
  if (draft.mode === 'custom') return Boolean(draft.value?.trim());
  if (draft.mode === 'chat') return true;
  return Boolean(draft.value);
}

function findOption(question: AskUserQuestion, label: string | undefined) {
  return question.options.find(option => option.label === label);
}

function statusText(status: 'waiting' | 'submitted' | 'cancelled', answeredCount: number, total: number, reason?: string): string {
  if (status === 'submitted') return 'Answers submitted';
  if (status === 'cancelled') return `Cancelled${reason ? ` · ${reason}` : ''}`;
  if (total === 0) return 'Waiting for question details';
  return `${answeredCount}/${total} answered`;
}

function statusTitle(status: 'waiting' | 'submitted' | 'cancelled'): string {
  if (status === 'submitted') return 'Clarification complete';
  if (status === 'cancelled') return 'Clarification cancelled';
  return 'Clarification needed';
}

function footerHint(answeredCount: number, total: number, submitting: boolean): string {
  if (submitting) return 'Submitting answer';
  if (answeredCount === total) return 'Ready to continue';
  return `${total - answeredCount} remaining`;
}

function runtimeLabel(runtime: ToolCallPart['runtime']): string {
  if (runtime === 'claude') return 'Claude Code';
  if (runtime === 'codex') return 'Codex';
  if (runtime === 'acp') return 'ACP Agent';
  return 'Local runtime';
}

function draftFromAnswer(answer: AskUserQuestionAnswer): AnswerDraft {
  if (answer.kind === 'multi') return { mode: 'multi', selected: answer.selected ?? [] };
  if (answer.kind === 'custom') return { mode: 'custom', value: answer.answer ?? '' };
  if (answer.kind === 'chat') return { mode: 'chat', value: answer.answer ?? 'Chat about this' };
  return { mode: 'option', value: answer.answer ?? undefined };
}

function draftsFromAnswers(answers: AskUserQuestionAnswer[] | undefined): Record<string, AnswerDraft> {
  if (!answers || answers.length === 0) return {};
  return answers.reduce<Record<string, AnswerDraft>>((drafts, answer) => {
    if (answer.questionIndex < 0) return drafts;
    drafts[answerKey(answer.questionIndex)] = draftFromAnswer(answer);
    return drafts;
  }, {});
}

function buildAnswers(questions: AskUserQuestion[], drafts: Record<string, AnswerDraft>): AskUserQuestionAnswer[] {
  return questions.map((question, index) => {
    const draft = drafts[answerKey(index)];
    if (question.multiSelect) {
      return {
        questionIndex: index,
        question: question.question,
        kind: 'multi',
        answer: null,
        selected: draft?.selected ?? [],
      };
    }
    if (draft?.mode === 'custom') {
      return {
        questionIndex: index,
        question: question.question,
        kind: 'custom',
        answer: draft.value?.trim() || null,
      };
    }
    if (draft?.mode === 'chat') {
      return {
        questionIndex: index,
        question: question.question,
        kind: 'chat',
        answer: 'Chat about this',
      };
    }
    const option = findOption(question, draft?.value);
    return {
      questionIndex: index,
      question: question.question,
      kind: 'option',
      answer: option?.label ?? null,
      ...(option?.preview ? { preview: option.preview } : {}),
    };
  });
}

export default function AskUserQuestionBlock({ part }: { part: ToolCallPart }) {
  const questionState = part.userQuestion;
  const questions = questionState?.questions ?? [];
  const readOnly = questionState?.readOnly === true;
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() => draftsFromAnswers(questionState?.answers));
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [activePreview, setActivePreview] = useState<{ questionIndex: number; label: string } | null>(null);

  useEffect(() => {
    if (!questionState?.answers || questionState.answers.length === 0) return;
    setDrafts(draftsFromAnswers(questionState.answers));
  }, [questionState?.answers]);

  const answeredCount = useMemo(
    () => questions.filter((question, index) => isAnswered(question, drafts[answerKey(index)])).length,
    [drafts, questions],
  );
  const canSubmit = !readOnly && questions.length > 0 && answeredCount === questions.length && questionState?.status === 'waiting' && !submitting;
  const isClosed = questionState?.status === 'submitted' || questionState?.status === 'cancelled';
  const progressPercent = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  const selectedPreview = useMemo(() => {
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const draft = drafts[answerKey(questionIndex)];
      if (!draft) continue;
      const label = draft.mode === 'multi'
        ? draft.selected?.[0]
        : draft.mode === 'option'
          ? draft.value
          : undefined;
      if (label && findOption(questions[questionIndex], label)?.preview) {
        return { questionIndex, label };
      }
    }
    return null;
  }, [drafts, questions]);
  const defaultPreview = useMemo(() => {
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const option = questions[questionIndex].options.find(item => item.preview);
      if (option) return { questionIndex, option };
    }
    return null;
  }, [questions]);

  if (!questionState) {
    return (
      <div className="px-2.5 pb-2.5 pt-1.5 text-muted-foreground">
        Waiting for question details...
      </div>
    );
  }

  async function submit(cancelled = false) {
    if (!questionState || submitting || isClosed) return;
    setSubmitting(true);
    setLocalError('');
    try {
      const response = await fetch('/api/ask/user-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancelled
          ? {
              action: 'cancel',
              runId: questionState.runId,
              toolCallId: part.toolCallId,
              reason: 'user_cancelled',
            }
          : {
              runId: questionState.runId,
              toolCallId: part.toolCallId,
              answers: buildAnswers(questions, drafts),
            }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Failed to submit answer.');
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  }

  function setSingleAnswer(questionIndex: number, value: string) {
    setDrafts(prev => ({
      ...prev,
      [answerKey(questionIndex)]: { mode: 'option', value },
    }));
    setActivePreview({ questionIndex, label: value });
  }

  function setChatAnswer(questionIndex: number) {
    setDrafts(prev => ({
      ...prev,
      [answerKey(questionIndex)]: { mode: 'chat', value: 'Chat about this' },
    }));
  }

  function setCustomAnswer(questionIndex: number, value: string) {
    setDrafts(prev => ({
      ...prev,
      [answerKey(questionIndex)]: { mode: 'custom', value },
    }));
  }

  function toggleMultiAnswer(questionIndex: number, value: string) {
    setDrafts(prev => {
      const current = prev[answerKey(questionIndex)]?.selected ?? [];
      const selected = current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value];
      return {
        ...prev,
        [answerKey(questionIndex)]: { mode: 'multi', selected },
      };
    });
    setActivePreview({ questionIndex, label: value });
  }

  const effectiveActivePreview = activePreview ?? selectedPreview;
  const previewQuestion = effectiveActivePreview ? questions[effectiveActivePreview.questionIndex] : undefined;
  const previewOption = previewQuestion ? findOption(previewQuestion, effectiveActivePreview?.label) : undefined;
  const effectivePreview = previewOption?.preview
    ? { option: previewOption, question: previewQuestion }
    : defaultPreview
      ? { option: defaultPreview.option, question: questions[defaultPreview.questionIndex] }
      : null;

  return (
    <div className="box-border min-w-0 space-y-3 overflow-hidden px-2.5 pb-2.5 pt-2 font-sans">
      <div className="overflow-hidden rounded-md border border-border/40 bg-background/70">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
              questionState.status === 'submitted'
                ? 'border-success/30 bg-success/10 text-success'
                : questionState.status === 'cancelled'
                  ? 'border-error/30 bg-error/8 text-error'
                  : 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber)]'
            }`}>
              {questionState.status === 'submitted'
                ? <CheckCircle2 size={15} />
                : questionState.status === 'cancelled'
                  ? <XCircle size={15} />
                  : submitting
                    ? <Loader2 size={15} className="animate-spin" />
                    : <MessageSquare size={15} />}
            </span>
            <div className="min-w-0">
              <div className="text-foreground/90 font-medium">
                {readOnly ? `${runtimeLabel(questionState.runtime)} question` : statusTitle(questionState.status)}
              </div>
              <div className="truncate text-2xs text-muted-foreground">
                {readOnly
                  ? `${runtimeLabel(questionState.runtime)} is no longer waiting for an answer`
                  : statusText(questionState.status, answeredCount, questions.length, questionState.reason)}
              </div>
            </div>
          </div>
          {questionState.status === 'waiting' && (
            <div className="flex items-center gap-1.5">
              {questions.map((_, index) => {
                const answered = isAnswered(questions[index], drafts[answerKey(index)]);
                return answered
                  ? <CheckCircle2 key={index} size={13} className="text-success" />
                  : <Circle key={index} size={13} className="text-muted-foreground/45" />;
              })}
            </div>
          )}
        </div>
        {questionState.status === 'waiting' && (
          <div className="h-px bg-border/30">
            <div
              className="h-px bg-[var(--amber)] transition-[width] duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-3">
        <div className="min-w-0 space-y-2.5">
          {questions.map((question, index) => {
            const draft = drafts[answerKey(index)];
            const questionAnswered = isAnswered(question, draft);
            return (
              <section
                key={`${question.header}-${index}`}
                className={`min-w-0 overflow-hidden rounded-md border px-2.5 py-2.5 ${
                  questionAnswered
                    ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)]/35'
                    : 'border-border/35 bg-muted/10'
                }`}
              >
                <div className="mb-2 flex items-start gap-2">
                  <span className={`mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded border text-2xs font-medium ${
                    questionAnswered
                      ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)]'
                      : 'border-border bg-background text-muted-foreground'
                  }`}>
                    {questionAnswered ? <Check size={11} /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 break-words text-foreground/90 [overflow-wrap:anywhere]">{question.question}</span>
                      <span className="rounded border border-border/40 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                        {question.header || `Q${index + 1}`}
                      </span>
                    </div>
                    {question.multiSelect && (
                      <div className="mt-1 text-2xs text-muted-foreground">
                        {(draft?.selected?.length ?? 0) > 0 ? `${draft?.selected?.length ?? 0} selected` : 'Multi-select'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {question.options.map((option) => {
                    const selected = question.multiSelect
                      ? (draft?.selected ?? []).includes(option.label)
                      : draft?.mode === 'option' && draft.value === option.label;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={readOnly || isClosed || submitting}
                        aria-pressed={selected}
                        onClick={() => question.multiSelect ? toggleMultiAnswer(index, option.label) : setSingleAnswer(index, option.label)}
                        className={`group w-full min-w-0 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                          selected
                            ? 'border-[var(--amber)] bg-background text-foreground shadow-sm'
                            : 'border-border/40 bg-background/55 text-muted-foreground hover:border-border hover:bg-background hover:text-foreground'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                            question.multiSelect ? 'rounded' : 'rounded-full'
                          } ${selected ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)]' : 'border-border bg-background group-hover:border-border/70'}`}>
                            {selected && <Check size={11} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block break-words text-xs font-medium text-foreground/90 [overflow-wrap:anywhere]">{option.label}</span>
                            <span className="mt-0.5 block break-words text-2xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{option.description}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {!question.multiSelect && (
                  <div className="grid gap-1.5 sm:grid-cols-[1fr_auto]">
                    <input
                      value={draft?.mode === 'custom' ? draft.value ?? '' : ''}
                      disabled={readOnly || isClosed || submitting}
                      onChange={(event) => setCustomAnswer(index, event.target.value)}
                      aria-label={`${question.header || `Question ${index + 1}`} custom answer`}
                      placeholder="Type a custom answer..."
                      className={`h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                        draft?.mode === 'custom' && draft.value?.trim()
                          ? 'border-[var(--amber)]'
                          : 'border-border/40'
                      }`}
                    />
                    <button
                      type="button"
                      disabled={readOnly || isClosed || submitting}
                      aria-pressed={draft?.mode === 'chat'}
                      onClick={() => setChatAnswer(index)}
                      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                        draft?.mode === 'chat'
                          ? 'border-[var(--amber)] bg-background text-foreground'
                          : 'border-border/40 bg-background/55 text-muted-foreground hover:bg-background hover:text-foreground'
                      }`}
                    >
                      <MessageSquare size={12} />
                      Chat
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside className="min-w-0 rounded-md border border-border/40 bg-background/60 p-3">
          {effectivePreview?.option.preview ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <PanelRightOpen size={12} />
                <span>{effectivePreview.option.label}</span>
              </div>
              {effectivePreview.question && (
                <div className="text-2xs leading-5 text-muted-foreground">
                  {effectivePreview.question.header || effectivePreview.question.question}
                </div>
              )}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/30 bg-muted/15 p-2.5 font-mono text-2xs leading-5 text-foreground">
                {effectivePreview.option.preview}
              </pre>
            </div>
          ) : (
            <div className="flex h-full min-h-24 items-center justify-center rounded-md border border-dashed border-border/40 bg-muted/10 px-3 text-center text-2xs leading-5 text-muted-foreground">
              No preview for this question.
            </div>
          )}
        </aside>
      </div>

      {localError && (
        <div className="rounded-md border border-error/30 bg-error/8 px-2.5 py-2 text-2xs text-error">
          {localError}
        </div>
      )}

      {questionState.status === 'waiting' && readOnly && (
        <div className="rounded-md border border-border/35 bg-muted/10 px-2.5 py-2 text-2xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          This question came from {runtimeLabel(questionState.runtime)}, but this run is no longer waiting for an answer.
        </div>
      )}

      {questionState.status === 'waiting' && !readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/30 pt-2">
          <div className="text-2xs text-muted-foreground">
            {footerHint(answeredCount, questions.length, submitting)}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/50 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submit(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border/40 disabled:bg-muted/20 disabled:text-muted-foreground"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

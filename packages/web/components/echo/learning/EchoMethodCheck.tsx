'use client';
import { useEchoDraft } from '../use-echo-draft';
import { useEffect, useRef, useState } from 'react';
import type {
  LearningLoop,
  MethodCheck,
  MethodCheckKind,
  MethodCheckRun,
} from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { openAskModal } from '@/hooks/useAskModal';
import { methodCheckCopy, type MethodCheckCopy } from './method-check-copy';
import EchoMethodHandoff, {
  emptyHandoffDraft,
  type MethodHandoffDraft,
} from './EchoMethodHandoff';
const field =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const summary =
  'min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const blank = {
  useTask: '',
  useExpected: '',
  exceptionTask: '',
  exceptionExpected: '',
};
type View = { check: MethodCheck; runs: MethodCheckRun[] };
type ReviewDraft = {
  outcome: 'met' | 'missed' | 'uncertain';
  quote: string;
  reason: string;
};
type Props = {
  loop: LearningLoop;
  attemptIndex: number;
  revisionIndex: number;
  disabled: boolean;
};
export default function EchoMethodCheck({
  loop,
  attemptIndex,
  revisionIndex,
  disabled,
}: Props) {
  const { locale } = useLocale();
  const p = methodCheckCopy[locale];
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<
    Array<{ id: string; createdAt: string }>
  >([]);
  const [view, setView] = useState<View | null>(null);
  const [partial, setPartial] = useState(false);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useEchoDraft(`${loop.id}:check:${attemptIndex}:${revisionIndex}` + ":values", blank);
  const [drafts, setDrafts] = useEchoDraft<Record<string, ReviewDraft>>(`${loop.id}:check:${attemptIndex}:${revisionIndex}` + ":drafts", {});
  const [prepared, setPrepared] = useState(false);
  const [handoffDrafts, setHandoffDrafts] = useEchoDraft<
    Record<string, MethodHandoffDraft>
  >(`${loop.id}:check:${attemptIndex}:${revisionIndex}` + ":handoffDrafts", {});
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty =
    Object.values(values).some((value) => value.trim()) ||
    Object.keys(drafts).length > 0 ||
    Object.values(handoffDrafts).some(
      (item) =>
        item.sourceRunId ||
        item.targetId ||
        item.rationale ||
        item.counterexampleIds.length,
    );
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (view) heading.current?.focus();
  }, [view?.check.id]);
  async function call(
    url: string,
    method = 'GET',
    body?: Record<string, unknown>,
  ) {
    if (controller.current) return null;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, {
        method,
        cache: 'no-store',
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]),
        ...(body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(
          p.errors[data.code as keyof typeof p.errors] ?? p.errors.storage,
        );
        return null;
      }
      return ctrl.signal.aborted ? null : data;
    } catch {
      if (!ctrl.signal.aborted) setError(p.errors.storage);
      return null;
    } finally {
      controller.current = null;
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }
  async function load(id: string) {
    const data = await call('/api/echo/method-checks?id=' + id);
    if (data?.check && Array.isArray(data.runs)) {
      setView(data);
      setCreating(false);
      setPrepared(false);
    }
  }
  async function reload() {
    const params = new URLSearchParams({
      learningId: loop.id,
      attemptIndex: String(attemptIndex),
      revisionIndex: String(revisionIndex),
    });
    const data = await call('/api/echo/method-checks?' + params);
    if (!data || !Array.isArray(data.checks)) return;
    setChecks(data.checks);
    setPartial(data.unavailableCount > 0);
    setLoaded(true);
    const id = view?.check.id ?? data.checks[0]?.id;
    if (id) await load(id);
    else setCreating(true);
  }
  useEffect(() => {
    if (open && !loaded) void reload();
  }, [open]); // Load private cases only when the user opens this section.
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!view || busy) return false;
    const data = await call('/api/echo/method-checks', 'PATCH', {
      id: view.check.id,
      version: view.check.version,
      action,
      ...extra,
    });
    if (!data?.check) return false;
    setView({ check: data.check, runs: data.runs ?? view.runs });
    if (data.draft) {
      openAskModal(data.draft.prompt, 'user', data.draft.runtime ?? null, {
        newSession: true,
        context: {
          path: data.draft.path,
          type: 'file',
          label: data.draft.title,
        },
      });
      setPrepared(true);
    }
    return true;
  }
  async function create() {
    if (disabled || busy) return;
    const data = await call('/api/echo/method-checks', 'POST', {
      learningId: loop.id,
      version: loop.version,
      attemptIndex,
      revisionIndex,
      locale,
      ...values,
    });
    if (data?.check) {
      setView({ check: data.check, runs: [] });
      setChecks((current) => [
        { id: data.check.id, createdAt: data.check.createdAt },
        ...current.filter((item) => item.id !== data.check.id),
      ]);
      setValues(blank);
      setCreating(false);
      setPrepared(false);
    }
  }
  return (
    <details
      className="mt-4 border-t border-border"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={summary}>{p.title}</summary>
      <div className="space-y-4 pb-4" aria-busy={busy}>
        <p className="text-sm leading-6 text-muted-foreground">{p.lead}</p>
        {disabled ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {p.unavailable}
          </p>
        ) : null}
        {checks.length ? (
          <label className="block space-y-2">
            <span className="text-sm">{p.choose}</span>
            <select
              className={field}
              disabled={busy}
              value={view?.check.id ?? ''}
              onChange={(event) => void load(event.target.value)}
            >
              {checks.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.createdAt).toLocaleString(
                    locale === 'zh' ? 'zh-CN' : 'en-US',
                  )}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {loaded && !disabled && !creating ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            {p.newCheck}
          </Button>
        ) : null}
        {loaded && creating && !disabled ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              {(['use', 'exception'] as const).map((kind) => (
                <div key={kind} className="space-y-3">
                  <h5 className="text-sm font-medium">{p[kind]}</h5>
                  {(['Task', 'Expected'] as const).map((suffix) => {
                    const key = (kind + suffix) as keyof typeof blank;
                    return (
                      <TextField
                        key={key}
                        name={'check-' + key}
                        label={suffix === 'Task' ? p.task : p.expected}
                        value={values[key]}
                        limit={suffix === 'Task' ? 4000 : 1600}
                        change={(value) =>
                          setValues((current) => ({ ...current, [key]: value }))
                        }
                      />
                    );
                  })}
                </div>
              ))}
              <p className="text-xs leading-5 text-muted-foreground">
                {p.frozen}
              </p>
              <Button
                type="submit"
                className="min-h-11 h-auto whitespace-normal"
                disabled={Object.values(values).some((value) => !value.trim())}
              >
                {p.freeze}
              </Button>
            </fieldset>
          </form>
        ) : null}
        {creating && view ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => setCreating(false)}
          >
            {p.back}
          </Button>
        ) : null}
        {view && !creating ? (
          <>
            <h5
              ref={heading}
              tabIndex={-1}
              className="scroll-mt-20 rounded font-display text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {view.check.method.title}
            </h5>
            <CheckRecord
              handoffDraft={handoffDrafts[view.check.id] ?? emptyHandoffDraft}
              changeHandoffDraft={(value) =>
                setHandoffDrafts((current) => ({
                  ...current,
                  [view.check.id]: value,
                }))
              }
              view={view}
              p={p}
              busy={busy}
              disabled={disabled}
              mutate={mutate}
              drafts={drafts}
              changeDraft={(key, draft) =>
                setDrafts((current) => ({ ...current, [key]: draft }))
              }
              clearDraft={(key) =>
                setDrafts((current) => {
                  const next = { ...current };
                  delete next[key];
                  return next;
                })
              }
            />
            {prepared ? (
              <p
                role="status"
                className="text-sm leading-6 text-muted-foreground"
              >
                {p.prepared}
              </p>
            ) : null}
            <a
              className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={
                '/api/echo/method-checks?id=' + view.check.id + '&format=json'
              }
              download
            >
              {p.export}
            </a>
          </>
        ) : null}
        {busy ? (
          <p role="status" className="text-xs text-muted-foreground">
            {loaded ? p.saving : p.loading}
          </p>
        ) : null}
        {partial ? (
          <p role="status" className="text-sm text-muted-foreground">
            {p.partial}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="border-l-2 border-error pl-3 text-sm leading-6"
          >
            {error}
          </p>
        ) : null}
        {loaded || error ? (
          <Button
            variant="ghost"
            disabled={busy}
            className="min-h-11"
            onClick={() => void reload()}
          >
            {p.refresh}
          </Button>
        ) : null}
      </div>
    </details>
  );
}
function TextField({
  name,
  label,
  value,
  change,
  limit = 1600,
}: {
  name: string;
  label: string;
  value: string;
  change: (value: string) => void;
  limit?: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm">{label}</span>
      <textarea
        name={name}
        required
        rows={3}
        maxLength={limit}
        value={value}
        onChange={(event) => change(event.target.value)}
        className={field}
      />
    </label>
  );
}
function CheckRecord({
  handoffDraft,
  changeHandoffDraft,
  view,
  p,
  busy,
  disabled,
  mutate,
  drafts,
  changeDraft,
  clearDraft,
}: {
  handoffDraft: MethodHandoffDraft;
  changeHandoffDraft: (value: MethodHandoffDraft) => void;
  view: View;
  p: MethodCheckCopy;
  busy: boolean;
  disabled: boolean;
  mutate: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  drafts: Record<string, ReviewDraft>;
  changeDraft: (key: string, draft: ReviewDraft) => void;
  clearDraft: (key: string) => void;
}) {
  const [kind, setKind] = useState<MethodCheckKind>('use');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const runSelector = useRef<HTMLSelectElement>(null);
  const { check, runs } = view;
  const current = check.cases.find((item) => item.kind === kind)!;
  const options = runs.filter((item) => item.kind === kind);
  const run = options.find((item) => item.runId === selected[check.id + kind]);
  const prior = [...check.assessments]
    .reverse()
    .find((item) => item.runId === run?.runId);
  const key = check.id + ':' + run?.runId;
  const draft = drafts[key] ?? {
    outcome: prior?.outcome ?? 'uncertain',
    quote: prior?.quote ?? '',
    reason: prior?.reason ?? '',
  };
  const changed =
    !prior ||
    draft.outcome !== prior.outcome ||
    draft.quote !== prior.quote ||
    draft.reason !== prior.reason;
  const canAssess =
    run?.status === 'completed' && !run.error && !!run.output.trim();
  return (
    <div className="space-y-4">
      <div role="group" aria-label={p.title} className="flex flex-wrap gap-2">
        {(['use', 'exception'] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            disabled={busy}
            className={
              'min-h-11 h-auto whitespace-normal ' +
              (kind === value ? 'bg-muted' : '')
            }
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {p[value]}
          </Button>
        ))}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">
        {current.task}
      </p>
      <p className="text-xs text-muted-foreground">{p.expected}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">
        {current.expected}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">{p.frozen}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={
            busy ||
            disabled ||
            check.preparations.length >= 20 ||
            options.some(
              (item) =>
                item.source === 'live' &&
                ['queued', 'running', 'streaming'].includes(item.status),
            )
          }
          onClick={() => void mutate('prepare', { kind })}
        >
          {p.prepare}
        </Button>
        <Button
          variant="outline"
          className="min-h-11 h-auto whitespace-normal"
          disabled={busy}
          onClick={() => void mutate('capture')}
        >
          {p.capture}
        </Button>
      </div>
      {check.preparations.length >= 20 ? (
        <p className="text-xs text-muted-foreground">{p.limit}</p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">{p.recent}</p>
      {!options.length ? (
        <p className="text-sm leading-6 text-muted-foreground">{p.noRuns}</p>
      ) : (
        <label className="block space-y-2">
          <span className="text-sm">{p.run}</span>
          <select
            name="checkRun"
            ref={runSelector}
            className={field}
            value={run?.runId ?? ''}
            disabled={busy}
            onChange={(event) =>
              setSelected((value) => ({
                ...value,
                [check.id + kind]: event.target.value,
              }))
            }
          >
            <option value="">{p.select}</option>
            {options.map((item) => (
              <option key={item.runId} value={item.runId}>
                {new Date(item.startedAt).toLocaleString()} · {item.runtimeId} ·{' '}
                {p.statuses[item.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {run ? (
        <div className="space-y-3 border-l-2 border-border pl-3">
          <p className="text-xs font-medium">
            {p.statuses[run.status]} · {run.runtimeId}
            {run.source === 'saved' ? ' · ' + p.savedRun : ''}
          </p>
          <p className="text-xs text-muted-foreground">{p.output}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {run.output || run.error}
          </p>
          {['failed', 'canceled', 'timed_out'].includes(run.status) ? (
            <p className="text-sm leading-6">{p.failed}</p>
          ) : null}
        </div>
      ) : null}
      {canAssess ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !busy &&
              run &&
              changed &&
              (await mutate('assess', { kind, runId: run.runId, ...draft }))
            )
              clearDraft(key);
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm">{p.outcome}</span>
              <select
                name="checkOutcome"
                className={field}
                value={draft.outcome}
                onChange={(event) =>
                  changeDraft(key, {
                    ...draft,
                    outcome: event.target.value as ReviewDraft['outcome'],
                  })
                }
              >
                {Object.entries(p.outcomes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              name="checkQuote"
              label={p.quote}
              limit={1200}
              value={draft.quote}
              change={(quote) => changeDraft(key, { ...draft, quote })}
            />
            <TextField
              name="checkReason"
              label={p.reason}
              value={draft.reason}
              change={(reason) => changeDraft(key, { ...draft, reason })}
            />
            {prior ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {p.reviseHint}
              </p>
            ) : null}
            <Button
              type="submit"
              className="min-h-11"
              disabled={!changed || !draft.quote.trim() || !draft.reason.trim()}
            >
              {prior ? p.revise : p.save}
            </Button>
          </fieldset>
        </form>
      ) : null}
      {check.assessments.length ? (
        <div className="space-y-2">
          <h6 className="text-sm font-medium">{p.saved}</h6>
          {check.assessments.map((item, index) => (
            <details key={index} className="border-t border-border">
              <summary className={summary}>
                {p[item.kind]} · {p.outcomes[item.outcome]} ·{' '}
                {new Date(item.recordedAt).toLocaleString()}
              </summary>
              <div className="space-y-2 pb-3">
                <p className="text-xs text-muted-foreground">{p.reported}</p>
                <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-6">
                  {item.quote}
                </blockquote>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {item.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.runtimeId}
                  {item.model ? ' · ' + item.model : ''}
                </p>
              </div>
            </details>
          ))}
        </div>
      ) : null}
      <EchoMethodHandoff
        key={check.id}
        check={check}
        runs={runs}
        busy={busy}
        disabled={disabled}
        draft={handoffDraft}
        changeDraft={changeHandoffDraft}
        mutate={mutate}
        review={(item) => {
          setKind(item.kind);
          setSelected((current) => ({
            ...current,
            [check.id + item.kind]: item.runId,
          }));
          requestAnimationFrame(() => {
            runSelector.current?.focus();
            runSelector.current?.scrollIntoView({ block: 'center' });
          });
        }}
      />
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  MethodCheck,
  MethodCheckRun,
  MethodHandoff,
  previewMethodHandoff,
} from '@geminilight/mindos/knowledge';
import type { AgentRuntimeIdentity } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { methodHandoffCopy } from './method-handoff-copy';
export type MethodHandoffDraft = {
  sourceRunId: string;
  targetId: string;
  rationale: string;
  counterexampleIds: string[];
};
export const emptyHandoffDraft: MethodHandoffDraft = {
  sourceRunId: '',
  targetId: '',
  rationale: '',
  counterexampleIds: [],
};
type Preview = ReturnType<typeof previewMethodHandoff>;
type Runtime = AgentRuntimeIdentity & { status: string };
const field =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const summary =
  'min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type Props = {
  check: MethodCheck;
  runs: MethodCheckRun[];
  busy: boolean;
  disabled: boolean;
  draft: MethodHandoffDraft;
  changeDraft: (value: MethodHandoffDraft) => void;
  mutate: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  review: (run: MethodCheckRun) => void;
};
export default function EchoMethodHandoff({
  check,
  runs,
  busy,
  disabled,
  draft,
  changeDraft,
  mutate,
  review,
}: Props) {
  const { locale } = useLocale();
  const p = methodHandoffCopy[locale];
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [creating, setCreating] = useState(
    !check.handoffs?.length || !!draft.sourceRunId || !!draft.rationale,
  );
  const [selected, setSelected] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const sources = runs.filter(
    (item) =>
      item.status === 'completed' && !item.error && !!item.output.trim(),
  );
  const source = sources.find((item) => item.runId === draft.sourceRunId);
  const target = runtimes.find((item) => item.id === draft.targetId);
  const handoffs = check.handoffs ?? [];
  const handoff =
    handoffs.find((item) => item.id === selected) ?? handoffs.at(-1);
  const limited = handoffs.length >= 5;
  const working = busy || loading;
  async function load() {
    if (controller.current) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setLoading(true);
    setError(false);
    try {
      const responses = await Promise.all(
        [
          '/api/echo/method-checks?id=' + check.id + '&preview=handoff',
          '/api/agent-runtimes',
        ].map((url) =>
          fetch(url, {
            cache: 'no-store',
            signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]),
          }),
        ),
      );
      if (responses.some((item) => !item.ok))
        throw new Error('Could not load handoff options');
      const [material, catalog] = await Promise.all(
        responses.map((item) => item.json()),
      );
      if (
        !material.previewHash ||
        typeof material.methodBody !== 'string' ||
        !Array.isArray(material.counterexamples) ||
        !Array.isArray(catalog.runtimes)
      )
        throw new Error('Invalid options');
      if (!ctrl.signal.aborted) {
        setPreview(material);
        setRuntimes(
          catalog.runtimes.filter(
            (item: Runtime) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              ['mindos', 'codex', 'claude', 'acp'].includes(item.kind),
          ),
        );
      }
    } catch {
      if (!ctrl.signal.aborted) setError(true);
    } finally {
      controller.current = null;
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    if (open && !preview && !disabled) void load();
  }, [open]);
  async function save() {
    if (
      working ||
      disabled ||
      limited ||
      !source ||
      !target ||
      target.status !== 'available' ||
      source.runtimeId === target.id ||
      !preview
    )
      return;
    if (
      await mutate('handoff', {
        sourceRunId: source.runId,
        target: { id: target.id, kind: target.kind, name: target.name },
        rationale: draft.rationale,
        previewHash: preview.previewHash,
        counterexampleIds: draft.counterexampleIds,
      })
    ) {
      changeDraft(emptyHandoffDraft);
      setCreating(false);
      setSelected('');
    }
  }
  const date = (value: string | number) =>
    new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <details
      className="border-t border-border"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={summary}>{p.title}</summary>
      <div className="space-y-4 pb-4" aria-busy={working}>
        <p className="text-sm leading-6 text-muted-foreground">{p.lead}</p>
        {disabled ? (
          <p className="text-sm text-muted-foreground">{p.paused}</p>
        ) : null}
        {handoffs.length ? (
          <label className="block space-y-2">
            <span className="text-sm">{p.choose}</span>
            <select
              className={field}
              disabled={working}
              value={handoff?.id ?? ''}
              onChange={(event) => {
                setSelected(event.target.value);
                setCreating(false);
              }}
            >
              {handoffs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.source.runtimeId} → {item.target.name} ·{' '}
                  {date(item.createdAt)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!creating && !disabled && !limited ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={working}
            onClick={() => {
              setCreating(true);
              if (!preview) void load();
            }}
          >
            {p.new}
          </Button>
        ) : null}
        {limited ? (
          <p className="text-sm text-muted-foreground">{p.limit}</p>
        ) : null}
        {creating && !disabled && !limited ? (
          !sources.length ? (
            <p className="text-sm text-muted-foreground">{p.noSource}</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={working} className="min-w-0 space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm">{p.source}</span>
                  <select
                    required
                    name="handoffSource"
                    className={field}
                    value={draft.sourceRunId}
                    onChange={(event) => {
                      const next = sources.find(
                        (item) => item.runId === event.target.value,
                      );
                      changeDraft({
                        ...draft,
                        sourceRunId: event.target.value,
                        targetId:
                          next?.runtimeId === draft.targetId
                            ? ''
                            : draft.targetId,
                      });
                    }}
                  >
                    <option value="">{p.select}</option>
                    {sources.map((item) => (
                      <option key={item.runId} value={item.runId}>
                        {item.runtimeId} · {date(item.startedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm">{p.target}</span>
                  <select
                    required
                    name="handoffTarget"
                    className={field}
                    value={draft.targetId}
                    onChange={(event) =>
                      changeDraft({ ...draft, targetId: event.target.value })
                    }
                  >
                    <option value="">{p.select}</option>
                    {runtimes
                      .filter((item) => item.id !== source?.runtimeId)
                      .map((item) => (
                        <option
                          key={item.kind + ':' + item.id}
                          value={item.id}
                          disabled={item.status !== 'available'}
                        >
                          {item.name}
                          {item.status !== 'available'
                            ? ' · ' + p.unavailable
                            : ''}
                        </option>
                      ))}
                  </select>
                </label>
                {!runtimes.some(
                  (item) =>
                    item.status === 'available' &&
                    item.id !== source?.runtimeId,
                ) && !loading ? (
                  <p className="text-sm text-muted-foreground">
                    {p.emptyAgents}
                  </p>
                ) : null}
                <label className="block space-y-2">
                  <span className="text-sm">{p.rationale}</span>
                  <textarea
                    required
                    name="handoffRationale"
                    className={field}
                    rows={3}
                    maxLength={1600}
                    value={draft.rationale}
                    onChange={(event) =>
                      changeDraft({ ...draft, rationale: event.target.value })
                    }
                  />
                </label>
                {preview ? (
                  <>
                    <Packet
                      methodBody={preview.methodBody}
                      title={p.material}
                    />
                    {preview.counterexamples.length ? (
                      <fieldset className="space-y-2">
                        <legend className="text-sm">{p.counterexamples}</legend>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {p.unassessed}
                        </p>
                        {preview.counterexamples.map((item) => (
                          <label
                            key={item.id}
                            className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                              checked={draft.counterexampleIds.includes(
                                item.id,
                              )}
                              disabled={
                                working ||
                                (!draft.counterexampleIds.includes(item.id) &&
                                  draft.counterexampleIds.length >= 10)
                              }
                              onChange={(event) =>
                                changeDraft({
                                  ...draft,
                                  counterexampleIds: event.target.checked
                                    ? [...draft.counterexampleIds, item.id]
                                    : draft.counterexampleIds.filter(
                                        (id) => id !== item.id,
                                      ),
                                })
                              }
                            />
                            <span className="break-words">
                              {item.observation}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                  </>
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  {p.context}
                </p>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={
                    !preview ||
                    !source ||
                    !target ||
                    target.status !== 'available' ||
                    target.id === source.runtimeId ||
                    !draft.rationale.trim()
                  }
                >
                  {p.save}
                </Button>
              </fieldset>
            </form>
          )
        ) : null}
        {creating && handoff ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={working}
            onClick={() => setCreating(false)}
          >
            {p.back}
          </Button>
        ) : null}
        {!creating && handoff ? (
          <>
            <p className="text-sm font-medium">
              {handoff.source.runtimeId} → {handoff.target.name}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {handoff.rationale}
            </p>
            <Packet methodBody={handoff.methodBody} title={p.material} />
            {handoff.counterexamples.length ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{p.unassessed}</p>
                {handoff.counterexamples.map((item) => (
                  <p
                    key={item.id}
                    className="whitespace-pre-wrap break-words text-sm leading-6"
                  >
                    {item.observation}
                  </p>
                ))}
              </div>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              {p.context}
            </p>
            {(['use', 'exception'] as const).map((kind) => {
              const matching = runs.filter(
                (item) => item.handoffId === handoff.id && item.kind === kind,
              );
              const completed = matching.filter(
                (item) =>
                  item.targetMatches &&
                  item.status === 'completed' &&
                  !item.error &&
                  item.output.trim(),
              );
              const assessed = completed.filter((item) =>
                check.assessments.some(
                  (assessment) => assessment.runId === item.runId,
                ),
              );
              const active = matching.some(
                (item) =>
                  item.source === 'live' &&
                  ['queued', 'running', 'streaming'].includes(item.status),
              );
              return (
                <div
                  key={kind}
                  className="space-y-3 border-l-2 border-border pl-3"
                >
                  <h6 className="text-sm font-medium">
                    {p[kind]} ·{' '}
                    {assessed.length
                      ? p.assessed
                      : completed.length
                        ? p.returned
                        : active
                          ? p.active
                          : matching.length
                            ? p.retry
                            : p.noRun}
                  </h6>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      working ||
                      disabled ||
                      active ||
                      check.preparations.length >= 20
                    }
                    onClick={() =>
                      void mutate('prepare', { kind, handoffId: handoff.id })
                    }
                  >
                    {kind === 'use' ? p.prepareUse : p.prepareException}
                  </Button>
                  {matching.map((item) => (
                    <div key={item.runId} className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {item.runtimeId} · {date(item.startedAt)}
                        {!item.targetMatches ? ' · ' + p.mismatch : ''}
                      </p>
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        disabled={working}
                        onClick={() => review(item)}
                      >
                        {p.review}
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="text-xs leading-5 text-muted-foreground">
              {p.status}
            </p>
          </>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="border-l-2 border-error pl-3 text-sm leading-6"
          >
            {p.error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {p.saving}
          </p>
        ) : null}
        {!disabled ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={working}
            onClick={() => void load()}
          >
            {p.refresh}
          </Button>
        ) : null}
      </div>
    </details>
  );
}
function Packet({ methodBody, title }: { methodBody: string; title: string }) {
  return (
    <details className="border-t border-border">
      <summary className={summary}>{title}</summary>
      <pre
        className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
      >
        {methodBody}
      </pre>
    </details>
  );
}

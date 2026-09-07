'use client';
import { useEffect, useRef } from 'react';
import type { Inquiry, InquiryRun } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { InquiryFields, control, note } from './InquiryFields';
import type { InquiryCopy } from './inquiry-copy';
export type InquiryFormKind =
  | 'plan'
  | 'observe'
  | 'decide'
  | 'method-draft'
  | 'method-revision';
export function InquiryActionForm({
  kind,
  q,
  runs,
  p,
  values,
  change,
  busy,
  submit,
  close,
}: {
  kind: InquiryFormKind;
  q: Inquiry;
  runs: InquiryRun[];
  p: InquiryCopy;
  values: Record<string, string>;
  change: (v: Record<string, string>) => void;
  busy: boolean;
  submit: (v: Record<string, unknown>) => void;
  close: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLElement>('textarea, select, input')
      ?.focus();
  }, [kind]);
  const frame = q.frames.at(-1)!;
  const plan = q.plans.filter((p) => p.frameId === frame.id).at(-1);
  const observations = q.observations.filter((o) =>
    q.plans.some((p) => p.id === o.planId && p.frameId === frame.id),
  );
  const candidates = runs.filter(
    (r) =>
      r.status === 'completed' &&
      q.preparations.some(
        (p) => p.id === r.preparationId && p.planId === plan?.id,
      ),
  );
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <label className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      <select
        name={name}
        className={control + ' w-full'}
        required
        value={values[name] ?? ''}
        onChange={(e) => change({ ...values, [name]: e.target.value })}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const revisionDecision = q.decisions.find((d) => d.id === values.decisionId);
  const linkedMethods = (q.methodLinks ?? []).filter(
    (l) =>
      l.frameId ===
      (kind === 'method-revision' ? revisionDecision?.frameId : frame.id),
  );
  const revisionBase = linkedMethods.find((l) => l.id === values.methodLinkId);
  const evidenceIds = (values.evidenceIds ?? '').split(',').filter(Boolean);
  function save() {
    if (busy) return;
    if (kind === 'plan')
      submit({
        action: kind,
        frameId: frame.id,
        ...(values.methodLinkId ? { methodLinkId: values.methodLinkId } : {}),
        ...Object.fromEntries(
          [
            'task',
            'supportsA',
            'supportsB',
            'inconclusive',
            'scope',
            'budget',
          ].map((k) => [k, values[k] ?? '']),
        ),
      });
    if (kind === 'observe' && plan)
      submit({
        action: kind,
        planId: plan.id,
        kind: values.kind,
        ...(values.kind === 'run'
          ? { runId: values.runId }
          : { sourceLabel: values.sourceLabel }),
        quote: values.quote,
        interpretation: values.interpretation,
        outcome: values.outcome,
      });
    if (kind === 'decide')
      submit({
        action: kind,
        frameId: frame.id,
        outcome: values.outcome,
        reason: values.reason,
        evidenceIds,
        ...(values.outcome === 'reframe'
          ? { nextQuestion: values.nextQuestion }
          : {}),
      });
    if (kind === 'method-draft' || kind === 'method-revision')
      submit({
        action: kind,
        decisionId: values.decisionId,
        ...(kind === 'method-revision'
          ? { methodLinkId: values.methodLinkId, reason: values.reason }
          : {}),
        behavior: values.behavior,
        scope: values.scope,
        check: values.check,
      });
  }
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5 rounded-lg border border-border p-4 sm:p-5"
    >
      <h3 className="font-display text-lg">
        {kind === 'plan'
          ? p.planTitle
          : kind === 'observe'
            ? p.observe
            : kind === 'decide'
              ? p.decision
              : kind === 'method-revision'
                ? p.reviseMethod
                : p.proposal}
      </h3>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {kind === 'plan' ? (
          <>
            <p className={note}>{p.planHint}</p>
            <InquiryFields
              names={[
                'task',
                'supportsA',
                'supportsB',
                'inconclusive',
                'scope',
                'budget',
              ]}
              value={values}
              onChange={change}
              p={p}
            />
            {linkedMethods.length ? (
              <label className="block space-y-2 text-sm font-medium">
                <span>{p.methodLinkId}</span>
                <select
                  name="methodLinkId"
                  className={control + ' w-full'}
                  value={values.methodLinkId ?? ''}
                  onChange={(e) =>
                    change({ ...values, methodLinkId: e.target.value })
                  }
                >
                  <option value="">{p.noMethod}</option>
                  {linkedMethods.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.method.behavior} · v{l.revisionIndex + 1} ·{' '}
                      {new Date(l.linkedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        {kind === 'observe' ? (
          <>
            <p className={note}>{p.observationHint}</p>
            {select('kind', p.kind, [
              { value: 'manual', label: p.manual },
              { value: 'run', label: p.actual },
            ])}
            {values.kind === 'run' ? (
              <>
                {select('runId', p.actual, [
                  { value: '', label: p.choose },
                  ...candidates.map((r) => ({
                    value: r.runId,
                    label:
                      r.runtimeId +
                      ' · ' +
                      new Date(r.startedAt).toLocaleString(),
                  })),
                ])}
                {candidates.find((r) => r.runId === values.runId) ? (
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-sm leading-6">
                    {candidates.find((r) => r.runId === values.runId)!.output}
                  </pre>
                ) : null}
              </>
            ) : (
              <InquiryFields
                names={['sourceLabel']}
                value={values}
                onChange={change}
                p={p}
              />
            )}
            <InquiryFields
              names={['quote', 'interpretation']}
              value={values}
              onChange={change}
              p={p}
            />
            {select(
              'outcome',
              p.outcome,
              ['uncertain', 'a', 'b', 'neither'].map((value) => ({
                value,
                label: p[value as 'a'],
              })),
            )}
          </>
        ) : null}
        {kind === 'decide' ? (
          <>
            {select(
              'outcome',
              p.outcome,
              ['open', 'keep-a', 'keep-b', 'reframe'].map((value) => ({
                value,
                label: p[value as 'open'],
              })),
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{p.evidence}</legend>
              {!observations.length ? (
                <p className={note}>{p.noEvidence}</p>
              ) : (
                observations.map((o) => (
                  <label
                    key={o.id}
                    className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm leading-6"
                  >
                    <input
                      type="checkbox"
                      className="mt-1.5 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                      checked={evidenceIds.includes(o.id)}
                      onChange={(e) =>
                        change({
                          ...values,
                          evidenceIds: (e.target.checked
                            ? [...evidenceIds, o.id]
                            : evidenceIds.filter((id) => id !== o.id)
                          ).join(','),
                        })
                      }
                    />
                    <span>
                      {o.quote}
                      <span className="block text-muted-foreground">
                        {o.interpretation}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </fieldset>
            <InquiryFields
              names={
                values.outcome === 'reframe'
                  ? ['reason', 'nextQuestion']
                  : ['reason']
              }
              value={values}
              onChange={change}
              p={p}
            />
          </>
        ) : null}
        {kind === 'method-revision' ? (
          <>
            <p className={note}>{p.revisionHint}</p>
            {select('methodLinkId', p.revisionTarget, [
              { value: '', label: p.choose },
              ...linkedMethods.map((l) => ({
                value: l.id,
                label: l.method.behavior + ' · v' + (l.revisionIndex + 1),
              })),
            ])}
            {revisionBase ? (
              <div className="space-y-2 rounded-lg bg-muted/30 p-4">
                <p className="text-sm font-medium">
                  {p.approvedVersion} · v{revisionBase.revisionIndex + 1}
                </p>
                {(['behavior', 'scope', 'check'] as const).map((k) => (
                  <p key={k} className="whitespace-pre-wrap text-sm leading-6">
                    <span className="font-medium">{p[k]}: </span>
                    {revisionBase.method[k]}
                  </p>
                ))}
              </div>
            ) : null}
            <InquiryFields
              names={['reason']}
              value={values}
              onChange={change}
              p={p}
            />
          </>
        ) : null}
        {kind === 'method-draft' || kind === 'method-revision' ? (
          <InquiryFields
            names={['behavior', 'scope', 'check']}
            value={values}
            onChange={change}
            p={p}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            type="submit"
            disabled={
              kind === 'decide' &&
              values.outcome !== 'open' &&
              !evidenceIds.length
            }
          >
            {kind === 'plan'
              ? p.savePlan
              : kind === 'observe'
                ? p.saveObservation
                : kind === 'decide'
                  ? p.saveDecision
                  : kind === 'method-revision'
                    ? p.saveRevision
                    : p.saveMethod}
          </Button>
          <Button
            className="min-h-11"
            variant="ghost"
            type="button"
            onClick={close}
          >
            {p.close}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

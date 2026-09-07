'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  Inquiry,
  inquiryMethodOptions,
} from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { control, note } from './InquiryFields';
import type { InquiryCopy } from './inquiry-copy';
type Option = ReturnType<typeof inquiryMethodOptions>[number];
const keyOf = (m: Option) =>
  `${m.learningId}:${m.attemptIndex}:${m.revisionIndex}`;
export function InquiryMethods({
  q,
  p,
  disabled,
  onLink,
}: {
  q: Inquiry;
  p: InquiryCopy;
  disabled: boolean;
  onLink: (command: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState<Option[]>([]),
    [selected, setSelected] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null),
    selectRef = useRef<HTMLSelectElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const frame = q.frames.at(-1)!;
  const linked = (q.methodLinks ?? []).filter((l) => l.frameId === frame.id);
  const available = options.filter(
    (m) =>
      !linked.some(
        (l) =>
          l.learningId === m.learningId &&
          l.attemptIndex === m.attemptIndex &&
          l.revisionIndex === m.revisionIndex,
      ),
  );
  const method = available.find((m) => keyOf(m) === selected);
  const count = linked.length;
  const previousCount = useRef(count);
  useEffect(() => {
    if (previousCount.current !== count) {
      setOpen(false);
      setSelected('');
      opener.current?.focus();
    }
    previousCount.current = count;
  }, [count]);
  useEffect(() => {
    if (open && !loading && !error) selectRef.current?.focus();
  }, [open, loading, error]);
  async function load() {
    if (disabled || loading) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setOpen(true);
    setLoading(true);
    setError(false);
    setSelected('');
    try {
      const response = await fetch('/api/echo/inquiries/methods', {
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.methods)) throw Error();
      if (!abort.signal.aborted) setOptions(data.methods);
    } catch {
      if (!abort.signal.aborted) setError(true);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="font-display text-xl">{p.linkedMethods}</h2>
      <p className={note}>{p.methodHint}</p>
      {linked.map((l) => (
        <details key={l.id} className="rounded-lg border border-border px-4">
          <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {l.method.behavior} · v{l.revisionIndex + 1} ·{' '}
            {new Date(l.linkedAt).toLocaleString()}
          </summary>
          <dl className="space-y-3 pb-4">
            {(['behavior', 'scope', 'check'] as const).map((k) => (
              <div key={k}>
                <dt className="text-sm font-medium">{p[k]}</dt>
                <dd className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {l.method[k]}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      {!q.archived ? (
        <Button
          ref={opener}
          className="min-h-11"
          variant="outline"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          {p.linkMethod}
        </Button>
      ) : null}
      {open ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {loading ? (
            <p role="status" className={note}>
              {p.loading}
            </p>
          ) : error ? (
            <p role="alert" className="text-sm text-foreground">
              {p.methodLoadError}
            </p>
          ) : !available.length ? (
            <p className={note}>{p.noMethods}</p>
          ) : (
            <>
              <label className="block space-y-2 text-sm font-medium">
                <span>{p.methodSelection}</span>
                <select
                  ref={selectRef}
                  name="methodSelection"
                  className={control + ' w-full'}
                  disabled={disabled}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">{p.choose}</option>
                  {available.map((m) => (
                    <option key={keyOf(m)} value={keyOf(m)}>
                      {m.title} · v{m.revisionIndex + 1}
                    </option>
                  ))}
                </select>
              </label>
              {method ? (
                <div className="space-y-2 text-sm leading-6">
                  <p>{method.behavior}</p>
                  <p className={note}>{method.scope}</p>
                  <p>{method.check}</p>
                  <p className={note}>
                    {method.status === 'deprecated'
                      ? p.pausedMethod
                      : p.activeMethod}
                  </p>
                </div>
              ) : null}
              <Button
                className="min-h-11"
                disabled={disabled || !method}
                onClick={() => {
                  if (method && !disabled)
                    onLink({
                      action: 'link-method',
                      frameId: frame.id,
                      learningId: method.learningId,
                      attemptIndex: method.attemptIndex,
                      revisionIndex: method.revisionIndex,
                      baseHash: method.baseHash,
                    });
                }}
              >
                {p.saveLink}
              </Button>
            </>
          )}
          <Button
            className="min-h-11"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              controller.current?.abort();
              setLoading(false);
              setOpen(false);
              opener.current?.focus();
            }}
          >
            {p.close}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

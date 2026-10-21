'use client';
import { useDialogReturnFocus } from './ViewPrimitives';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { openAskModal } from '@/hooks/useAskModal';
import {
  getViewMaterials,
  ViewsApiError,
  type PersonDocument,
} from '@/lib/views/api';
import { materialLabel, type ViewsCopy, viewErrorText } from '@/lib/views/copy';
import { Field, fieldClass } from './ViewPrimitives';

export default function MeetingPanel({
  rootId,
  viewId,
  person,
  locale,
  c,
  close,
}: {
  rootId: string;
  viewId: string;
  person: PersonDocument;
  locale: string;
  c: ViewsCopy;
  close: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [selected, setSelected] = useState([
    'background',
    'followup',
    'interactions',
  ]);
  const [target, setTarget] = useState('MindOS');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    setPreview('');
    setCopied(false);
    setError('');
    sequence.current++;
  }, [person.revision, target, selected, locale]);
  const availableIds = [
    ...(person.background || person.focus ? ['background'] : []),
    ...(person.followup.text ? ['followup'] : []),
    ...(person.interactions.length ? ['interactions'] : []),
    ...(person.sources ? ['sources'] : []),
  ];
  const included = selected.filter((id) => availableIds.includes(id));
  const prepare = async () => {
    if (guard.current) return;
    const request = ++sequence.current;
    guard.current = true;
    setBusy(true);
    setError('');
    setPreview('');
    try {
      const result = await getViewMaterials(
        rootId,
        viewId,
        person,
        included,
        target.trim() || 'MindOS',
        locale,
      );
      if (mounted.current && request === sequence.current)
        setPreview(result.text);
    } catch (e) {
      if (mounted.current && request === sequence.current)
        setError(e instanceof ViewsApiError ? e.code : 'NETWORK_ERROR');
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const copy = async () => {
    if (!preview || copying) return;
    setCopying(true);
    setError('');
    setCopied(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        navigator.clipboard.writeText(preview),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 5000);
        }),
      ]);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setError('COPY_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
      if (mounted.current) setCopying(false);
    }
  };
  const download = () => {
    if (!preview) return;
    const url = URL.createObjectURL(
      new Blob([preview], { type: 'text/markdown;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meeting-preparation.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[820px]"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>
            {c.prepare} · {person.name}
          </DialogTitle>
          <DialogDescription>{c.prepareHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[240px_1fr]">
          <div className="space-y-5">
            <Field label={c.prepareTarget}>
              {(id) => (
                <input
                  id={id}
                  className={fieldClass}
                  value={target}
                  maxLength={80}
                  disabled={busy || copying}
                  onChange={(e) => setTarget(e.target.value)}
                />
              )}
            </Field>
            <fieldset disabled={busy || copying}>
              <legend className="mb-2 text-xs font-medium">
                {c.materials}
              </legend>
              {['background', 'followup', 'interactions', 'sources'].map(
                (id) => {
                  const available =
                    id === 'background'
                      ? !!(person.background || person.focus)
                      : id === 'followup'
                        ? !!person.followup.text
                        : id === 'interactions'
                          ? !!person.interactions.length
                          : !!person.sources;
                  return (
                    <label
                      key={id}
                      className={`flex min-h-11 items-center gap-2 text-sm ${available ? '' : 'text-muted-foreground'}`}
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                        checked={selected.includes(id) && available}
                        disabled={!available}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, id]
                              : prev.filter((x) => x !== id),
                          )
                        }
                      />
                      {materialLabel(id, c)}
                    </label>
                  );
                },
              )}
            </fieldset>
            <p className="text-xs leading-5 text-muted-foreground">
              {c.privateHint}
            </p>
            <Button
              variant="outline"
              disabled={busy || copying || !included.length}
              onClick={() => void prepare()}
            >
              {busy ? c.loading : c.preview}
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <textarea
              readOnly
              aria-label={c.preview}
              className={`${fieldClass} min-h-60 flex-1 font-mono text-xs leading-6`}
              value={preview}
              placeholder={c.prepareHint}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="amber"
                disabled={!preview || copying}
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check size={14} aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
                {copying ? c.copying : c.copy}
              </Button>
              <Button
                variant="outline"
                disabled={!preview || copying}
                onClick={download}
              >
                <Download size={14} aria-hidden />
                {c.download}
              </Button>
            </div>
            <Button
              variant="ghost"
              className="justify-start px-0"
              disabled={!preview || copying}
              onClick={() => {
                openAskModal(preview, 'user', null, { newSession: true });
                close();
              }}
            >
              {c.openDraft}
              <ArrowUpRight size={14} aria-hidden />
            </Button>
            <p className="text-xs text-muted-foreground">{c.openDraftHint}</p>
            {copied && (
              <p role="status" className="text-xs text-success">
                {c.copied}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-error">
                {error === 'COPY_FAILED'
                  ? c.copyFailed
                  : viewErrorText(error, c)}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

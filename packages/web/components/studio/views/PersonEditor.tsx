'use client';
import { useViewOperationScope } from '@/lib/views/hooks';
import { useDialogReturnFocus } from './ViewPrimitives';
import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  getViewPerson,
  mutateView,
  ViewsApiError,
  type PersonDocument,
} from '@/lib/views/api';
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
  type ViewDraft,
} from '@/lib/views/drafts';
import { type ViewsCopy, viewErrorText } from '@/lib/views/copy';
import { notifyFilesChanged } from '@/lib/files-changed';
import { Field, fieldClass } from './ViewPrimitives';

type EditorKind = 'new' | 'person' | 'interaction' | 'followup';
function initialValues(
  kind: EditorKind,
  p?: PersonDocument,
): ViewDraft['values'] {
  if (kind === 'new' || kind === 'person')
    return {
      name: p?.name ?? '',
      background: p?.background ?? '',
      focus: p?.focus ?? '',
    };
  if (kind === 'followup')
    return {
      text: p?.followup.text ?? '',
      date: p?.followup.date ?? '',
      completed: p?.followup.completed ?? false,
    };
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  return { text: '', date: localDate, source: '' };
}
export default function PersonEditor({
  rootId,
  viewId,
  person,
  kind,
  c,
  close,
  saved,
}: {
  rootId: string;
  viewId: string;
  person?: PersonDocument;
  kind: EditorKind;
  c: ViewsCopy;
  close: () => void;
  saved: (p: PersonDocument) => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const router = useRouter();
  const operationScope = useViewOperationScope(rootId);
  const scope = {
    rootId: operationScope.rootId,
    viewId,
    personId: person?.id ?? 'new',
    kind,
  };
  const [restored] = useState(() => readViewDraft(scope));
  const [draft, setDraft] = useState<ViewDraft>(
    () =>
      restored ?? {
        revision: person?.revision ?? '',
        operationId: crypto.randomUUID(),
        values: initialValues(kind, person),
        updatedAt: Date.now(),
      },
  );
  const [error, setError] = useState('');
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState(true);
  const [latest, setLatest] = useState<PersonDocument>();
  const guard = useRef(false);
  const title =
    kind === 'new'
      ? c.newPerson
      : kind === 'person'
        ? c.editPerson
        : kind === 'interaction'
          ? c.addInteraction
          : c.editFollowup;
  const action =
    kind === 'new' || kind === 'person'
      ? c.savePerson
      : kind === 'interaction'
        ? c.saveInteraction
        : c.saveFollowup;
  const value = (key: string) => String(draft.values[key] ?? '');
  const update = (key: string, value: string | boolean) => {
    const next = {
      ...draft,
      values: { ...draft.values, [key]: value },
      updatedAt: Date.now(),
    };
    setDraft(next);
    setStorage(writeViewDraft(scope, next));
    if (error !== 'REVISION_CONFLICT') setError('');
  };
  const discard = () => {
    clearViewDraft(scope);
    close();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (guard.current || error === 'REVISION_CONFLICT') return;
    if (!operationScope.isCurrent()) {
      setError('ROOT_CHANGED');
      return;
    }
    if ((kind === 'new' || kind === 'person') && !value('name').trim()) {
      setError('INVALID_INPUT');
      return;
    }
    if (kind === 'interaction' && (!value('text').trim() || !value('date'))) {
      setError('INVALID_INPUT');
      return;
    }
    guard.current = true;
    setBusy(true);
    setError('');
    // Persist the operation before sending; a lost response can be retried without a duplicate interaction.
    setStorage(writeViewDraft(scope, draft));
    const fields = {
      name: value('name'),
      background: value('background'),
      focus: value('focus'),
    };
    try {
      const result = await mutateView<{ person: PersonDocument }>(
        operationScope.rootId,
        {
          op:
            kind === 'new'
              ? 'person.create'
              : kind === 'person'
                ? 'person.update'
                : kind === 'interaction'
                  ? 'interaction.add'
                  : 'followup.update',
          id: viewId,
          personId: person?.id,
          path: person?.path,
          expectedRevision: draft.revision,
          operationId: draft.operationId,
          ...(kind === 'new' || kind === 'person' ? { fields } : draft.values),
        },
      );
      if (!result.person) throw new ViewsApiError('INVALID_RESPONSE');
      if (!operationScope.isCurrent()) return;
      clearViewDraft(scope);
      notifyFilesChanged([result.person.path]);
      router.refresh();
      saved(result.person);
      close();
    } catch (e) {
      if (operationScope.isCurrent())
        setError(e instanceof ViewsApiError ? e.code : 'NETWORK_ERROR');
    } finally {
      guard.current = false;
      if (operationScope.isMounted()) setBusy(false);
    }
  };
  const readLatest = async () => {
    if (!person || guard.current || !operationScope.isCurrent()) return;
    guard.current = true;
    setBusy(true);
    try {
      const result = await getViewPerson(
        operationScope.rootId,
        viewId,
        person.id,
        person.path,
      );
      if (operationScope.isCurrent()) setLatest(result.person);
    } catch (e) {
      if (operationScope.isCurrent())
        setError(e instanceof ViewsApiError ? e.code : 'NETWORK_ERROR');
    } finally {
      guard.current = false;
      if (operationScope.isMounted()) setBusy(false);
    }
  };
  const keepAfterReview = () => {
    if (!latest || guard.current || !operationScope.isCurrent()) return;
    const next = { ...draft, revision: latest.revision, updatedAt: Date.now() };
    setDraft(next);
    setStorage(writeViewDraft(scope, next));
    setError('');
    setLatest(undefined);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !guard.current) close();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={!busy}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[660px]"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {person?.name ? `${person.name} · ${c.draftHint}` : c.newPersonBody}
          </DialogDescription>
        </DialogHeader>
        <form aria-busy={busy} className="space-y-4" onSubmit={submit}>
          {restored && (
            <p role="status" className="text-xs text-muted-foreground">
              {c.draftRestored}
            </p>
          )}
          {kind === 'new' || kind === 'person' ? (
            <>
              <Field label={c.name}>
                {(id) => (
                  <input
                    autoFocus
                    id={id}
                    className={fieldClass}
                    maxLength={80}
                    required
                    aria-invalid={error === 'INVALID_INPUT' && !value('name').trim() || undefined}
                    aria-describedby={error === 'INVALID_INPUT' ? errorId : undefined}
                    disabled={busy}
                    value={value('name')}
                    onChange={(e) => update('name', e.target.value)}
                  />
                )}
              </Field>
              <Field label={c.background} hint={c.backgroundHint}>
                {(id) => (
                  <textarea
                    id={id}
                    className={fieldClass}
                    rows={4}
                    maxLength={8000}
                    disabled={busy}
                    value={value('background')}
                    onChange={(e) => update('background', e.target.value)}
                  />
                )}
              </Field>
              <Field label={c.focus}>
                {(id) => (
                  <textarea
                    id={id}
                    className={fieldClass}
                    rows={2}
                    maxLength={8000}
                    disabled={busy}
                    value={value('focus')}
                    onChange={(e) => update('focus', e.target.value)}
                  />
                )}
              </Field>
            </>
          ) : (
            <>
              <Field
                label={kind === 'interaction' ? c.interactionText : c.next}
              >
                {(id) => (
                  <textarea
                    autoFocus
                    id={id}
                    className={fieldClass}
                    rows={4}
                    required
                    aria-invalid={error === 'INVALID_INPUT' && !value('text').trim() || undefined}
                    aria-describedby={error === 'INVALID_INPUT' ? errorId : undefined}
                    maxLength={kind === 'interaction' ? 8000 : 4000}
                    disabled={busy}
                    value={value('text')}
                    onChange={(e) => update('text', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={kind === 'interaction' ? c.interactionDate : c.date}
              >
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    aria-invalid={error === 'INVALID_INPUT' && !value('date') || undefined}
                    aria-describedby={error === 'INVALID_INPUT' ? errorId : undefined}
                    className={fieldClass}
                    required
                    disabled={busy}
                    value={value('date')}
                    onChange={(e) => update('date', e.target.value)}
                  />
                )}
              </Field>
              {kind === 'interaction' ? (
                <Field label={c.sourceOptional} hint={c.sourceHint}>
                  {(id) => (
                    <input
                      id={id}
                      className={fieldClass}
                      maxLength={1000}
                      disabled={busy}
                      value={value('source')}
                      onChange={(e) => update('source', e.target.value)}
                    />
                  )}
                </Field>
              ) : (
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!draft.values.completed}
                    disabled={busy}
                    onChange={(e) => update('completed', e.target.checked)}
                    className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {c.completed}
                </label>
              )}
            </>
          )}
          {!storage && (
            <p role="status" className="text-xs text-muted-foreground">
              {c.draftUnavailable}
            </p>
          )}
          {operationScope.changed && (
            <p role="alert" className="text-sm text-error">
              {c.rootChanged}
            </p>
          )}
          {error === 'REVISION_CONFLICT' ? (
            <section
              role="alert"
              className="space-y-3 rounded-lg border border-[var(--amber)] bg-[var(--amber-subtle)] p-4"
            >
              <h3 className="font-medium">{c.conflictTitle}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {c.conflictBody}
              </p>
              {latest ? (
                <>
                  <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-background p-3 text-sm">
                    <h4 className="mb-2 font-medium">{c.currentVersion}</h4>
                    <p className="whitespace-pre-wrap break-words">
                      {kind === 'person'
                        ? [latest.name, latest.background, latest.focus].join(
                            '\n\n',
                          )
                        : kind === 'followup'
                          ? [
                              latest.followup.text,
                              latest.followup.date,
                              latest.followup.completed ? c.completed : '',
                            ].join('\n')
                          : latest.interactions
                              .slice(0, 5)
                              .map((i) => `${i.date}\n${i.text}`)
                              .join('\n\n')}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.myDraft}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={keepAfterReview}
                  >
                    {c.keepDraft}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void readLatest()}
                >
                  {c.readLatest}
                </Button>
              )}
            </section>
          ) : (
            error && (
              <p id={errorId} role="alert" className="break-words text-sm text-error">
                {viewErrorText(error, c)}
              </p>
            )
          )}
          <p role="status" className="min-h-5 text-xs text-muted-foreground">{busy ? c.saving : ''}</p>
          <DialogFooter className="sm:items-center">
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto text-muted-foreground"
              disabled={busy}
              onClick={discard}
            >
              {c.discardDraft}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              {c.close}
            </Button>
            <Button
              type="submit"
              variant="amber"
              disabled={
                busy || operationScope.changed || error === 'REVISION_CONFLICT'
              }
            >
              {busy ? c.saving : action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

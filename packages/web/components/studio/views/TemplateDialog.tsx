'use client';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { useDialogReturnFocus } from './ViewPrimitives';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FolderPlus, FolderOpen, Users, ArrowRight } from 'lucide-react';
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
  getViewPreview,
  mutateView,
  ViewsApiError,
  type ViewIndex,
  type ViewMutationResult,
} from '@/lib/views/api';
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
} from '@/lib/views/drafts';
import {
  useViewResource,
  useViewOperationScope,
  viewHref,
} from '@/lib/views/hooks';
import { viewErrorText, type ViewsCopy } from '@/lib/views/copy';
import { Field, fieldClass, ViewNotice } from './ViewPrimitives';

export default function TemplateDialog({
  index,
  c,
  close,
  navigate,
}: {
  index: ViewIndex;
  c: ViewsCopy;
  close: () => void;
  navigate?: (href: string) => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const localPush = useSmoothRouterPush();
  const push = navigate ?? localPush;
  const operationScope = useViewOperationScope(index.rootId);
  const scope = {
    rootId: operationScope.rootId,
    viewId: 'new',
    personId: '',
    kind: 'template',
  };
  const [draft] = useState(() => readViewDraft(scope));
  const [name, setName] = useState(String(draft?.values.name ?? c.defaultName));
  const [folder, setFolder] = useState(String(draft?.values.folder ?? ''));
  const [mode, setMode] = useState(
    draft?.values.mode === 'existing' ? 'existing' : 'new',
  );
  const [operationId] = useState(
    () => draft?.operationId ?? crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState(true);
  const [previewFolder, setPreviewFolder] = useState(folder);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewFolder(folder.trim()), 250);
    return () => clearTimeout(timer);
  }, [folder]);
  const read = useCallback(
    (signal: AbortSignal) =>
      getViewPreview(operationScope.rootId, previewFolder, signal),
    [operationScope.rootId, previewFolder],
  );
  const preview = useViewResource(
    read,
    mode === 'existing' && !!previewFolder && !operationScope.changed,
  );
  const matches = previewFolder === folder.trim();
  const existing = matches ? preview.data?.existingView : undefined;
  const update = (next: { name?: string; folder?: string; mode?: string }) => {
    const values = { name, folder, mode, ...next };
    if (next.name !== undefined) setName(next.name);
    if (next.folder !== undefined) setFolder(next.folder);
    if (next.mode !== undefined) setMode(next.mode);
    setError('');
    setStorage(
      writeViewDraft(scope, {
        revision: '',
        operationId,
        values,
        updatedAt: Date.now(),
      }),
    );
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!operationScope.isCurrent()) {
      setError('ROOT_CHANGED');
      return;
    }
    if (existing) {
      clearViewDraft(scope);
      push(viewHref(existing));
      close();
      return;
    }
    if (!name.trim() || !folder.trim()) {
      setError('INVALID_INPUT');
      return;
    }
    if (
      mode === 'existing' &&
      (!matches || preview.loading || preview.error || !preview.data)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await mutateView<ViewMutationResult>(
        operationScope.rootId,
        {
          op: 'create',
          template: 'people',
          name,
          folder: folder.trim(),
          mode,
          operationId,
        },
      );
      if (!result.view) throw new ViewsApiError('INVALID_RESPONSE');
      if (!operationScope.isCurrent()) return;
      clearViewDraft(scope);
      push(viewHref(result.view));
      close();
    } catch (e) {
      if (operationScope.isCurrent())
        setError(e instanceof ViewsApiError ? e.code : 'NETWORK_ERROR');
    } finally {
      inFlight.current = false;
      if (operationScope.isMounted()) setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) close();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={!busy}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[720px]"
      >
        <DialogHeader className="pr-7">
          <DialogTitle>{c.templateTitle}</DialogTitle>
          <DialogDescription>{c.templateBody}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[1fr_240px]">
            <div className="space-y-5">
              <Field label={c.viewName}>
                {(id) => (
                  <input
                    id={id}
                    autoFocus
                    className={fieldClass}
                    maxLength={80}
                    value={existing ? existing.name : name}
                    disabled={busy || !!existing || operationScope.changed}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                )}
              </Field>
              <fieldset
                disabled={busy || operationScope.changed}
                className="space-y-2"
              >
                <legend className="mb-2 text-xs font-medium">
                  {c.binding}
                </legend>
                {(['new', 'existing'] as const).map((value) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${mode === value ? 'border-[var(--amber)] bg-[var(--amber-subtle)]' : 'border-border hover:bg-muted/40'}`}
                  >
                    <input
                      type="radio"
                      name="binding"
                      checked={mode === value}
                      onChange={() => update({ mode: value })}
                      className="mt-1 accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {value === 'new' ? (
                      <FolderPlus
                        size={18}
                        aria-hidden
                        className="mt-0.5 text-muted-foreground"
                      />
                    ) : (
                      <FolderOpen
                        size={18}
                        aria-hidden
                        className="mt-0.5 text-muted-foreground"
                      />
                    )}
                    <span>
                      <span className="block text-sm font-medium">
                        {value === 'new' ? c.newFolder : c.existingFolder}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {value === 'new' ? c.newFolderHint : c.existingHint}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Field label={c.folder} hint={c.folderHelp}>
                {(id) => (
                  <>
                    <input
                      id={id}
                      list="view-folders"
                      className={fieldClass}
                      value={folder}
                      disabled={busy || operationScope.changed}
                      maxLength={240}
                      placeholder={c.folderPlaceholder}
                      onChange={(e) => update({ folder: e.target.value })}
                    />
                    <datalist id="view-folders">
                      {index.folders.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </div>
            <aside className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
                <Users size={18} aria-hidden />
              </div>
              <p className="text-xs text-muted-foreground">
                {c.previewTemplate}
              </p>
              <p className="mt-1 font-medium leading-6">{c.templateResult}</p>
              <ul className="my-4 space-y-2 text-xs text-muted-foreground">
                {[c.recordFields, c.linkedFolder, c.templateSkill].map(
                  (item) => (
                    <li key={item} className="flex gap-2">
                      <Check
                        size={13}
                        className="shrink-0 text-[var(--amber)]"
                        aria-hidden
                      />
                      {item}
                    </li>
                  ),
                )}
              </ul>
              {mode === 'new' ? (
                <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                  {c.newFolderEmpty}
                </p>
              ) : (
                <>
                  <ViewNotice
                    c={c}
                    loading={preview.loading || !matches}
                    error={matches ? preview.error : undefined}
                    retry={preview.refresh}
                  />
                  {matches && !preview.loading && preview.data && (
                    <div className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                      {existing ? (
                        <p>{c.existingAlready}</p>
                      ) : (
                        <>
                          <p>
                            {c.existingPeople} · {preview.data.personCount}
                            {preview.data.limited ? '+' : ''}
                          </p>
                          <p className="mt-1">
                            {preview.data.people
                              .map((p) => p.name)
                              .join(' · ') || c.noRecognized}
                          </p>
                        </>
                      )}
                      <p className="mt-2">
                        {preview.data.skipped || preview.data.limited
                          ? c.limited
                          : c.keptFiles}
                      </p>
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
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
          {error && !operationScope.changed && (
            <p role="alert" className="text-sm text-error">
              {viewErrorText(error, c)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              {c.cancel}
            </Button>
            <Button
              type="submit"
              variant="amber"
              disabled={
                busy ||
                operationScope.changed ||
                !folder.trim() ||
                (!existing && !name.trim()) ||
                (mode === 'existing' &&
                  (!matches ||
                    preview.loading ||
                    !!preview.error ||
                    !preview.data))
              }
            >
              {busy ? c.saving : existing ? c.openExisting : c.create}
              <ArrowRight size={14} aria-hidden />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

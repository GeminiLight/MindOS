'use client';
import { useViewOperationScope } from '@/lib/views/hooks';
import { useDialogReturnFocus } from './ViewPrimitives';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { mutateView, ViewsApiError, type ViewSummary } from '@/lib/views/api';
import { type ViewsCopy, viewErrorText } from '@/lib/views/copy';
import { Field, fieldClass, FolderCaption } from './ViewPrimitives';

export default function ManageDialog({
  view,
  rootId,
  c,
  close,
  changed,
}: {
  view: ViewSummary;
  rootId: string;
  c: ViewsCopy;
  close: () => void;
  changed: (removed: boolean) => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const operationScope = useViewOperationScope(rootId);
  const [snapshot] = useState(() => ({ ...view }));
  const [name, setName] = useState(view.name);
  const [folder, setFolder] = useState(view.folder);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const save = async (op: 'rename' | 'remove' | 'rebind') => {
    if (guard.current) return;
    if (!operationScope.isCurrent()) {
      setError('ROOT_CHANGED');
      return;
    }
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      await mutateView(operationScope.rootId, {
        op,
        id: snapshot.id,
        name,
        folder,
        expectedVersion: snapshot.version,
      });
      if (!operationScope.isCurrent()) return;
      changed(op === 'remove');
      close();
    } catch (e) {
      if (operationScope.isCurrent())
        setError(e instanceof ViewsApiError ? e.code : 'NETWORK_ERROR');
    } finally {
      guard.current = false;
      if (operationScope.isMounted()) setBusy(false);
    }
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
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{remove ? c.removeTitle : c.manageTitle}</DialogTitle>
          <DialogDescription>
            {remove ? c.removeBody : c.repairHint}
          </DialogDescription>
        </DialogHeader>
        {remove ? (
          <FolderCaption path={snapshot.folder} />
        ) : (
          <div className="space-y-5">
            <Field label={c.viewName}>
              {(id) => (
                <input
                  id={id}
                  className={fieldClass}
                  maxLength={80}
                  value={name}
                  disabled={busy || operationScope.changed}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Button
              disabled={
                busy ||
                operationScope.changed ||
                !name.trim() ||
                name.trim() === snapshot.name
              }
              variant="outline"
              onClick={() => void save('rename')}
            >
              {c.rename}
            </Button>
            <div className="space-y-3 border-t border-border pt-4">
              <Field label={c.folder}>
                {(id) => (
                  <input
                    id={id}
                    className={fieldClass}
                    maxLength={240}
                    value={folder}
                    disabled={busy || operationScope.changed}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                )}
              </Field>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !folder.trim() ||
                  (snapshot.availability === 'ready' &&
                    folder.trim() === snapshot.folder)
                }
                onClick={() => void save('rebind')}
              >
                {c.rebind}
              </Button>
            </div>
            <div className="border-t border-border pt-4">
              <Button
                variant="ghost"
                className="text-error"
                disabled={busy || operationScope.changed}
                onClick={() => setRemove(true)}
              >
                {c.remove}
              </Button>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {c.removeBody}
              </p>
            </div>
          </div>
        )}
        {operationScope.changed && (
          <p role="alert" className="text-sm text-error">
            {c.rootChanged}
          </p>
        )}
        {error && !operationScope.changed && (
          <p role="alert" className="text-sm text-error">
            {viewErrorText(error, c)}
            {error === 'VIEW_CONFLICT' && (
              <Button
                variant="outline"
                className="ml-2"
                onClick={() => {
                  changed(false);
                  close();
                }}
              >
                {c.readLatest}
              </Button>
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={
              operationScope.changed
                ? close
                : remove
                  ? () => setRemove(false)
                  : close
            }
          >
            {remove ? c.cancel : c.close}
          </Button>
          {remove && (
            <Button
              variant="destructive"
              disabled={busy || operationScope.changed}
              onClick={() => void save('remove')}
            >
              {busy ? c.saving : c.remove}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

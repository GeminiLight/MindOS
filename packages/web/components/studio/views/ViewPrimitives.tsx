'use client';
import { type ReactNode, useId, useState, useCallback } from 'react';
import { AlertCircle, Loader2, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ViewsCopy } from '@/lib/views/copy';
import { viewErrorText } from '@/lib/views/copy';
/** Controlled dialogs mount after the invoking action. Capture it before input autofocus. */
export function useDialogReturnFocus() {
  const [origin] = useState(() =>
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const [heading] = useState(
    () =>
      origin
        ?.closest('[data-content-page-shell="studio"]')
        ?.querySelector<HTMLElement>('h1') ?? null,
  );
  return useCallback(
    () =>
      origin?.isConnected ? origin : heading?.isConnected ? heading : true,
    [origin, heading],
  );
}
export const fieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      {children(id)}
      {hint && (
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
export function ViewNotice({
  error,
  loading,
  retry,
  c,
}: {
  error?: string;
  loading?: boolean;
  retry?: () => void;
  c: ViewsCopy;
}) {
  if (loading)
    return (
      <div
        role="status"
        className="flex items-center gap-2 py-10 text-sm text-muted-foreground"
      >
        <Loader2 size={16} className="animate-spin" aria-hidden />
        {c.loading}
      </div>
    );
  if (!error) return null;
  return (
    <div
      role="alert"
      className="my-4 rounded-lg border border-border bg-muted/20 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          size={18}
          className="mt-0.5 shrink-0 text-error"
          aria-hidden
        />
        <div>
          <p className="font-medium">{c.errorTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewErrorText(error, c)}
          </p>
          {retry && (
            <Button variant="outline" className="mt-3" onClick={retry}>
              {c.retry}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
export function FolderCaption({ path }: { path: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Folder size={13} className="shrink-0" aria-hidden />
      <span className="truncate" title={path}>
        {path}
      </span>
    </span>
  );
}

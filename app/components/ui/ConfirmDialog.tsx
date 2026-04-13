'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
}

type ResolveFn = (confirmed: boolean) => void;

/**
 * Hook that provides a confirm() replacement using the design system Dialog.
 *
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirmDialog();
 *   // ... in handler:
 *   const ok = await confirm({ title: 'Delete?', variant: 'destructive' });
 *   if (!ok) return;
 *   // ... in JSX:
 *   return <>{ConfirmDialog} ... </>;
 */
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: '' });
  const resolveRef = useRef<ResolveFn | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleClose = useCallback((confirmed: boolean) => {
    setOpen(false);
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
  }, []);

  // Stable JSX element (not a component) to avoid remount on state changes.
  const confirmDialog = (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(false); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.description && (
            <DialogDescription>{options.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={options.variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => handleClose(true)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog: confirmDialog };
}

/**
 * Global toast notification store.
 * Uses module-level state + useSyncExternalStore (no Context/Provider needed).
 *
 * Usage:
 *   import { toast } from '@/lib/toast';
 *   toast.success('Saved!');
 *   toast.error('Something went wrong');
 *   toast.copy();           // "Copied" with check icon
 *   toast('Custom message'); // info type
 */

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
  action?: { label: string; onClick: () => void };
}

type ToastInput = { message: string; type?: Toast['type']; duration?: number; action?: Toast['action'] };

const DEFAULT_DURATION = 2000;
const MAX_TOASTS = 3;

let toasts: Toast[] = [];
let listeners: Array<() => void> = [];
let nextId = 0;

function emit() {
  for (const fn of listeners) fn();
}

export function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

export function getSnapshot(): Toast[] {
  return toasts;
}

export function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function addToast(input: ToastInput) {
  const id = `toast-${++nextId}`;
  const t: Toast = {
    id,
    message: input.message,
    type: input.type ?? 'info',
    duration: input.duration ?? DEFAULT_DURATION,
    action: input.action,
  };
  toasts = [...toasts, t].slice(-MAX_TOASTS);
  emit();
  if (t.duration > 0) {
    setTimeout(() => dismiss(id), t.duration);
  }
}

/** Show an info toast */
function toast(message: string, opts?: { type?: Toast['type']; duration?: number }) {
  addToast({ message, ...opts });
}

/** Show a success toast */
toast.success = (message: string, duration?: number) =>
  addToast({ message, type: 'success', duration });

/** Show a toast with an undo action (5 second default) */
toast.undo = (message: string, onUndo: () => void, opts?: { duration?: number; label?: string }) =>
  addToast({ message, type: 'info', duration: opts?.duration ?? 5000, action: { label: opts?.label ?? 'Undo', onClick: onUndo } });

/** Show an error toast */
toast.error = (message: string, duration?: number) =>
  addToast({ message, type: 'error', duration });

/** Show a "Copied" success toast */
toast.copy = (message = 'Copied') =>
  addToast({ message, type: 'success', duration: 1500 });

export { toast };

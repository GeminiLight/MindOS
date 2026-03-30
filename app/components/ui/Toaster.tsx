'use client';

import { useSyncExternalStore } from 'react';
import { Check, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, getSnapshot, dismiss, type Toast } from '@/lib/toast';

const icons: Record<Toast['type'], React.ReactNode> = {
  success: <Check size={15} className="text-success shrink-0" />,
  error: <AlertCircle size={15} className="text-error shrink-0" />,
  info: <Info size={15} className="text-muted-foreground shrink-0" />,
};

export default function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2.5 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 min-w-[180px] max-w-[320px] animate-in slide-in-from-right-4 fade-in duration-200"
        >
          {icons[t.type]}
          <span className="text-sm text-foreground flex-1 truncate">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

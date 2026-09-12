'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/** Keep desktop's side-by-side preview; narrow screens open one readable detail. */
export function ResponsiveInboxDetails({ selectedPath, backLabel, onBack, children }: {
  selectedPath: string | null;
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!selectedPath || !window.matchMedia?.('(max-width: 1279px)').matches) return;
    backRef.current?.focus({ preventScroll: true });
    backRef.current?.scrollIntoView({ block: 'start' });
  }, [selectedPath]);
  return (
    <aside className={`${selectedPath ? '' : 'hidden xl:block'} min-w-0 xl:sticky xl:top-6 xl:self-start`}>
      {selectedPath && <button ref={backRef} type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden">
        <ArrowLeft size={15} aria-hidden />{backLabel}
      </button>}
      {children}
    </aside>
  );
}

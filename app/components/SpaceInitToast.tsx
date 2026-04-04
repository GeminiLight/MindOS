'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { Sparkles, Check, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { revertSpaceInitAction } from '@/lib/actions';

type InitState = 'working' | 'done' | 'reverted' | 'error';

interface InitInfo {
  spaceName: string;
  spacePath: string;
  description: string;
  state: InitState;
}

/**
 * Global toast that shows AI initialization progress when a new space is created.
 * Mounted in SidebarLayout so it persists across route transitions.
 *
 * States:
 *  - working: ✨ progress animation
 *  - done:    ✓ ready + [Review] [Discard] [×] — persists until user acts
 *  - reverted: ↩ "reverted to template" — auto-dismiss 2s
 *  - error:   silent dismiss
 */
export default function SpaceInitToast() {
  const [info, setInfo] = useState<InitInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const [reverting, startRevert] = useTransition();
  const router = useRouter();
  const { t } = useLocale();

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => setInfo(null), 200);
  }, []);

  const handleEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as Partial<InitInfo>;
    if (detail.state === 'working') {
      setInfo(detail as InitInfo);
      requestAnimationFrame(() => setVisible(true));
    } else if (detail.state === 'done') {
      setInfo((prev) => prev ? { ...prev, state: 'done' } : null);
      router.refresh();
    } else {
      dismiss();
    }
  }, [router, dismiss]);

  useEffect(() => {
    window.addEventListener('mindos:ai-init', handleEvent);
    return () => window.removeEventListener('mindos:ai-init', handleEvent);
  }, [handleEvent]);

  const handleReview = useCallback(() => {
    if (!info) return;
    dismiss();
    router.push(`/view/${encodePath(info.spacePath + '/')}`);
  }, [info, dismiss, router]);

  const handleDiscard = useCallback(() => {
    if (!info) return;
    startRevert(async () => {
      await revertSpaceInitAction(info.spacePath, info.spaceName, info.description);
      setInfo((prev) => prev ? { ...prev, state: 'reverted' } : null);
      router.refresh();
      window.dispatchEvent(new Event('mindos:files-changed'));
      setTimeout(dismiss, 2000);
    });
  }, [info, router, dismiss]);

  const handleAccept = useCallback(() => {
    dismiss();
  }, [dismiss]);

  if (!info) return null;

  const h = t.home;
  const { state } = info;
  const isDone = state === 'done';
  const isReverted = state === 'reverted';
  const isWorking = state === 'working';

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-all duration-200 ease-out ${
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-3 scale-[0.96] pointer-events-none'
      }`}
    >
      <div
        className="flex items-center gap-2.5 rounded-full border bg-card/95 backdrop-blur py-2 shadow-lg"
        style={{
          borderColor: 'color-mix(in srgb, var(--amber) 40%, var(--border))',
          boxShadow: '0 8px 24px color-mix(in srgb, var(--amber) 12%, rgba(0,0,0,.2))',
          paddingLeft: '0.75rem',
          paddingRight: isDone ? '0.5rem' : '1rem',
        }}
      >
        {/* Icon */}
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full shrink-0 ${
            isReverted
              ? 'text-muted-foreground bg-muted'
              : 'text-[var(--amber)] bg-[var(--amber-subtle)]'
          } ${isWorking ? 'animate-pulse' : ''}`}
        >
          {isReverted ? <Undo2 size={12} /> : isDone ? <Check size={13} strokeWidth={2.5} /> : <Sparkles size={13} />}
        </span>

        {/* Text */}
        <span className="text-xs text-foreground whitespace-nowrap select-none font-medium">
          {isReverted
            ? h.aiInitReverted(info.spaceName)
            : isDone
              ? h.aiInitReady(info.spaceName)
              : <>{h.aiInitGenerating(info.spaceName)}<DotPulse /></>
          }
        </span>

        {/* Action buttons — only in done state */}
        {isDone && (
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={handleReview}
              className="px-2.5 py-1 rounded-full text-2xs font-medium bg-[var(--amber)] text-white hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-ring"
            >
              {h.aiInitReview}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={reverting}
              className="px-2.5 py-1 rounded-full text-2xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {h.aiInitDiscard}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              aria-label="Accept"
              className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DotPulse() {
  return (
    <span className="inline-flex gap-[2px] items-end h-[1em] ml-px">
      <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground animate-[dotBounce_1.2s_0ms_infinite]" />
      <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground animate-[dotBounce_1.2s_200ms_infinite]" />
      <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground animate-[dotBounce_1.2s_400ms_infinite]" />
      <style>{`
        @keyframes dotBounce {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </span>
  );
}

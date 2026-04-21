'use client';

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

export interface UseComposerVerticalResizeOptions {
  minHeight: number;
  maxHeightAbs: number;
  maxHeightViewportRatio: number;
  getHeight: () => number;
  setHeight: (h: number) => void;
  persist: (h: number) => void;
}

/**
 * Drag the top edge of a composer upward to grow height (panel input UX).
 * Uses pointer capture so drag ends reliably (window exit, touch, pointercancel).
 */
export function useComposerVerticalResize({
  minHeight,
  maxHeightAbs,
  maxHeightViewportRatio,
  getHeight,
  setHeight,
  persist,
}: UseComposerVerticalResizeOptions) {
  // Track active listeners for cleanup on unmount
  const activeListenersRef = useRef<{
    el: HTMLElement;
    onMove: (ev: PointerEvent) => void;
    onUpOrCancel: (ev: PointerEvent) => void;
  } | null>(null);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      const active = activeListenersRef.current;
      if (active) {
        active.el.removeEventListener('pointermove', active.onMove);
        active.el.removeEventListener('pointerup', active.onUpOrCancel);
        active.el.removeEventListener('pointercancel', active.onUpOrCancel);
        document.body.classList.remove('select-none');
        document.body.style.cursor = '';
        activeListenersRef.current = null;
      }
    };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      const pointerId = e.pointerId;
      const startY = e.clientY;
      const startH = getHeight();
      let currentH = startH;

      const maxH = () => Math.min(maxHeightAbs, Math.floor(window.innerHeight * maxHeightViewportRatio));

      document.body.classList.add('select-none');
      document.body.style.cursor = 'ns-resize';

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dy = startY - ev.clientY;
        const next = Math.round(Math.max(minHeight, Math.min(maxH(), startH + dy)));
        currentH = next;
        setHeight(next);
      };

      const onUpOrCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.body.classList.remove('select-none');
        document.body.style.cursor = '';
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUpOrCancel);
        el.removeEventListener('pointercancel', onUpOrCancel);
        activeListenersRef.current = null;
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        persist(currentH);
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUpOrCancel);
      el.addEventListener('pointercancel', onUpOrCancel);

      // Track listeners for cleanup on unmount
      activeListenersRef.current = { el, onMove, onUpOrCancel };
    },
    [minHeight, maxHeightAbs, maxHeightViewportRatio, getHeight, setHeight, persist],
  );

  return onPointerDown;
}

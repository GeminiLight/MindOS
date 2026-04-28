'use client';

import { useCallback, useRef } from 'react';

export interface UseResizeDragOptions {
  /** Current width */
  width: number;
  /** Min allowed width */
  minWidth: number;
  /** Max allowed width (absolute) */
  maxWidth: number;
  /** Max width as ratio of viewport */
  maxWidthRatio: number;
  /** 'right' = right-edge drag (mouse right → wider), 'left' = left-edge drag (mouse left → wider) */
  direction: 'right' | 'left';
  /** Skip if true (e.g. maximized state) */
  disabled?: boolean;
  /** Called on every mousemove with new width */
  onResize: (width: number) => void;
  /** Called on mouseup with final width */
  onResizeEnd: (width: number) => void;
}

/**
 * Shared drag-resize logic for panel edges.
 * Returns a mousedown handler for the resize handle element.
 */
export function useResizeDrag({
  width,
  minWidth,
  maxWidth,
  maxWidthRatio,
  direction,
  disabled,
  onResize,
  onResizeEnd,
}: UseResizeDragOptions) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const latestWidthRef = useRef(width);
  latestWidthRef.current = width;

  // Use refs for callbacks to avoid stale closures in mousemove/mouseup
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    document.body.classList.add('select-none');
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = direction === 'right'
        ? ev.clientX - startX.current
        : startX.current - ev.clientX;
      const maxW = Math.min(maxWidth, window.innerWidth * maxWidthRatio);
      const newWidth = Math.round(Math.max(minWidth, Math.min(maxW, startWidth.current + delta)));
      onResizeRef.current(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.classList.remove('select-none');
      document.body.style.cursor = '';
      onResizeEndRef.current(latestWidthRef.current);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, minWidth, maxWidth, maxWidthRatio, direction, disabled]);

  return handleMouseDown;
}

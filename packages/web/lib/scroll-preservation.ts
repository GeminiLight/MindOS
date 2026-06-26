import { getMainScrollPosition, scrollMainTo } from '@/lib/main-scroll-container';

type ScrollRefresh = () => void;

function restoreDocumentScroll(snapshot: { href: string; x: number; y: number }): void {
  if (window.location.href !== snapshot.href) return;
  const current = getMainScrollPosition();
  if (Math.abs(current.x - snapshot.x) <= 1 && Math.abs(current.y - snapshot.y) <= 1) return;
  scrollMainTo(snapshot.x, snapshot.y);
}

function scheduleScrollRestore(snapshot: { href: string; x: number; y: number }): void {
  const raf = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16);

  let frames = 0;
  const restoreOnFrame = () => {
    frames += 1;
    restoreDocumentScroll(snapshot);
    if (frames < 4) raf(restoreOnFrame);
  };

  raf(restoreOnFrame);
  window.setTimeout(() => restoreDocumentScroll(snapshot), 120);
  window.setTimeout(() => restoreDocumentScroll(snapshot), 360);
}

export function refreshPreservingDocumentScroll(refresh: ScrollRefresh): void {
  if (typeof window === 'undefined') {
    refresh();
    return;
  }

  const snapshot = {
    href: window.location.href,
    ...getMainScrollPosition(),
  };

  refresh();

  if (snapshot.x === 0 && snapshot.y === 0) return;
  scheduleScrollRestore(snapshot);
}

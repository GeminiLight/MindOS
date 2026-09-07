'use client';
import { useEffect } from 'react';

const BEFORE_LEARNING_NAVIGATION = 'echo-learning-before-navigation';
export function requestLearningNavigation() {
  return window.dispatchEvent(new Event(BEFORE_LEARNING_NAVIGATION, { cancelable: true }));
}

/** Protects the personal form without storing private answers in browser storage. */
export function useLearningDraftGuard(dirty: boolean, busy: boolean, message: string) {
  const allowDiscard = () => !busy && (!dirty || window.confirm(message));
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const selection = (event: Event) => {
      if (busy || dirty && !window.confirm(message)) event.preventDefault();
    };
    const link = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (busy || dirty && !window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener(BEFORE_LEARNING_NAVIGATION, selection);
    document.addEventListener('click', link, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener(BEFORE_LEARNING_NAVIGATION, selection);
      document.removeEventListener('click', link, true);
    };
  }, [dirty, busy, message]);
  return allowDiscard;
}

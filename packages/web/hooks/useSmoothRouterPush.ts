'use client';

import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type SmoothPushOptions = { scroll?: boolean };

type MouseNavigationEvent = {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export function shouldHandleSmoothNavigation(event: MouseNavigationEvent): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

/**
 * Defers route work to the next frame and runs it in a transition. This lets
 * pressed/active UI state paint before Next starts rendering the destination.
 */
function useRouterOrNull() {
  try {
    return useRouter();
  } catch {
    // Static render tests and non-Next hosts can render client components
    // without an app-router context. Clicks still get a browser fallback.
    return null;
  }
}

export function useSmoothRouterPush(): (href: string, options?: SmoothPushOptions) => void {
  const router = useRouterOrNull();
  const [, startTransition] = useTransition();
  const frameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return useCallback((href: string, options?: SmoothPushOptions) => {
    const run = () => {
      startTransition(() => {
        if (router) {
          if (options) router.push(href, options);
          else router.push(href);
        } else if (typeof window !== 'undefined') {
          window.location.assign(href);
        }
      });
    };

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      run();
      return;
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      run();
    });
  }, [router, startTransition]);
}

'use client';

import { create } from 'zustand';
import { walkthroughSteps } from '@/components/walkthrough/steps';

/* ── Types ── */

export type WalkthroughStatus = 'idle' | 'active' | 'completed' | 'dismissed';

export interface WalkthroughStoreState {
  status: WalkthroughStatus;
  currentStep: number;
  totalSteps: number;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  /** Called once to load from backend + attach URL param check. Returns cleanup. */
  _init: () => () => void;
}

/* ── Helpers ── */

function persistStep(step: number, dismissed: boolean) {
  fetch('/api/setup', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guideState: { walkthroughStep: step, walkthroughDismissed: dismissed },
    }),
  }).catch((err) => { console.warn('[walkthrough-store] persist failed:', err); });
}

/* ── Store ── */

export const useWalkthroughStore = create<WalkthroughStoreState>((set, get) => {
  const totalSteps = walkthroughSteps.length;

  return {
    status: 'idle',
    currentStep: 0,
    totalSteps,

    start: () => {
      set({ currentStep: 0, status: 'active' });
      persistStep(0, false);
    },

    next: () => {
      const nextStep = get().currentStep + 1;
      if (nextStep >= totalSteps) {
        set({ status: 'completed' });
        persistStep(totalSteps, false);
      } else {
        set({ currentStep: nextStep });
        persistStep(nextStep, false);
      }
    },

    back: () => {
      const cur = get().currentStep;
      if (cur > 0) {
        set({ currentStep: cur - 1 });
        persistStep(cur - 1, false);
      }
    },

    skip: () => {
      set({ status: 'dismissed' });
      persistStep(get().currentStep, true);
    },

    _init: () => {
      // Handle ?welcome=1 URL param
      const params = new URLSearchParams(window.location.search);
      const isWelcome = params.get('welcome') === '1';
      if (isWelcome) {
        const url = new URL(window.location.href);
        url.searchParams.delete('welcome');
        window.history.replaceState({}, '', url.pathname + (url.search || ''));
        window.dispatchEvent(new Event('mindos:first-visit'));
      }

      // Only auto-start on desktop
      if (window.innerWidth < 768) return () => {};

      fetch('/api/setup')
        .then(r => r.json())
        .then(data => {
          const gs = data.guideState;
          if (!gs) return;
          if (gs.walkthroughDismissed) return;

          if (gs.active && !gs.dismissed && gs.walkthroughStep === undefined) {
            if (isWelcome) {
              set({ status: 'active', currentStep: 0 });
            }
          } else if (
            typeof gs.walkthroughStep === 'number' &&
            gs.walkthroughStep >= 0 &&
            gs.walkthroughStep < totalSteps &&
            !gs.walkthroughDismissed
          ) {
            set({ status: 'active', currentStep: gs.walkthroughStep });
          }
        })
        .catch((err) => { console.warn('[walkthrough-store] guideState read failed:', err); });

      return () => {};
    },
  };
});

/* ── Backward-compatible hook ── */

export function useWalkthrough(): WalkthroughStoreState {
  return useWalkthroughStore();
}

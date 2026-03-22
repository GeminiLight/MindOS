'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { walkthroughSteps } from './steps';
import WalkthroughOverlay from './WalkthroughOverlay';

type WalkthroughStatus = 'idle' | 'active' | 'completed' | 'dismissed';

interface WalkthroughContextValue {
  status: WalkthroughStatus;
  currentStep: number;
  totalSteps: number;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}

interface WalkthroughProviderProps {
  children: ReactNode;
}

export default function WalkthroughProvider({ children }: WalkthroughProviderProps) {
  const [status, setStatus] = useState<WalkthroughStatus>('idle');
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = walkthroughSteps.length;

  // Persist to backend
  const persistStep = useCallback((step: number, dismissed: boolean) => {
    fetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guideState: {
          walkthroughStep: step,
          walkthroughDismissed: dismissed,
        },
      }),
    }).catch(() => {});
  }, []);

  // Check for auto-start via ?welcome=1 or guideState
  useEffect(() => {
    // Handle ?welcome=1 URL param — single owner, clean up immediately
    const params = new URLSearchParams(window.location.search);
    const isWelcome = params.get('welcome') === '1';
    if (isWelcome) {
      const url = new URL(window.location.href);
      url.searchParams.delete('welcome');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
      // Notify GuideCard about first visit
      window.dispatchEvent(new Event('mindos:first-visit'));
    }

    // Only auto-start walkthrough on desktop
    if (window.innerWidth < 768) return;

    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        const gs = data.guideState;
        if (!gs) return;
        // Already dismissed or completed
        if (gs.walkthroughDismissed) return;
        // Check if walkthrough should start
        if (gs.active && !gs.dismissed && gs.walkthroughStep === undefined) {
          // First time — only start if ?welcome=1 was present
          if (isWelcome) {
            setStatus('active');
            setCurrentStep(0);
          }
        } else if (typeof gs.walkthroughStep === 'number' && gs.walkthroughStep >= 0 && gs.walkthroughStep < totalSteps && !gs.walkthroughDismissed) {
          // Resume walkthrough
          setStatus('active');
          setCurrentStep(gs.walkthroughStep);
        }
      })
      .catch(() => {});
  }, [totalSteps]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setStatus('active');
    persistStep(0, false);
  }, [persistStep]);

  const next = useCallback(() => {
    const nextStep = currentStep + 1;
    if (nextStep >= totalSteps) {
      setStatus('completed');
      persistStep(totalSteps, false);
    } else {
      setCurrentStep(nextStep);
      persistStep(nextStep, false);
    }
  }, [currentStep, totalSteps, persistStep]);

  const back = useCallback(() => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      persistStep(prevStep, false);
    }
  }, [currentStep, persistStep]);

  const skip = useCallback(() => {
    setStatus('dismissed');
    persistStep(currentStep, true);
  }, [currentStep, persistStep]);

  const value: WalkthroughContextValue = {
    status,
    currentStep,
    totalSteps,
    start,
    next,
    back,
    skip,
  };

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      {status === 'active' && <WalkthroughOverlay />}
    </WalkthroughContext.Provider>
  );
}

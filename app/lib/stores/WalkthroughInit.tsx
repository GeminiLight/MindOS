'use client';

import { useEffect } from 'react';
import { useWalkthroughStore } from '@/lib/stores/walkthrough-store';
import WalkthroughOverlay from '@/components/walkthrough/WalkthroughOverlay';

/**
 * Initializes walkthrough store and conditionally renders the overlay.
 * Replaces the old <WalkthroughProvider> wrapper.
 */
export default function WalkthroughInit() {
  useEffect(() => {
    const cleanup = useWalkthroughStore.getState()._init();
    return cleanup;
  }, []);

  const status = useWalkthroughStore(s => s.status);

  return status === 'active' ? <WalkthroughOverlay /> : null;
}

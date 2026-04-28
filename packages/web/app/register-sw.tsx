'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    // Electron embedded Chromium: SW can leave the UI blank or stall hydration; skip.
    if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) {
      return;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
    }
  }, []);

  return null;
}

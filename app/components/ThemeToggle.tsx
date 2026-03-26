'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const dark = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('mindos-theme-change', listener);
      return () => window.removeEventListener('mindos-theme-change', listener);
    },
    () => {
      const stored = localStorage.getItem('theme');
      return stored && stored !== 'system' ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    () => document.documentElement.classList.contains('dark'),
  );

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    window.dispatchEvent(new Event('mindos-theme-change'));
  };

  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

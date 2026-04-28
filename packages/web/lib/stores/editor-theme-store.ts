'use client';

import { create } from 'zustand';

export type EditorTheme = 'system' | 'crepe' | 'crepe-dark' | 'nord' | 'nord-dark' | 'frame' | 'frame-dark';

export const EDITOR_THEMES: { id: EditorTheme; label: string; description: string }[] = [
  { id: 'system',     label: 'System',     description: 'Match app colors' },
  { id: 'crepe',      label: 'Crepe',      description: 'Warm parchment' },
  { id: 'crepe-dark', label: 'Crepe Dark', description: 'Warm dark' },
  { id: 'nord',       label: 'Nord',       description: 'Cool blue' },
  { id: 'nord-dark',  label: 'Nord Dark',  description: 'Arctic night' },
  { id: 'frame',      label: 'Frame',      description: 'Clean minimal' },
  { id: 'frame-dark', label: 'Frame Dark', description: 'Dark minimal' },
];

const STORAGE_KEY = 'editor-theme';

function getStoredTheme(): EditorTheme {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  if (EDITOR_THEMES.some(t => t.id === v)) return v as EditorTheme;
  return 'system';
}

interface EditorThemeStore {
  theme: EditorTheme;
  setTheme: (t: EditorTheme) => void;
}

export const useEditorTheme = create<EditorThemeStore>((set) => ({
  theme: getStoredTheme(),
  setTheme: (t) => {
    localStorage.setItem(STORAGE_KEY, t);
    set({ theme: t });
  },
}));

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkillInfo } from '@/components/settings/types';

export interface SlashItem {
  type: 'skill';
  name: string;
  description: string;
}

function safeFetchSkills(): Promise<SkillInfo[]> {
  return fetch('/api/skills')
    .then((r) => (r.ok ? r.json() : { skills: [] }))
    .then((data) => (Array.isArray(data?.skills) ? data.skills : []))
    .catch(() => [] as SkillInfo[]);
}

export function useSlashCommand() {
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashResults, setSlashResults] = useState<SlashItem[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const loaded = useRef(false);

  const loadSkills = useCallback(async () => {
    const skills = await safeFetchSkills();
    setAllSkills(skills.filter((s) => s.enabled));
    loaded.current = true;
  }, []);

  useEffect(() => {
    loadSkills();
    const handler = () => loadSkills();
    window.addEventListener('mindos:skills-changed', handler);
    return () => window.removeEventListener('mindos:skills-changed', handler);
  }, [loadSkills]);

  const updateSlashFromInput = useCallback(
    (val: string, cursorPos: number) => {
      const before = val.slice(0, cursorPos);
      const slashIdx = before.lastIndexOf('/');

      if (slashIdx === -1) {
        setSlashQuery(null);
        return;
      }

      // `/` must be at line start or preceded by whitespace
      if (slashIdx > 0 && before[slashIdx - 1] !== ' ' && before[slashIdx - 1] !== '\n') {
        setSlashQuery(null);
        return;
      }

      // No space in the typed query — slash commands are single tokens
      const query = before.slice(slashIdx + 1);
      if (query.includes(' ')) {
        setSlashQuery(null);
        return;
      }

      if (!loaded.current) {
        loadSkills();
        setSlashQuery(null);
        return;
      }

      const q = query.toLowerCase();
      const items: SlashItem[] = allSkills
        .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
        .slice(0, 20)
        .map((s) => ({ type: 'skill', name: s.name, description: s.description }));

      if (items.length === 0) {
        setSlashQuery(null);
        setSlashResults([]);
        setSlashIndex(0);
        return;
      }

      setSlashQuery(query);
      setSlashResults(items);
      setSlashIndex(0);
    },
    [allSkills, loadSkills],
  );

  const navigateSlash = useCallback(
    (direction: 'up' | 'down') => {
      if (slashResults.length === 0) return;
      if (direction === 'down') {
        setSlashIndex((i) => Math.min(i + 1, slashResults.length - 1));
      } else {
        setSlashIndex((i) => Math.max(i - 1, 0));
      }
    },
    [slashResults.length],
  );

  const resetSlash = useCallback(() => {
    setSlashQuery(null);
    setSlashResults([]);
    setSlashIndex(0);
  }, []);

  return {
    slashQuery,
    slashResults,
    slashIndex,
    updateSlashFromInput,
    navigateSlash,
    resetSlash,
  };
}

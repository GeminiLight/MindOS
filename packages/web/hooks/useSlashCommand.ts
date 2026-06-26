'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkillInfo } from '@/components/settings/types';
import type { AcpAvailableCommand } from '@/lib/types';

export type SlashItem =
  | SkillSlashItem
  | RuntimeCommandSlashItem;

export interface SkillSlashItem {
  type: 'skill';
  name: string;
  description: string;
}

export interface RuntimeCommandSlashItem {
  type: 'runtime-command';
  name: string;
  description: string;
}

interface UseSlashCommandOptions {
  runtimeCommands?: AcpAvailableCommand[];
}

function safeFetchSkills(): Promise<SkillInfo[]> {
  return fetch('/api/skills')
    .then((r) => (r.ok ? r.json() : { skills: [] }))
    .then((data) => (Array.isArray(data?.skills) ? data.skills : []))
    .catch(() => [] as SkillInfo[]);
}

export function useSlashCommand(options: UseSlashCommandOptions = {}) {
  const runtimeCommands = options.runtimeCommands ?? [];
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
      const runtimeItems = runtimeCommands
        .map((command) => ({
          name: command.name.trim().replace(/^\//, ''),
          description: command.description?.trim() || 'Runtime command',
        }))
        .filter((command) => command.name)
        .map((command) => {
          const nl = command.name.toLowerCase();
          const dl = command.description.toLowerCase();
          let score = 0;
          if (!q) score = 80;
          else if (nl.startsWith(q)) score = 120;
          else if (nl.includes(q)) score = 70;
          else if (dl.includes(q)) score = 15;
          return { command, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((item): RuntimeCommandSlashItem => ({
          type: 'runtime-command',
          name: item.command.name,
          description: item.command.description,
        }));
      const items: SlashItem[] = (q
        ? allSkills
            .map((s) => {
              const nl = s.name.toLowerCase();
              let score = 0;
              if (nl.startsWith(q)) score = 100;
              else if (nl.includes(q)) score = 50;
              else if (s.description.toLowerCase().includes(q)) score = 10;
              return { s, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
            .map((x) => ({ type: 'skill' as const, name: x.s.name, description: x.s.description }))
        : allSkills
            .slice(0, 20)
            .map((s) => ({ type: 'skill' as const, name: s.name, description: s.description }))
      );
      const mergedItems = [...runtimeItems, ...items].slice(0, 20);

      if (mergedItems.length === 0) {
        setSlashQuery(null);
        setSlashResults([]);
        setSlashIndex(0);
        return;
      }

      setSlashQuery(query);
      setSlashResults(mergedItems);
      setSlashIndex(0);
    },
    [allSkills, loadSkills, runtimeCommands],
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

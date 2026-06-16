'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RotateCcw, Save, SearchX } from 'lucide-react';
import type { KnowledgeTabProps } from './types';
import { SettingCard } from './Primitives';
import { saveSettingsPatch } from './settings-save';

const DEFAULT_PREVIEW_RULES = ['node_modules', '.git', 'dist', '.next', '.mindos'];

function normalizeRule(input: string): string | null {
  let value = input.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!value || value.startsWith('#') || value.startsWith('!')) return null;
  value = value.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!value || value === '.' || value === '..') return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

function normalizeRules(input: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input ?? []) {
    const rule = normalizeRule(item);
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    result.push(rule);
  }
  return result;
}

function parseDraft(draft: string): string[] {
  return normalizeRules(draft.split(/\r?\n/));
}

export function SearchIgnoredPathsSection({ data, setData, t }: KnowledgeTabProps) {
  const k = t.settings.knowledge;
  const currentRules = useMemo(() => normalizeRules(data.searchIgnoredPaths), [data.searchIgnoredPaths]);
  const currentText = currentRules.join('\n');
  const [draft, setDraft] = useState(currentText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dirty) return;
    setDraft(currentText);
  }, [currentText, dirty]);

  const parsedRules = useMemo(() => parseDraft(draft), [draft]);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await saveSettingsPatch({ searchIgnoredPaths: parsedRules });
      setData((prev) => prev ? { ...prev, searchIgnoredPaths: parsedRules } : prev);
      setDraft(parsedRules.join('\n'));
      setDirty(false);
      setSaved(true);
      window.dispatchEvent(new Event('mindos:settings-changed'));
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : ((k.searchIgnoredSaveFailed as string) ?? 'Failed to save ignored paths'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingCard
      icon={<SearchX size={15} />}
      title={(k.searchIgnoredTitle as string) ?? 'Search Ignored Paths'}
      description={(k.searchIgnoredDesc as string) ?? 'Exclude noisy local folders from file tree, search, semantic index, and agent context.'}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_PREVIEW_RULES.map((rule) => (
            <span
              key={rule}
              className="rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
            >
              {rule}
            </span>
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="search-ignored-paths" className="text-sm font-medium text-foreground">
              {(k.searchIgnoredPaths as string) ?? 'Custom ignored paths'}
            </label>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {parsedRules.length}
            </span>
          </div>
          <textarea
            id="search-ignored-paths"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
              setSaved(false);
              setError('');
            }}
            spellCheck={false}
            rows={5}
            placeholder={(k.searchIgnoredPlaceholder as string) ?? 'Archive/\nPrivate Notes/\n*.tmp'}
            className="min-h-[8.5rem] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="min-h-4 text-xs text-muted-foreground">
            {error || (saved ? ((k.searchIgnoredSaved as string) ?? 'Saved to .mindosignore') : ((k.searchIgnoredHint as string) ?? 'Saved to .mindosignore in your knowledge base.'))}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(currentText);
                setDirty(false);
                setSaved(false);
                setError('');
              }}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw size={12} />
              {(k.searchIgnoredReset as string) ?? 'Reset'}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : <Save size={12} />}
              {(k.searchIgnoredSave as string) ?? 'Save'}
            </button>
          </div>
        </div>
      </div>
    </SettingCard>
  );
}

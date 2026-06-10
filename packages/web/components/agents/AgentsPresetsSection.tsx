'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Database,
  FileText,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { AgentSectionHeading } from './AgentsPrimitives';
import {
  BUILTIN_AGENT_PRESETS,
  getPresetLegacyStorageKeys,
  getPresetStorageKey,
  type BuiltinAgentPreset,
} from './builtin-agent-presets';

type PresetsCopy = {
  title: string;
  subtitle: string;
  activeLabel: string;
  draftLabel: string;
  plannedLabel: string;
  presetRail: string;
  promptTitle: string;
  promptHint: string;
  toolsTitle: string;
  skillsTitle: string;
  contextTitle: string;
  triggersTitle: string;
  guardrailsTitle: string;
  contractTitle: string;
  launchTitle: string;
  launchHint: string;
  overviewSection: string;
  promptSection: string;
  resourcesSection: string;
  libraryHint: string;
  owner: string;
  runMode: string;
  persistence: string;
  modelPolicy: string;
  surface: string;
  openSurface: string;
  notRunnable: string;
  saveDraft: string;
  resetDefault: string;
  customDraft: string;
  unsavedDraft: string;
  saved: string;
  saveFailed: string;
  reset: string;
};

type PresetSection = 'overview' | 'prompt' | 'resources';

function readStoredPromptDraft(preset: BuiltinAgentPreset): string | null {
  return window.localStorage.getItem(getPresetStorageKey(preset.id))
    ?? getPresetLegacyStorageKeys(preset)
      .map(key => window.localStorage.getItem(key))
      .find((value): value is string => typeof value === 'string')
    ?? null;
}

function clearStoredPromptDraft(preset: BuiltinAgentPreset): void {
  window.localStorage.removeItem(getPresetStorageKey(preset.id));
  for (const legacyKey of getPresetLegacyStorageKeys(preset)) {
    window.localStorage.removeItem(legacyKey);
  }
}

export default function AgentsPresetsSection({ copy }: { copy: PresetsCopy }) {
  const [selectedId, setSelectedId] = useState(BUILTIN_AGENT_PRESETS[0]?.id ?? '');
  const [section, setSection] = useState<PresetSection>('overview');
  const selected = useMemo(
    () => BUILTIN_AGENT_PRESETS.find(preset => preset.id === selectedId) ?? BUILTIN_AGENT_PRESETS[0],
    [selectedId],
  );
  const [savedPromptDrafts, setSavedPromptDrafts] = useState<Record<string, string>>({});
  const [promptEdits, setPromptEdits] = useState<Record<string, string>>({});
  const [promptDraftMigrations, setPromptDraftMigrations] = useState<Record<string, boolean>>({});
  const [promptFileLoading, setPromptFileLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const preset of BUILTIN_AGENT_PRESETS) {
      if (preset.promptPath) continue;
      const saved = readStoredPromptDraft(preset);
      if (saved) drafts[preset.id] = saved;
    }
    setSavedPromptDrafts(drafts);
  }, []);

  useEffect(() => {
    if (!selected.promptPath) return;
    const storedDraft = readStoredPromptDraft(selected);
    if (storedDraft !== null) {
      setPromptEdits(prev => ({ ...prev, [selected.id]: storedDraft }));
      setPromptDraftMigrations(prev => ({ ...prev, [selected.id]: true }));
    }

    let cancelled = false;
    setPromptFileLoading(prev => ({ ...prev, [selected.id]: true }));

    fetch(`/api/file?path=${encodeURIComponent(selected.promptPath)}&op=read_file`)
      .then(async (res) => {
        if (!res.ok) return selected.prompt;
        const body = await res.json() as { content?: unknown };
        return typeof body.content === 'string' && body.content.trim() ? body.content : selected.prompt;
      })
      .catch(() => selected.prompt)
      .then((content) => {
        if (cancelled) return;
        setSavedPromptDrafts(prev => ({ ...prev, [selected.id]: content }));
        if (storedDraft !== null && storedDraft === content) {
          clearStoredPromptDraft(selected);
          setPromptDraftMigrations(prev => {
            const next = { ...prev };
            delete next[selected.id];
            return next;
          });
          setPromptEdits(prev => {
            if (prev[selected.id] !== storedDraft) return prev;
            const next = { ...prev };
            delete next[selected.id];
            return next;
          });
        }
      })
      .finally(() => {
        if (!cancelled) setPromptFileLoading(prev => ({ ...prev, [selected.id]: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const savedPrompt = savedPromptDrafts[selected.id];
  const promptValue = promptEdits[selected.id] ?? savedPrompt ?? selected.prompt;
  const baselinePrompt = savedPrompt ?? selected.prompt;
  const isPromptLoading = Boolean(selected.promptPath && promptFileLoading[selected.id]);
  const hasCustomDraft = typeof savedPrompt === 'string' && savedPrompt !== selected.prompt;
  const hasUnsavedChanges = promptValue !== baselinePrompt || Boolean(promptDraftMigrations[selected.id]);
  const canResetPrompt = !isPromptLoading && (promptValue !== selected.prompt || hasCustomDraft);

  const updatePrompt = useCallback((value: string) => {
    setPromptEdits(prev => ({ ...prev, [selected.id]: value }));
  }, [selected.id]);

  const savePromptFile = useCallback(async (content: string) => {
    if (!selected.promptPath) return;
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'save_file',
        path: selected.promptPath,
        content,
        source: 'user',
      }),
    });
    if (!res.ok) throw new Error(`Prompt save failed (${res.status})`);
  }, [selected.promptPath]);

  const saveDraft = useCallback(async () => {
    try {
      if (selected.promptPath) {
        await savePromptFile(promptValue);
        clearStoredPromptDraft(selected);
        setSavedPromptDrafts(prev => ({ ...prev, [selected.id]: promptValue }));
      } else if (promptValue === selected.prompt) {
        clearStoredPromptDraft(selected);
        setSavedPromptDrafts(prev => {
          const next = { ...prev };
          delete next[selected.id];
          return next;
        });
      } else {
        window.localStorage.setItem(getPresetStorageKey(selected.id), promptValue);
        setSavedPromptDrafts(prev => ({ ...prev, [selected.id]: promptValue }));
      }
      setPromptEdits(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      setPromptDraftMigrations(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      toast.success(copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    }
  }, [copy.saveFailed, copy.saved, promptValue, savePromptFile, selected]);

  const resetDraft = useCallback(async () => {
    try {
      if (selected.promptPath) {
        await savePromptFile(selected.prompt);
        clearStoredPromptDraft(selected);
        setSavedPromptDrafts(prev => ({ ...prev, [selected.id]: selected.prompt }));
      } else {
        clearStoredPromptDraft(selected);
        setSavedPromptDrafts(prev => {
          const next = { ...prev };
          delete next[selected.id];
          return next;
        });
      }
      setPromptEdits(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      setPromptDraftMigrations(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      toast.success(copy.reset);
    } catch {
      toast.error(copy.saveFailed);
    }
  }, [copy.reset, copy.saveFailed, savePromptFile, selected]);

  const counts = useMemo(() => ({
    active: BUILTIN_AGENT_PRESETS.filter(preset => preset.status === 'active').length,
    draft: BUILTIN_AGENT_PRESETS.filter(preset => preset.status === 'draft').length,
    planned: BUILTIN_AGENT_PRESETS.filter(preset => preset.status === 'planned').length,
  }), []);

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <aside className="space-y-3">
        <PanelLabel icon={<Sparkles size={13} />} label={copy.presetRail} />
        <p className="text-xs leading-relaxed text-muted-foreground/70">{copy.libraryHint}</p>
        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/60 bg-card/45 text-center shadow-sm">
          <LibraryMetric value={counts.active} label={copy.activeLabel} />
          <LibraryMetric value={counts.draft} label={copy.draftLabel} />
          <LibraryMetric value={counts.planned} label={copy.plannedLabel} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/45 shadow-sm">
          {BUILTIN_AGENT_PRESETS.map(preset => (
            <PresetRow
              key={preset.id}
              preset={preset}
              active={preset.id === selected.id}
              copy={copy}
              onClick={() => setSelectedId(preset.id)}
            />
          ))}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="rounded-xl border border-border/60 bg-card/45 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{selected.name}</h2>
                <StatusPill preset={selected} copy={copy} />
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {selected.description}
              </p>
            </div>
            <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
              <Database size={12} className="text-[var(--amber)]" />
              {selected.owner}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-background/70 p-1">
            <SectionButton active={section === 'overview'} onClick={() => setSection('overview')} icon={<ShieldCheck size={13} />} label={copy.overviewSection} />
            <SectionButton active={section === 'prompt'} onClick={() => setSection('prompt')} icon={<FileText size={13} />} label={copy.promptSection} />
            <SectionButton active={section === 'resources'} onClick={() => setSection('resources')} icon={<Wrench size={13} />} label={copy.resourcesSection} />
          </div>
        </div>

        {section === 'overview' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <PresetListCard icon={<Play size={13} />} title={copy.triggersTitle} items={selected.triggers} prominent />
            <PresetListCard icon={<ShieldCheck size={13} />} title={copy.guardrailsTitle} items={selected.guardrails} tone="safe" />
            <section className="rounded-xl border border-border/60 bg-card/45 p-4 shadow-sm lg:col-span-2">
              <PanelLabel icon={<ShieldCheck size={13} />} label={copy.contractTitle} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <ContractLine icon={<Play size={13} />} label={copy.runMode} value={selected.runMode} />
                <ContractLine icon={<Save size={13} />} label={copy.persistence} value={selected.persistence} />
                <ContractLine icon={<SlidersHorizontal size={13} />} label={copy.modelPolicy} value={selected.modelPolicy} />
                <ContractLine icon={<BookOpen size={13} />} label={copy.surface} value={selected.surface} />
              </div>
            </section>
          </div>
        ) : null}

        {section === 'prompt' ? (
          <div className="rounded-xl border border-border/60 bg-card/45 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <PanelLabel icon={<FileText size={13} />} label={copy.promptTitle} />
                  <PromptDraftPill
                    hasCustomDraft={hasCustomDraft}
                    hasUnsavedChanges={hasUnsavedChanges}
                    copy={copy}
                  />
                </div>
                <p className="mt-1 text-2xs text-muted-foreground/60">{copy.promptHint}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={!canResetPrompt}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RotateCcw size={12} />
                  {copy.resetDefault}
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={!hasUnsavedChanges || isPromptLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Save size={12} />
                  {copy.saveDraft}
                </button>
              </div>
            </div>
            <textarea
              value={promptValue}
              onChange={(event) => updatePrompt(event.target.value)}
              disabled={isPromptLoading}
              className="min-h-[360px] w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
              spellCheck={false}
            />
          </div>
        ) : null}

        {section === 'resources' ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <PresetListCard icon={<Wrench size={13} />} title={copy.toolsTitle} items={selected.tools} />
            <PresetListCard icon={<Sparkles size={13} />} title={copy.skillsTitle} items={selected.skills} />
            <PresetListCard icon={<Database size={13} />} title={copy.contextTitle} items={selected.context} />
          </div>
        ) : null}
      </section>

      <aside className="space-y-4 xl:col-span-1 xl:col-start-2 2xl:col-start-auto">
        <section className="rounded-xl border border-border/60 bg-card/45 p-4 shadow-sm 2xl:sticky 2xl:top-5">
          <PanelLabel icon={<Play size={13} />} label={copy.launchTitle} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground/70">{copy.launchHint}</p>
          <div className="mt-4">
            <PresetAction preset={selected} copy={copy} />
          </div>
          <div className="mt-4 space-y-2 border-t border-border/45 pt-4">
            <ContractLine icon={<BookOpen size={13} />} label={copy.surface} value={selected.surface} />
            <ContractLine icon={<SlidersHorizontal size={13} />} label={copy.modelPolicy} value={selected.modelPolicy} />
            <ContractLine icon={<ShieldCheck size={13} />} label={copy.guardrailsTitle} value={selected.guardrails[0] ?? ''} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function LibraryMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-r border-border/45 px-2 py-3 last:border-r-0">
      <div className="text-lg font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">{label}</div>
    </div>
  );
}

function SectionButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:flex-none ${
        active
          ? 'bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PromptDraftPill({
  hasCustomDraft,
  hasUnsavedChanges,
  copy,
}: {
  hasCustomDraft: boolean;
  hasUnsavedChanges: boolean;
  copy: PresetsCopy;
}) {
  if (hasUnsavedChanges) {
    return (
      <span className="rounded-full bg-[var(--amber)]/10 px-2 py-0.5 text-2xs font-medium text-[var(--amber)]">
        {copy.unsavedDraft}
      </span>
    );
  }

  if (hasCustomDraft) {
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success">
        {copy.customDraft}
      </span>
    );
  }

  return null;
}

function PresetAction({ preset, copy }: { preset: BuiltinAgentPreset; copy: PresetsCopy }) {
  if (preset.status === 'active' && preset.surfaceHref) {
    return (
      <Link
        href={preset.surfaceHref}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Play size={13} />
        {preset.primaryAction || copy.openSurface}
        <ArrowUpRight size={12} />
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground opacity-65"
    >
      <Play size={13} />
      {copy.notRunnable}
    </button>
  );
}

function PresetRow({
  preset,
  active,
  copy,
  onClick,
}: {
  preset: BuiltinAgentPreset;
  active: boolean;
  copy: PresetsCopy;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 border-b border-border/45 px-3 py-3 text-left last:border-b-0 transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-[var(--amber-subtle)]/75' : 'hover:bg-muted/35'
      }`}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${
        active
          ? 'border-[var(--amber)]/35 bg-background text-[var(--amber)]'
          : 'border-border/50 bg-background text-muted-foreground'
      }`}>
        {preset.shortName.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{preset.name}</span>
          <StatusPill preset={preset} copy={copy} compact />
        </span>
        <span className="mt-1 line-clamp-2 text-2xs leading-relaxed text-muted-foreground/65">
          {preset.description}
        </span>
      </span>
    </button>
  );
}

function StatusPill({ preset, copy, compact = false }: { preset: BuiltinAgentPreset; copy: PresetsCopy; compact?: boolean }) {
  const label = preset.status === 'active' ? copy.activeLabel : preset.status === 'draft' ? copy.draftLabel : copy.plannedLabel;
  const cls = preset.status === 'active'
    ? 'bg-success/10 text-success'
    : preset.status === 'draft'
      ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
      : 'bg-muted text-muted-foreground';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${compact ? 'text-[10px]' : 'text-2xs'} ${cls}`}>
      {label}
    </span>
  );
}

function PanelLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <AgentSectionHeading
      as="p"
      size="sm"
      icon={icon}
      title={label}
      titleClassName="text-2xs uppercase tracking-wider text-muted-foreground/65"
    />
  );
}

function ContractLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/25 px-3 py-2">
      <span className="mt-0.5 text-[var(--amber)]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">{label}</span>
        <span className="mt-0.5 block text-xs text-foreground/80">{value}</span>
      </span>
    </div>
  );
}

function PresetListCard({
  icon,
  title,
  items,
  tone,
  prominent = false,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  tone?: 'safe';
  prominent?: boolean;
}) {
  return (
    <section className={`rounded-xl border p-3 shadow-sm ${prominent ? 'border-[var(--amber)]/25 bg-[var(--amber)]/[0.04]' : 'border-border/60 bg-card/45'}`}>
      <PanelLabel icon={icon} label={title} />
      <div className="mt-3 space-y-1.5">
        {items.map(item => (
          <div key={item} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground/80 ${prominent ? 'bg-background/70' : 'bg-background'}`}>
            <Check size={11} className={`mt-0.5 shrink-0 ${tone === 'safe' ? 'text-success/70' : 'text-[var(--amber)]/70'}`} />
            <span className="min-w-0">{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

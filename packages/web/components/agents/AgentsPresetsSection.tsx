'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  Database,
  FileText,
  FolderLock,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { AgentSectionHeading } from './AgentsPrimitives';

type MindosAssistantSource = 'builtin' | 'custom';

type MindosAssistantPromptPayload = {
  exists: boolean;
  content?: string;
};

type MindosAssistantPaths = {
  root: string;
  profile: string;
  prompt: string;
};

type MindosAssistantLibraryItem = {
  id: string;
  name: string;
  description: string;
  schemaVersion?: number;
  preferredAgent?: string;
  skills?: string[];
  mcp?: string[];
  source?: MindosAssistantSource;
  deletable?: boolean;
  paths?: MindosAssistantPaths;
  promptPath: string;
  profilePath: string;
  promptReady: boolean;
  profileReady: boolean;
  promptTitle?: string;
  promptPreview: string;
  prompt: string | MindosAssistantPromptPayload;
  profileError?: 'invalid_json' | 'unreadable';
};

type MindosAssistantsPayload = {
  root: string;
  assistants: MindosAssistantLibraryItem[];
};

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
  profileSection?: string;
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
  totalLabel?: string;
  scheduledLabel?: string;
  localRoot?: string;
  localRootHint?: string;
  loading?: string;
  loadFailed?: string;
  retry?: string;
  emptyTitle?: string;
  emptyHint?: string;
  readyLabel?: string;
  needsPromptLabel?: string;
  localOwnerLabel?: string;
  promptMissingHint?: string;
  saveProfile?: string;
  profileSaved?: string;
  nameLabel?: string;
  descLabel?: string;
  scheduleLabel?: string;
  scheduleManual?: string;
  scheduleDaily?: string;
  scheduleWeekly?: string;
  roleTitle?: string;
  inputTitle?: string;
  outputTitle?: string;
  boundaryTitle?: string;
  noResources?: string;
  notDefinedYet?: string;
  systemModelDefault?: string;
  profileInvalidJson?: string;
  profileUnreadable?: string;
  builtinLabel?: string;
  customLabel?: string;
  protectedLabel?: string;
  deleteAssistant?: string;
  deleteFailed?: string;
  deleted?: string;
  runningLabel?: string;
  runFailed?: string;
  runCompleted?: string;
  preferredAgentLabel?: string;
  mcpTitle?: string;
  searchPlaceholder?: string;
  filterAll?: string;
  filterBuiltin?: string;
  filterCustom?: string;
  filterNeedsPrompt?: string;
  newAssistant?: string;
  createAssistant?: string;
  cancel?: string;
  assistantIdLabel?: string;
  noMatchesTitle?: string;
  noMatchesHint?: string;
  inspectorTitle?: string;
  recentRunLabel?: string;
  promptPlaceholder?: (name: string) => string;
};

type PresetSection = 'overview' | 'prompt' | 'profile' | 'resources';
type AssistantFilter = 'all' | 'builtin' | 'custom' | 'needsPrompt';

type ProfileEdit = {
  name: string;
  description: string;
  preferredAgent: string;
  skillsText: string;
  mcpText: string;
};

type CreateAssistantDraft = {
  id: string;
  name: string;
  description: string;
};

type AssistantCounts = {
  total: number;
  ready: number;
  custom: number;
  builtin: number;
  needsPrompt: number;
};

type AssistantGroups = {
  builtin: AssistantView[];
  custom: AssistantView[];
};

const DEFAULT_PROFILE_SECTION = 'Profile';

type AssistantPromptSections = {
  role?: string;
  inputs: string[];
  output?: string;
  boundaries: string[];
};

type AssistantView = Omit<MindosAssistantLibraryItem, 'prompt' | 'source' | 'deletable' | 'paths' | 'skills' | 'mcp'> & {
  prompt: MindosAssistantPromptPayload;
  source: MindosAssistantSource;
  deletable: boolean;
  paths: MindosAssistantPaths;
  skills: string[];
  mcp: string[];
  promptContent: string;
  sections: AssistantPromptSections;
};

export default function AgentsPresetsSection({
  copy,
  onLibraryCountChange,
}: {
  copy: PresetsCopy;
  onLibraryCountChange?: (count: number) => void;
}) {
  const [assistants, setAssistants] = useState<AssistantView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [section, setSection] = useState<PresetSection>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptEdits, setPromptEdits] = useState<Record<string, string>>({});
  const [profileEdits, setProfileEdits] = useState<Record<string, ProfileEdit>>({});
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null);
  const [runningAssistantId, setRunningAssistantId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ assistantId: string; output?: string; error?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AssistantFilter>('all');
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateAssistantDraft>({ id: '', name: '', description: '' });
  const [creatingAssistant, setCreatingAssistant] = useState(false);

  const loadAssistants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/assistants', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${copy.loadFailed ?? 'Failed to load assistants.'} (${res.status})`);
      const payload = await res.json() as MindosAssistantsPayload;
      const nextAssistants = payload.assistants.map(toAssistantView);
      setAssistants(nextAssistants);
      onLibraryCountChange?.(payload.assistants.length);
      setSelectedId((current) => {
        if (nextAssistants.some(assistant => assistant.id === current)) return current;
        return nextAssistants[0]?.id ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      onLibraryCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, onLibraryCountChange]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  const selected = useMemo(
    () => assistants.find(assistant => assistant.id === selectedId) ?? assistants[0],
    [assistants, selectedId],
  );

  const counts = useMemo(() => ({
    total: assistants.length,
    ready: assistants.filter(assistant => assistant.promptReady).length,
    custom: assistants.filter(assistant => assistant.source === 'custom').length,
    builtin: assistants.filter(assistant => assistant.source === 'builtin').length,
    needsPrompt: assistants.filter(assistant => !assistant.promptReady).length,
  }), [assistants]);

  const filteredAssistants = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return assistants.filter((assistant) => {
      const matchesFilter = filter === 'all'
        || (filter === 'builtin' && assistant.source === 'builtin')
        || (filter === 'custom' && assistant.source === 'custom')
        || (filter === 'needsPrompt' && !assistant.promptReady);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [
        assistant.id,
        assistant.name,
        assistant.description,
        assistant.preferredAgent ?? '',
        assistant.skills.join(' '),
        assistant.mcp.join(' '),
      ].some(value => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [assistants, filter, query]);

  const groupedAssistants = useMemo(() => ({
    builtin: filteredAssistants.filter(assistant => assistant.source === 'builtin'),
    custom: filteredAssistants.filter(assistant => assistant.source === 'custom'),
  }), [filteredAssistants]);

  const profileEdit = selected
    ? profileEdits[selected.id] ?? {
      name: selected.name,
      description: selected.description,
      preferredAgent: selected.preferredAgent ?? 'mindos-agent',
      skillsText: selected.skills.join('\n'),
      mcpText: selected.mcp.join('\n'),
    }
    : null;
  const promptValue = selected ? promptEdits[selected.id] ?? selected.promptContent : '';
  const hasPromptChanges = Boolean(selected && promptValue !== selected.promptContent);
  const hasProfileChanges = Boolean(selected && profileEdit && (
    profileEdit.name !== selected.name
    || profileEdit.description !== selected.description
    || profileEdit.preferredAgent !== (selected.preferredAgent ?? 'mindos-agent')
    || profileEdit.skillsText !== selected.skills.join('\n')
    || profileEdit.mcpText !== selected.mcp.join('\n')
  ));

  const updateSelectedAssistant = useCallback((assistantId: string, patch: Partial<AssistantView>) => {
    setAssistants(prev => prev.map(assistant => (
      assistant.id === assistantId ? { ...assistant, ...patch } : assistant
    )));
  }, []);

  const savePrompt = useCallback(async () => {
    if (!selected) return;
    setSavingPrompt(true);
    try {
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'save_file',
          path: selected.promptPath,
          content: promptValue,
          source: 'user',
        }),
      });
      if (!res.ok) throw new Error(`Prompt save failed (${res.status})`);
      const promptDetails = parsePromptDetails(promptValue);
      updateSelectedAssistant(selected.id, {
        promptContent: promptValue,
        prompt: {
          exists: true,
          content: promptValue,
        },
        promptReady: true,
        promptPreview: promptDetails.promptPreview,
        sections: promptDetails.sections,
        ...(promptDetails.promptTitle ? { promptTitle: promptDetails.promptTitle } : {}),
        description: deriveAssistantDescription(selected, promptDetails),
      });
      setPromptEdits(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      toast.success(copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setSavingPrompt(false);
    }
  }, [copy.saveFailed, copy.saved, promptValue, selected, updateSelectedAssistant]);

  const discardPromptChanges = useCallback(() => {
    if (!selected) return;
    setPromptEdits(prev => {
      const next = { ...prev };
      delete next[selected.id];
      return next;
    });
    toast.success(copy.reset);
  }, [copy.reset, selected]);

  const saveProfile = useCallback(async () => {
    if (!selected || !profileEdit) return;
    setSavingProfile(true);
    try {
      const payload = {
        name: profileEdit.name.trim() || selected.name,
        description: profileEdit.description.trim(),
        schemaVersion: 1,
        preferredAgent: profileEdit.preferredAgent.trim() || 'mindos-agent',
        skills: splitListText(profileEdit.skillsText),
        mcp: splitListText(profileEdit.mcpText),
      };
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'save_file',
          path: selected.profilePath,
          content: `${JSON.stringify(payload, null, 2)}\n`,
          source: 'user',
        }),
      });
      if (!res.ok) throw new Error(`Profile save failed (${res.status})`);
      updateSelectedAssistant(selected.id, {
        name: payload.name,
        description: payload.description || selected.sections.role || selected.promptPreview || selected.description,
        preferredAgent: payload.preferredAgent,
        skills: payload.skills,
        mcp: payload.mcp,
        profileReady: true,
        profileError: undefined,
      });
      setProfileEdits(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      toast.success(copy.profileSaved ?? copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setSavingProfile(false);
    }
  }, [copy.profileSaved, copy.saveFailed, copy.saved, profileEdit, selected, updateSelectedAssistant]);

  const deleteAssistant = useCallback(async (assistant: AssistantView) => {
    if (!assistant.deletable || deletingAssistantId) return;
    setDeletingAssistantId(assistant.id);
    try {
      const res = await fetch('/api/assistants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assistant.id }),
      });
      if (!res.ok) throw new Error(`Assistant delete failed (${res.status})`);
      setAssistants(prev => prev.filter(item => item.id !== assistant.id));
      setPromptEdits(prev => {
        const next = { ...prev };
        delete next[assistant.id];
        return next;
      });
      setProfileEdits(prev => {
        const next = { ...prev };
        delete next[assistant.id];
        return next;
      });
      setSelectedId(current => current === assistant.id ? '' : current);
      onLibraryCountChange?.(Math.max(0, assistants.length - 1));
      toast.success(copy.deleted ?? 'Assistant deleted');
    } catch {
      toast.error(copy.deleteFailed ?? copy.saveFailed);
    } finally {
      setDeletingAssistantId(null);
    }
  }, [assistants.length, copy.deleteFailed, copy.deleted, copy.saveFailed, deletingAssistantId, onLibraryCountChange]);

  const runAssistant = useCallback(async (assistant: AssistantView) => {
    if (!assistant.promptReady || runningAssistantId) return;
    setRunningAssistantId(assistant.id);
    setRunResult(null);
    try {
      const output = assistant.id === 'dreaming'
        ? await runDedicatedAssistant(assistant)
        : await runPromptAssistant(assistant);
      setRunResult({ assistantId: assistant.id, output });
      toast.success(copy.runCompleted ?? 'Assistant run completed');
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setRunResult({ assistantId: assistant.id, error: message });
      toast.error(copy.runFailed ?? copy.saveFailed);
    } finally {
      setRunningAssistantId(null);
    }
  }, [copy.runCompleted, copy.runFailed, copy.saveFailed, runningAssistantId]);

  const createAssistant = useCallback(async () => {
    const assistantId = slugifyAssistantId(createDraft.id || createDraft.name);
    if (!assistantId || creatingAssistant) return;
    setCreatingAssistant(true);
    try {
      const res = await fetch('/api/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assistantId,
          name: createDraft.name.trim() || titleizeAssistantId(assistantId),
          description: createDraft.description.trim(),
          preferredAgent: 'mindos-agent',
          skills: [],
          mcp: [],
        }),
      });
      if (!res.ok) throw new Error(`Assistant create failed (${res.status})`);
      await loadAssistants();
      setSelectedId(assistantId);
      setSection('overview');
      setCreating(false);
      setCreateDraft({ id: '', name: '', description: '' });
      toast.success(copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setCreatingAssistant(false);
    }
  }, [copy.saveFailed, copy.saved, createDraft.description, createDraft.id, createDraft.name, creatingAssistant, loadAssistants]);

  return (
    <div className="space-y-4">
      <AssistantCommandBar
        copy={copy}
        counts={counts}
        query={query}
        filter={filter}
        creating={creating}
        selected={selected}
        running={Boolean(selected && runningAssistantId === selected.id)}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onToggleCreate={() => setCreating(current => !current)}
        onRunSelected={() => selected ? void runAssistant(selected) : undefined}
      />

      {creating ? (
        <CreateAssistantComposer
          draft={createDraft}
          busy={creatingAssistant}
          copy={copy}
          onChange={setCreateDraft}
          onCancel={() => {
            setCreating(false);
            setCreateDraft({ id: '', name: '', description: '' });
          }}
          onCreate={() => void createAssistant()}
        />
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/35 shadow-sm xl:grid xl:min-h-[680px] xl:grid-cols-[320px_minmax(0,1fr)]">
        <AssistantDirectory
          copy={copy}
          loading={loading}
          error={error}
          counts={counts}
          filteredCount={filteredAssistants.length}
          groupedAssistants={groupedAssistants}
          selectedId={selected?.id}
          query={query}
          onRetry={loadAssistants}
          onSelect={(assistantId) => {
            setSelectedId(assistantId);
            setSection('overview');
          }}
          onRun={(assistant) => void runAssistant(assistant)}
          onDelete={(assistant) => void deleteAssistant(assistant)}
          runningAssistantId={runningAssistantId}
          deletingAssistantId={deletingAssistantId}
        />

        <main className="min-w-0 border-t border-border/55 bg-background/35 xl:border-l xl:border-t-0">
          {loading ? (
            <AssistantDetailSkeleton />
          ) : error ? (
            <div className="p-4">
              <AssistantStateCard
                icon={<AlertCircle size={18} />}
                title={copy.loadFailed ?? 'Failed to load assistants.'}
                body={error}
                actionLabel={copy.retry ?? 'Retry'}
                onAction={loadAssistants}
              />
            </div>
          ) : !selected ? (
            <div className="p-4">
              <AssistantStateCard
                icon={<FolderLock size={18} />}
                title={copy.emptyTitle ?? 'No local assistants found'}
                body={copy.emptyHint ?? 'Create an Assistant profile to add one.'}
              />
            </div>
          ) : (
            <AssistantUnifiedDetail
              assistant={selected}
              section={section}
              promptValue={promptValue}
              profileEdit={profileEdit}
              hasPromptChanges={hasPromptChanges}
              hasProfileChanges={hasProfileChanges}
              savingPrompt={savingPrompt}
              savingProfile={savingProfile}
              deleting={deletingAssistantId === selected.id}
              running={runningAssistantId === selected.id}
              runResult={runResult?.assistantId === selected.id ? runResult : null}
              copy={copy}
              onSectionChange={setSection}
              onPromptChange={(value) => setPromptEdits(prev => ({ ...prev, [selected.id]: value }))}
              onSavePrompt={savePrompt}
              onDiscardPrompt={discardPromptChanges}
              onProfileChange={(next) => setProfileEdits(prev => ({ ...prev, [selected.id]: next }))}
              onSaveProfile={saveProfile}
              onDiscardProfile={() => setProfileEdits(prev => {
                const next = { ...prev };
                delete next[selected.id];
                return next;
              })}
              onRun={() => void runAssistant(selected)}
              onDelete={() => void deleteAssistant(selected)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function AssistantCommandBar({
  copy,
  counts,
  query,
  filter,
  creating,
  selected,
  running,
  onQueryChange,
  onFilterChange,
  onToggleCreate,
  onRunSelected,
}: {
  copy: PresetsCopy;
  counts: AssistantCounts;
  query: string;
  filter: AssistantFilter;
  creating: boolean;
  selected?: AssistantView;
  running: boolean;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: AssistantFilter) => void;
  onToggleCreate: () => void;
  onRunSelected: () => void;
}) {
  const filterOptions: Array<{ value: AssistantFilter; label: string; count: number }> = [
    { value: 'builtin', label: copy.filterBuiltin ?? copy.builtinLabel ?? 'Built-in', count: counts.builtin },
    { value: 'custom', label: copy.filterCustom ?? copy.customLabel ?? 'Custom', count: counts.custom },
  ];

  return (
    <div
      data-assistant-command-center
      className="grid gap-3 rounded-xl border border-border/60 bg-card/35 p-3 shadow-sm xl:grid-cols-[auto_minmax(260px,1fr)_auto]"
    >
      <div
        role="group"
        aria-label="Filter assistants"
        className="flex min-h-10 min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-border/60 bg-background/70 p-1"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60" aria-hidden="true">
          <SlidersHorizontal size={13} />
        </span>
        {filterOptions.map(option => (
          <AssistantFilterPill
            key={option.value}
            active={filter === option.value}
            label={option.label}
            count={option.count}
            onClick={() => onFilterChange(option.value)}
          />
        ))}
      </div>

      <label className="relative min-w-0">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/55" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={copy.searchPlaceholder ?? 'Search assistants'}
          placeholder={copy.searchPlaceholder ?? 'Search assistants...'}
          className="h-10 w-full rounded-lg border border-border bg-background/80 pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus-visible:border-[var(--amber)]/45 focus-visible:ring-2 focus-visible:ring-ring"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={13} />
          </button>
        ) : null}
      </label>

      <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
        <button
          type="button"
          onClick={onToggleCreate}
          aria-expanded={creating}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--amber)]/45 bg-background px-3 text-xs font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {creating ? <X size={14} /> : <Plus size={14} />}
          {copy.newAssistant ?? 'New Assistant'}
        </button>
        <button
          type="button"
          onClick={onRunSelected}
          disabled={!selected?.promptReady || running}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? copy.runningLabel ?? 'Running' : copy.launchTitle}
        </button>
      </div>
    </div>
  );
}

function AssistantFilterPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'bg-[var(--amber-dim)] text-[var(--amber-text)] shadow-sm'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
        active ? 'bg-background/75 text-[var(--amber-text)]' : 'bg-muted/55 text-muted-foreground/75'
      }`}>
        {count}
      </span>
    </button>
  );
}

function CreateAssistantComposer({
  draft,
  busy,
  copy,
  onChange,
  onCancel,
  onCreate,
}: {
  draft: CreateAssistantDraft;
  busy: boolean;
  copy: PresetsCopy;
  onChange: (draft: CreateAssistantDraft) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const effectiveId = slugifyAssistantId(draft.id || draft.name);
  return (
    <section className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/[0.04] p-3 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.75fr)_minmax(220px,1fr)_minmax(260px,1.3fr)_auto] lg:items-end">
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.assistantIdLabel ?? 'Assistant ID'}</span>
          <input
            value={draft.id}
            onChange={(event) => onChange({ ...draft, id: slugifyAssistantId(event.target.value) })}
            placeholder="research-scout"
            className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.nameLabel ?? 'Name'}</span>
          <input
            value={draft.name}
            onChange={(event) => {
              const nextName = event.target.value;
              const previousAutoId = slugifyAssistantId(draft.name);
              onChange({
                ...draft,
                name: nextName,
                id: !draft.id || draft.id === previousAutoId ? slugifyAssistantId(nextName) : draft.id,
              });
            }}
            placeholder="Research Scout"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.descLabel ?? 'Description'}</span>
          <input
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            placeholder="Finds useful local research follow-ups."
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copy.cancel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={!effectiveId || busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {copy.createAssistant ?? 'Create'}
          </button>
        </div>
      </div>
    </section>
  );
}

function AssistantDirectory({
  copy,
  loading,
  error,
  counts,
  filteredCount,
  groupedAssistants,
  selectedId,
  query,
  onRetry,
  onSelect,
  onRun,
  onDelete,
  runningAssistantId,
  deletingAssistantId,
}: {
  copy: PresetsCopy;
  loading: boolean;
  error: string | null;
  counts: AssistantCounts;
  filteredCount: number;
  groupedAssistants: AssistantGroups;
  selectedId?: string;
  query: string;
  onRetry: () => void;
  onSelect: (assistantId: string) => void;
  onRun: (assistant: AssistantView) => void;
  onDelete: (assistant: AssistantView) => void;
  runningAssistantId: string | null;
  deletingAssistantId: string | null;
}) {
  return (
    <aside data-assistant-command-column="library" className="min-w-0 bg-card/30">
      <div className="border-b border-border/55 p-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber)]">
            <FolderLock size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">{copy.presetRail}</p>
            <p className="mt-0.5 truncate text-2xs text-muted-foreground/60">{copy.localRoot ?? 'Local Assistant Library'}</p>
          </div>
          <span className="rounded-md bg-background/80 px-2 py-1 font-mono text-2xs text-muted-foreground tabular-nums">
            {filteredCount}/{counts.total}
          </span>
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-muted-foreground/60">
          {copy.localRootHint ?? 'Local Assistant profiles are ready to inspect and edit.'}
        </p>
        <p className="sr-only">{copy.libraryHint}</p>
      </div>

      <div className="max-h-[calc(100vh-260px)] min-h-[420px] overflow-y-auto">
        {loading ? (
          <LibraryLoading label={copy.loading ?? 'Loading assistants...'} />
        ) : error ? (
          <LibraryError
            message={copy.loadFailed ?? 'Failed to load assistants.'}
            detail={error}
            retry={copy.retry ?? 'Retry'}
            onRetry={onRetry}
          />
        ) : counts.total === 0 ? (
          <LibraryEmpty
            title={copy.emptyTitle ?? 'No local assistants found'}
            hint={copy.emptyHint ?? 'Create an Assistant profile to add one.'}
          />
        ) : filteredCount === 0 ? (
          <LibraryEmpty
            title={copy.noMatchesTitle ?? 'No matching assistants'}
            hint={query ? copy.noMatchesHint ?? 'Try a different name, ID, skill, or MCP filter.' : copy.emptyHint ?? 'Create an Assistant profile to add one.'}
          />
        ) : (
          <div>
            <AssistantDirectoryGroup
              title={copy.builtinLabel ?? 'Built-in'}
              count={groupedAssistants.builtin.length}
              assistants={groupedAssistants.builtin}
              copy={copy}
              selectedId={selectedId}
              onSelect={onSelect}
              onRun={onRun}
              onDelete={onDelete}
              runningAssistantId={runningAssistantId}
              deletingAssistantId={deletingAssistantId}
            />
            <AssistantDirectoryGroup
              title={copy.customLabel ?? 'Custom'}
              count={groupedAssistants.custom.length}
              assistants={groupedAssistants.custom}
              copy={copy}
              selectedId={selectedId}
              onSelect={onSelect}
              onRun={onRun}
              onDelete={onDelete}
              runningAssistantId={runningAssistantId}
              deletingAssistantId={deletingAssistantId}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function AssistantDirectoryGroup({
  title,
  count,
  assistants,
  copy,
  selectedId,
  onSelect,
  onRun,
  onDelete,
  runningAssistantId,
  deletingAssistantId,
}: {
  title: string;
  count: number;
  assistants: AssistantView[];
  copy: PresetsCopy;
  selectedId?: string;
  onSelect: (assistantId: string) => void;
  onRun: (assistant: AssistantView) => void;
  onDelete: (assistant: AssistantView) => void;
  runningAssistantId: string | null;
  deletingAssistantId: string | null;
}) {
  if (assistants.length === 0) return null;
  return (
    <section className="border-b border-border/55 last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/45 bg-card/95 px-3 py-2 backdrop-blur">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground/45 tabular-nums">{count}</span>
      </div>
      <div>
        {assistants.map(assistant => (
          <AssistantRow
            key={assistant.id}
            assistant={assistant}
            active={assistant.id === selectedId}
            readyLabel={copy.readyLabel ?? 'Ready'}
            needsPromptLabel={copy.needsPromptLabel ?? 'Needs prompt'}
            sourceLabel={assistant.source === 'builtin' ? copy.protectedLabel ?? 'Protected' : copy.customLabel ?? 'Custom'}
            deleteAssistantLabel={copy.deleteAssistant ?? 'Delete'}
            protectedLabel={copy.protectedLabel ?? 'Protected'}
            runLabel={copy.launchTitle}
            deleting={deletingAssistantId === assistant.id}
            running={runningAssistantId === assistant.id}
            onClick={() => onSelect(assistant.id)}
            onRun={() => onRun(assistant)}
            onDelete={() => onDelete(assistant)}
          />
        ))}
      </div>
    </section>
  );
}

function AssistantUnifiedDetail({
  assistant,
  section,
  promptValue,
  profileEdit,
  hasPromptChanges,
  hasProfileChanges,
  savingPrompt,
  savingProfile,
  deleting,
  running,
  runResult,
  copy,
  onSectionChange,
  onPromptChange,
  onSavePrompt,
  onDiscardPrompt,
  onProfileChange,
  onSaveProfile,
  onDiscardProfile,
  onRun,
  onDelete,
}: {
  assistant: AssistantView;
  section: PresetSection;
  promptValue: string;
  profileEdit: ProfileEdit | null;
  hasPromptChanges: boolean;
  hasProfileChanges: boolean;
  savingPrompt: boolean;
  savingProfile: boolean;
  deleting: boolean;
  running: boolean;
  runResult: { output?: string; error?: string } | null;
  copy: PresetsCopy;
  onSectionChange: (section: PresetSection) => void;
  onPromptChange: (value: string) => void;
  onSavePrompt: () => void;
  onDiscardPrompt: () => void;
  onProfileChange: (next: ProfileEdit) => void;
  onSaveProfile: () => void;
  onDiscardProfile: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const tabs: Array<{ id: PresetSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: copy.overviewSection, icon: <ShieldCheck size={13} /> },
    { id: 'prompt', label: copy.promptSection, icon: <FileText size={13} /> },
    { id: 'profile', label: copy.profileSection ?? DEFAULT_PROFILE_SECTION, icon: <UserRound size={13} /> },
    { id: 'resources', label: copy.resourcesSection, icon: <Wrench size={13} /> },
  ];
  const resources = `${assistant.skills.length} ${copy.skillsTitle} · ${assistant.mcp.length} ${copy.mcpTitle ?? 'MCP'}`;
  const description = assistant.sections.role || assistant.description || assistant.promptPreview || (copy.promptMissingHint ?? 'Create a prompt to describe how this assistant should work.');

  return (
    <article data-assistant-command-column="workspace" className="min-h-full bg-card/40">
      <div className="border-b border-border/55 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AssistantAvatar assistant={assistant} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold leading-tight text-foreground">{assistant.name}</h2>
                <ReadinessPill
                  ready={assistant.promptReady}
                  readyLabel={copy.readyLabel ?? 'Ready'}
                  needsPromptLabel={copy.needsPromptLabel ?? 'Needs prompt'}
                />
                <SourceBadge assistant={assistant} copy={copy} />
                {assistant.profileError ? (
                  <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-2xs font-medium text-destructive">
                    {assistant.profileError === 'invalid_json'
                      ? copy.profileInvalidJson ?? 'Profile JSON needs repair'
                      : copy.profileUnreadable ?? 'Profile unreadable'}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70">
                <code className="rounded-md border border-border/45 bg-background/70 px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
                  {assistant.id}
                </code>
                {!assistant.deletable ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/35 px-1.5 py-1">
                    <ShieldCheck size={11} />
                    {copy.protectedLabel ?? 'Protected'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[280px] xl:grid-cols-1">
            <button
              type="button"
              onClick={onRun}
              disabled={!assistant.promptReady || running}
              data-assistant-run={assistant.id}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--amber)] px-3 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? copy.runningLabel ?? 'Running' : copy.launchTitle}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!assistant.deletable || deleting}
              data-assistant-delete={assistant.id}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background/80 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : assistant.deletable ? <Trash2 size={14} /> : <ShieldCheck size={14} />}
              {assistant.deletable ? copy.deleteAssistant ?? 'Delete' : copy.protectedLabel ?? 'Protected'}
            </button>
          </div>
        </div>

        <div className="mt-5 grid overflow-hidden rounded-lg border border-border/45 bg-border/35 sm:grid-cols-2">
          <DetailMetaItem
            icon={<Route size={13} />}
            label={copy.preferredAgentLabel ?? 'Preferred agent'}
            value={assistant.preferredAgent ?? copy.systemModelDefault ?? 'mindos-agent'}
          />
          <DetailMetaItem
            icon={<Wrench size={13} />}
            label={copy.resourcesSection}
            value={resources}
          />
        </div>
      </div>

      <nav className="border-b border-border/55 px-5 py-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/25 p-1 sm:grid-cols-4 lg:inline-grid">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={section === tab.id}
              data-assistant-section-tab={tab.id}
              onClick={() => onSectionChange(tab.id)}
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                section === tab.id
                  ? 'bg-background text-[var(--amber-text)] shadow-sm'
                  : 'text-muted-foreground hover:bg-background/55 hover:text-foreground'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="min-h-[500px] p-5">
        {section === 'overview' ? (
          <UnifiedOverviewPane assistant={assistant} runResult={runResult} copy={copy} />
        ) : null}
        {section === 'prompt' ? (
          <PromptInspectorPanel
            assistant={assistant}
            value={promptValue}
            hasChanges={hasPromptChanges}
            saving={savingPrompt}
            copy={copy}
            onChange={onPromptChange}
            onSave={onSavePrompt}
            onDiscard={onDiscardPrompt}
          />
        ) : null}
        {section === 'profile' && profileEdit ? (
          <ProfileInspectorPanel
            assistant={assistant}
            edit={profileEdit}
            hasChanges={hasProfileChanges}
            saving={savingProfile}
            copy={copy}
            onChange={onProfileChange}
            onSave={onSaveProfile}
            onDiscard={onDiscardProfile}
          />
        ) : null}
        {section === 'resources' ? (
          <ResourceInspectorPanel assistant={assistant} copy={copy} />
        ) : null}
      </div>
    </article>
  );
}

function DetailMetaItem({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'ready' | 'warn' | 'neutral';
}) {
  const iconClass = tone === 'ready'
    ? 'text-success'
    : tone === 'warn'
      ? 'text-[var(--amber)]'
      : 'text-muted-foreground/70';
  return (
    <div className="min-w-0 border-b border-border/45 bg-background/55 px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55">
        <span className={iconClass}>{icon}</span>
        {label}
      </div>
      <p className="mt-1 truncate text-xs font-medium text-foreground/82">{value}</p>
    </div>
  );
}

function UnifiedOverviewPane({
  assistant,
  runResult,
  copy,
}: {
  assistant: AssistantView;
  runResult: { output?: string; error?: string } | null;
  copy: PresetsCopy;
}) {
  const role = assistant.sections.role || assistant.promptPreview || (assistant.promptReady ? '' : copy.promptMissingHint ?? 'Create a prompt to describe how this assistant should work.');
  const promptPreview = assistant.promptContent ? makePreview(stripLeadingFrontmatter(assistant.promptContent), 520) : copy.promptMissingHint ?? 'Write instructions to describe how this assistant should work.';
  const emptyText = copy.notDefinedYet ?? 'Not defined yet.';
  return (
    <div className="space-y-5">
      <section className="border-b border-border/45 pb-5">
        <PanelLabel icon={<Sparkles size={13} />} label={copy.roleTitle ?? 'Role'} />
        <p className="mt-3 max-w-3xl text-sm leading-7 text-foreground/85">{role || emptyText}</p>
      </section>

      <section className="overflow-hidden rounded-lg border border-border/45 bg-border/35">
        <div className="border-b border-border/45 bg-background/45 p-4">
          <ReadingList icon={<Database size={13} />} title={copy.inputTitle ?? 'Inputs'} items={assistant.sections.inputs} emptyText={emptyText} />
        </div>
        <div className="border-b border-border/45 bg-background/45 p-4">
          <ReadingText icon={<FileText size={13} />} title={copy.outputTitle ?? 'Output'} body={assistant.sections.output} emptyText={emptyText} />
        </div>
        <div className="bg-background/45 p-4">
          <ReadingList icon={<ShieldCheck size={13} />} title={copy.boundaryTitle ?? copy.guardrailsTitle} items={assistant.sections.boundaries} emptyText={emptyText} />
        </div>
      </section>

      <section className="border-t border-border/45 pt-5">
        <PanelLabel icon={<FileText size={13} />} label={copy.promptTitle} />
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-card/45 p-3 font-mono text-xs leading-6 text-foreground/80">
          {promptPreview}
        </pre>
      </section>

      <section className="border-t border-border/45 pt-5">
        <PanelLabel icon={<UserRound size={13} />} label={copy.profileSection ?? DEFAULT_PROFILE_SECTION} />
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <InspectorFact label={copy.nameLabel ?? 'Name'} value={assistant.name} />
          <InspectorFact label="ID" value={assistant.id} mono />
          <InspectorFact label={copy.preferredAgentLabel ?? 'Preferred agent'} value={assistant.preferredAgent ?? copy.systemModelDefault ?? 'mindos-agent'} />
        </dl>
      </section>

      <section className="border-t border-border/45 pt-5">
        <PanelLabel icon={<Clock3 size={13} />} label={copy.recentRunLabel ?? 'Recent run'} />
        {runResult ? (
          <p className={`mt-3 whitespace-pre-wrap text-xs leading-relaxed ${
            runResult.error ? 'text-destructive' : 'text-foreground/80'
          }`}>
            {runResult.error || runResult.output || (copy.runCompleted ?? 'Assistant run completed')}
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-muted/25 px-3 py-2 text-xs leading-relaxed text-muted-foreground/65">
            {emptyText}
          </p>
        )}
      </section>
    </div>
  );
}

function LibraryLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
      <Loader2 size={13} className="animate-spin" />
      {label}
    </div>
  );
}

function LibraryError({
  message,
  detail,
  retry,
  onRetry,
}: {
  message: string;
  detail: string;
  retry: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2 px-3 py-4">
      <div className="flex items-start gap-2 text-xs text-destructive">
        <AlertCircle size={13} className="mt-0.5" />
        <span>{message}</span>
      </div>
      <p className="break-words text-2xs text-muted-foreground/60">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw size={12} />
        {retry}
      </button>
    </div>
  );
}

function LibraryEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-3 py-5">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground/65">{hint}</p>
    </div>
  );
}

function AssistantRow({
  assistant,
  active,
  readyLabel,
  needsPromptLabel,
  sourceLabel,
  deleteAssistantLabel,
  protectedLabel,
  runLabel,
  deleting,
  running,
  onClick,
  onRun,
  onDelete,
}: {
  assistant: AssistantView;
  active: boolean;
  readyLabel: string;
  needsPromptLabel: string;
  sourceLabel: string;
  deleteAssistantLabel: string;
  protectedLabel: string;
  runLabel: string;
  deleting: boolean;
  running: boolean;
  onClick: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const summary = assistant.sections.role || assistant.description || assistant.promptPreview;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border/45 px-3 py-2 last:border-b-0 ${
        active ? 'bg-[var(--amber-subtle)]/75' : 'hover:bg-muted/35'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        data-assistant-library-row={assistant.id}
        className="flex min-w-0 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AssistantAvatar assistant={assistant} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{assistant.name}</span>
            <ReadinessPill ready={assistant.promptReady} readyLabel={readyLabel} needsPromptLabel={needsPromptLabel} compact />
          </span>
          <span className="mt-1 line-clamp-1 text-2xs leading-relaxed text-muted-foreground/65">
            {summary}
          </span>
          <span className="mt-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/45">
            <ShieldCheck size={10} />
            {sourceLabel}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-start gap-1">
        <button
          type="button"
          onClick={onRun}
          disabled={!assistant.promptReady || running}
          data-assistant-run={assistant.id}
          className="inline-flex h-7 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={runLabel}
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          <span className="sr-only">{running ? 'Running' : runLabel}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!assistant.deletable || deleting}
          data-assistant-delete={assistant.id}
          className="inline-flex h-7 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={assistant.deletable ? deleteAssistantLabel : protectedLabel}
        >
          {deleting ? <Loader2 size={11} className="animate-spin" /> : assistant.deletable ? <Trash2 size={11} /> : <ShieldCheck size={11} />}
          <span className="sr-only">{assistant.deletable ? deleteAssistantLabel : protectedLabel}</span>
        </button>
      </div>
    </div>
  );
}

function AssistantAvatar({ assistant, size = 'md' }: { assistant: AssistantView; size?: 'md' | 'lg' }) {
  const letter = Array.from(assistant.name.trim() || assistant.id)[0]?.toLocaleUpperCase() ?? '?';
  const tone = avatarTone(assistant.id);
  return (
    <span className={`${size === 'lg' ? 'h-11 w-11 text-base' : 'mt-0.5 h-8 w-8 text-xs'} flex shrink-0 items-center justify-center rounded-xl border font-semibold ${tone}`}>
      {letter}
    </span>
  );
}

function avatarTone(id: string): string {
  const tones = [
    'border-[var(--amber)]/30 bg-[var(--amber)]/10 text-[var(--amber-text)]',
    'border-success/25 bg-success/10 text-success',
    'border-[var(--tool-read)]/25 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
    'border-[var(--tool-search)]/25 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
  ];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

function ReadinessPill({
  ready,
  readyLabel,
  needsPromptLabel,
  compact = false,
}: {
  ready: boolean;
  readyLabel: string;
  needsPromptLabel: string;
  compact?: boolean;
}) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${compact ? 'text-[10px]' : 'text-2xs'} ${
      ready ? 'bg-success/10 text-success' : 'bg-[var(--amber)]/10 text-[var(--amber-text)]'
    }`}>
      {ready ? readyLabel : needsPromptLabel}
    </span>
  );
}

function SourceBadge({ assistant, copy }: { assistant: AssistantView; copy: PresetsCopy }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium ${
      assistant.source === 'builtin'
        ? 'bg-[var(--amber)]/10 text-[var(--amber-text)]'
        : 'bg-[var(--tool-search)]/10 text-[var(--tool-search)]'
    }`}>
      {assistant.source === 'builtin' ? <ShieldCheck size={11} /> : <UserRound size={11} />}
      {assistant.source === 'builtin' ? copy.builtinLabel ?? 'Built-in' : copy.customLabel ?? 'Custom'}
    </span>
  );
}

function ReadingList({
  icon,
  title,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <section className="min-w-0">
      <PanelLabel icon={icon} label={title} />
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map(item => (
            <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/82">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]/65" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground/65">{emptyText}</p>
      )}
    </section>
  );
}

function ReadingText({
  icon,
  title,
  body,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  emptyText: string;
}) {
  return (
    <section className="min-w-0">
      <PanelLabel icon={icon} label={title} />
      <p className="mt-3 text-sm leading-relaxed text-foreground/82">{body || emptyText}</p>
    </section>
  );
}

function PromptInspectorPanel({
  assistant,
  value,
  hasChanges,
  saving,
  copy,
  onChange,
  onSave,
  onDiscard,
}: {
  assistant: AssistantView;
  value: string;
  hasChanges: boolean;
  saving: boolean;
  copy: PresetsCopy;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="rounded-lg border border-border/55 bg-background/60">
      <div className="border-b border-border/45 p-3">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel icon={<FileText size={13} />} label={copy.promptTitle} />
          {hasChanges ? (
            <span className="rounded-md bg-[var(--amber)]/10 px-2 py-0.5 text-2xs font-medium text-[var(--amber-text)]">
              {copy.unsavedDraft}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-muted-foreground/60">{copy.promptHint}</p>
      </div>
      {!assistant.promptReady && !value ? (
        <div className="border-b border-border/45 bg-[var(--amber)]/[0.04] px-3 py-2 text-xs text-[var(--amber-text)]">
          {copy.promptMissingHint ?? 'Write instructions to describe how this assistant should work, then save to activate it.'}
        </div>
      ) : null}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-assistant-prompt-editor={assistant.id}
        className="min-h-[360px] w-full resize-y bg-transparent px-3 py-3 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
        spellCheck={false}
        placeholder={copy.promptPlaceholder?.(assistant.name) ?? `# ${assistant.name}\n\n## Role\n\nDescribe how this assistant should help.`}
      />
      <div className="flex items-center justify-end gap-2 border-t border-border/45 p-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!hasChanges || saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={12} />
          {copy.resetDefault}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {copy.saveDraft}
        </button>
      </div>
    </section>
  );
}

function ProfileInspectorPanel({
  assistant,
  edit,
  hasChanges,
  saving,
  copy,
  onChange,
  onSave,
  onDiscard,
}: {
  assistant: AssistantView;
  edit: ProfileEdit;
  hasChanges: boolean;
  saving: boolean;
  copy: PresetsCopy;
  onChange: (next: ProfileEdit) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="rounded-lg border border-border/55 bg-background/60 p-3">
      <PanelLabel icon={<UserRound size={13} />} label={copy.profileSection ?? DEFAULT_PROFILE_SECTION} />
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.nameLabel ?? 'Name'}</span>
          <input
            value={edit.name}
            onChange={(event) => onChange({ ...edit, name: event.target.value })}
            data-assistant-profile-name={assistant.id}
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.descLabel ?? 'Description'}</span>
          <textarea
            value={edit.description}
            onChange={(event) => onChange({ ...edit, description: event.target.value })}
            data-assistant-profile-description={assistant.id}
            className="min-h-[78px] w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.preferredAgentLabel ?? 'Preferred agent'}</span>
          <input
            value={edit.preferredAgent}
            onChange={(event) => onChange({ ...edit, preferredAgent: event.target.value })}
            data-assistant-profile-agent={assistant.id}
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.skillsTitle}</span>
          <textarea
            value={edit.skillsText}
            onChange={(event) => onChange({ ...edit, skillsText: event.target.value })}
            data-assistant-profile-skills={assistant.id}
            className="min-h-[70px] w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="mindos"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">{copy.mcpTitle ?? 'MCP'}</span>
          <textarea
            value={edit.mcpText}
            onChange={(event) => onChange({ ...edit, mcpText: event.target.value })}
            data-assistant-profile-mcp={assistant.id}
            className="min-h-[70px] w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="arxiv"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!hasChanges || saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={12} />
          {copy.resetDefault}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || saving}
          data-assistant-profile-save={assistant.id}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {copy.saveProfile ?? 'Save profile'}
        </button>
      </div>
    </section>
  );
}

function ResourceInspectorPanel({ assistant, copy }: { assistant: AssistantView; copy: PresetsCopy }) {
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border/55 bg-background/60 p-3">
        <PanelLabel icon={<Route size={13} />} label={copy.preferredAgentLabel ?? 'Preferred agent'} />
        <p className="mt-3 rounded-lg bg-muted/25 px-3 py-2 font-mono text-xs text-foreground/85">
          {assistant.preferredAgent ?? copy.systemModelDefault ?? 'mindos-agent'}
        </p>
      </section>
      <InspectorResourceList icon={<Sparkles size={13} />} title={copy.skillsTitle} items={assistant.skills} emptyText={copy.notDefinedYet ?? 'Not defined yet.'} />
      <InspectorResourceList icon={<Database size={13} />} title={copy.mcpTitle ?? 'MCP'} items={assistant.mcp} emptyText={copy.notDefinedYet ?? 'Not defined yet.'} />
    </div>
  );
}

function InspectorResourceList({
  icon,
  title,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <section className="rounded-lg border border-border/55 bg-background/60 p-3">
      <PanelLabel icon={icon} label={title} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.length > 0 ? items.map(item => (
          <span key={item} className="rounded-md border border-border/45 bg-muted/25 px-2 py-1 font-mono text-2xs text-foreground/80">
            {item}
          </span>
        )) : (
          <p className="rounded-lg bg-muted/25 px-3 py-2 text-xs text-muted-foreground/65">{emptyText}</p>
        )}
      </div>
    </section>
  );
}

function InspectorFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground/60">{label}</dt>
      <dd className={`min-w-0 truncate text-foreground/85 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  );
}

function AssistantStateCard({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/45 p-8 text-center shadow-sm">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background text-[var(--amber)]">
        {icon}
      </div>
      <h2 className="mt-3 text-base font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={13} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function RunResultCard({
  result,
  copy,
}: {
  result: { output?: string; error?: string };
  copy: PresetsCopy;
}) {
  const failed = Boolean(result.error);
  return (
    <section className={`rounded-xl border p-4 shadow-sm ${
      failed ? 'border-destructive/25 bg-destructive/[0.04]' : 'border-success/25 bg-success/[0.04]'
    }`}>
      <PanelLabel
        icon={failed ? <AlertCircle size={13} /> : <Play size={13} />}
        label={failed ? copy.runFailed ?? 'Run failed' : copy.runCompleted ?? 'Run completed'}
      />
      <p className={`mt-3 whitespace-pre-wrap text-sm leading-relaxed ${
        failed ? 'text-destructive' : 'text-foreground/80'
      }`}>
        {result.error || result.output || (copy.runCompleted ?? 'Assistant run completed')}
      </p>
    </section>
  );
}

function AssistantDetailSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      <div className="rounded-xl border border-border/60 bg-card/45 p-5">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-44 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-40 rounded-xl border border-border/60 bg-card/45" />
        <div className="h-40 rounded-xl border border-border/60 bg-card/45" />
      </div>
    </div>
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

type PromptDetails = {
  promptTitle?: string;
  promptPreview: string;
  sections: AssistantPromptSections;
};

function toAssistantView(assistant: MindosAssistantLibraryItem): AssistantView {
  const promptPayload = typeof assistant.prompt === 'string'
    ? { exists: assistant.promptReady, content: assistant.prompt }
    : assistant.prompt;
  const promptContent = promptPayload.content ?? '';
  const promptDetails = parsePromptDetails(promptContent);
  const source = assistant.source ?? (isBuiltinAssistantId(assistant.id) ? 'builtin' : 'custom');
  return {
    ...assistant,
    prompt: promptPayload,
    source,
    deletable: assistant.deletable ?? source === 'custom',
    paths: assistant.paths ?? {
      root: assistant.profilePath.replace(/\/profile\.json$/, ''),
      profile: assistant.profilePath,
      prompt: assistant.promptPath,
    },
    skills: Array.isArray(assistant.skills) ? assistant.skills : [],
    mcp: Array.isArray(assistant.mcp) ? assistant.mcp : [],
    promptContent,
    promptPreview: promptDetails.promptPreview || assistant.promptPreview,
    ...(assistant.promptTitle || promptDetails.promptTitle
      ? { promptTitle: assistant.promptTitle ?? promptDetails.promptTitle }
      : {}),
    sections: promptDetails.sections,
  };
}

function isBuiltinAssistantId(assistantId: string): boolean {
  return new Set([
    'inbox-organizer',
    'dreaming',
    'daily-signal',
    'decision-synthesizer',
    'rule-keeper',
    'boundary-reviewer',
    'method-organizer',
    'checklist-builder',
    'tool-inventory',
    'resource-auditor',
  ]).has(assistantId);
}

function deriveAssistantDescription(assistant: AssistantView, promptDetails: PromptDetails): string {
  const descriptionLooksPromptDerived = assistant.description === assistant.sections.role
    || assistant.description === assistant.promptPreview
    || assistant.description === 'Local assistant profile.';
  if (!descriptionLooksPromptDerived) return assistant.description;
  return promptDetails.sections.role || promptDetails.promptPreview || assistant.description;
}

function parsePromptDetails(prompt: string): PromptDetails {
  const body = stripLeadingFrontmatter(prompt);
  return {
    promptTitle: extractPromptTitle(body),
    promptPreview: makePreview(body),
    sections: parsePromptSections(body),
  };
}

function stripLeadingFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return content.trim();
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return content.trim();
  return normalized.slice(end + 4).replace(/^\n+/, '').trim();
}

function extractPromptTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return sanitizeInline(match?.[1], 100);
}

function parsePromptSections(content: string): AssistantPromptSections {
  const role = sectionText(content, 'Role');
  const output = sectionText(content, 'Output');
  return {
    ...(role ? { role } : {}),
    inputs: sectionList(content, 'Inputs'),
    ...(output ? { output } : {}),
    boundaries: sectionList(content, 'Boundaries'),
  };
}

function sectionText(content: string, heading: string): string | undefined {
  const raw = sectionBody(content, heading);
  if (!raw) return undefined;
  return makePreview(raw.replace(/^-+\s+/gm, ''), 280);
}

function sectionList(content: string, heading: string): string[] {
  const raw = sectionBody(content, heading);
  if (!raw) return [];
  const bullets = raw
    .split(/\n/)
    .map((line) => line.trim().match(/^[-*]\s+(.+)$/)?.[1])
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (bullets.length > 0) return bullets.slice(0, 8);
  const preview = makePreview(raw, 180);
  return preview ? [preview] : [];
}

function sectionBody(content: string, heading: string): string | undefined {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text || undefined;
}

function makePreview(content: string, maxLength = 180): string {
  const normalized = content
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function sanitizeInline(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function splitListText(value: string): string[] {
  return Array.from(new Set(value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)))
    .slice(0, 12);
}

function slugifyAssistantId(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function titleizeAssistantId(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Assistant';
}

async function runPromptAssistant(assistant: AssistantView): Promise<string> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'agent',
      runtimeOptions: { permissionMode: 'readonly' },
      messages: [{
        role: 'user',
        content: buildAssistantRunPrompt(assistant),
      }],
    }),
  });
  if (!res.ok) throw new Error(`Assistant run failed (${res.status})`);
  return readAskTextResponse(res);
}

async function runDedicatedAssistant(assistant: AssistantView): Promise<string> {
  const res = await fetch('/api/assistant-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistantId: assistant.id,
      trigger: 'manual',
    }),
  });
  const payload = await res.json().catch(() => null) as {
    ok?: boolean;
    error?: { message?: unknown };
    run?: {
      scope?: unknown;
      proposals?: unknown[];
      lint?: { healthScore?: unknown };
    };
    artifacts?: {
      reportMarkdown?: unknown;
      pendingJson?: unknown;
    };
  } | null;
  if (!res.ok || payload?.ok !== true) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Assistant run failed (${res.status})`;
    throw new Error(message);
  }

  const proposalCount = Array.isArray(payload.run?.proposals) ? payload.run.proposals.length : 0;
  const healthScore = typeof payload.run?.lint?.healthScore === 'number'
    ? payload.run.lint.healthScore
    : null;
  const scope = typeof payload.run?.scope === 'string' ? payload.run.scope : 'all';
  const reportPath = typeof payload.artifacts?.reportMarkdown === 'string'
    ? payload.artifacts.reportMarkdown
    : '.mindos/dreaming/dreaming-report.md';
  const pendingPath = typeof payload.artifacts?.pendingJson === 'string'
    ? payload.artifacts.pendingJson
    : '.mindos/dreaming/pending.json';
  return [
    `Dreaming completed for ${scope}.`,
    `${proposalCount} review proposal(s) generated${healthScore === null ? '' : `, health ${healthScore}/100`}.`,
    `Report: ${reportPath}`,
    `Pending review: ${pendingPath}`,
  ].join('\n');
}

function buildAssistantRunPrompt(assistant: AssistantView): string {
  return `Run the local MindOS Assistant "${assistant.name}" (${assistant.id}) in readonly mode.

Use this assistant profile:
- preferredAgent: ${assistant.preferredAgent ?? 'mindos-agent'}
- skills: ${assistant.skills.length > 0 ? assistant.skills.join(', ') : 'none'}
- mcp: ${assistant.mcp.length > 0 ? assistant.mcp.join(', ') : 'none'}

Assistant prompt:

${assistant.promptContent || assistant.promptPreview}

Return a concise result for the user. Do not write files or make external changes unless a later run explicitly grants a stronger permission mode.`;
}

async function readAskTextResponse(res: Response): Promise<string> {
  if (!res.body) {
    return typeof res.text === 'function' ? res.text() : '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const event = JSON.parse(raw) as { type?: string; delta?: string; error?: string };
        if (event.type === 'text_delta' && typeof event.delta === 'string') output += event.delta;
        if (event.type === 'error' && event.error) throw new Error(event.error);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  return output.trim();
}

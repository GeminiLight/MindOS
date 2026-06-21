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
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { buildAssistantAgentTurnRequestBody } from '@/lib/assistant-runner';
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
  version?: number;
  mode?: string;
  runtime?: string;
  model?: string;
  permissionMode?: string;
  permission?: string;
  hidden?: boolean;
  color?: string;
  steps?: number;
  format?: 'markdown' | 'legacy-directory';
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
  runOutputLabel?: string;
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
      preferredAgent: selected.runtime ?? selected.preferredAgent ?? 'mindos-agent',
      skillsText: selected.skills.join('\n'),
      mcpText: selected.mcp.join('\n'),
    }
    : null;
  const promptValue = selected ? promptEdits[selected.id] ?? selected.promptContent : '';
  const hasPromptChanges = Boolean(selected && promptValue !== selected.promptContent);
  const hasProfileChanges = Boolean(selected && profileEdit && (
    profileEdit.name !== selected.name
    || profileEdit.description !== selected.description
    || profileEdit.preferredAgent !== (selected.runtime ?? selected.preferredAgent ?? 'mindos-agent')
    || (!isMarkdownAssistant(selected) && profileEdit.skillsText !== selected.skills.join('\n'))
    || (!isMarkdownAssistant(selected) && profileEdit.mcpText !== selected.mcp.join('\n'))
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
          content: isMarkdownAssistant(selected)
            ? serializeAssistantMarkdownForSave(selected, profileEdit, promptValue)
            : promptValue,
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
  }, [copy.saveFailed, copy.saved, profileEdit, promptValue, selected, updateSelectedAssistant]);

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
        preferredAgent: profileEdit.preferredAgent.trim() || (isMarkdownAssistant(selected) ? 'mindos' : 'mindos-agent'),
        skills: splitListText(profileEdit.skillsText),
        mcp: splitListText(profileEdit.mcpText),
      };
      const content = isMarkdownAssistant(selected)
        ? serializeAssistantMarkdownForSave(selected, profileEdit, promptValue)
        : `${JSON.stringify({ ...payload, schemaVersion: 1 }, null, 2)}\n`;
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'save_file',
          path: selected.profilePath,
          content,
          source: 'user',
        }),
      });
      if (!res.ok) throw new Error(`Profile save failed (${res.status})`);
      updateSelectedAssistant(selected.id, {
        name: payload.name,
        description: payload.description || selected.sections.role || selected.promptPreview || selected.description,
        preferredAgent: isMarkdownAssistant(selected) ? runtimeToPreferredAgent(payload.preferredAgent) : payload.preferredAgent,
        runtime: isMarkdownAssistant(selected) ? normalizeRuntimeForSave(payload.preferredAgent) : selected.runtime,
        skills: isMarkdownAssistant(selected) ? selected.skills : payload.skills,
        mcp: isMarkdownAssistant(selected) ? selected.mcp : payload.mcp,
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
  }, [copy.profileSaved, copy.saveFailed, copy.saved, profileEdit, promptValue, selected, updateSelectedAssistant]);

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
      const output = await runAssistantRun(assistant);
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
          runtime: 'mindos',
          model: 'default',
          permissionMode: 'ask',
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
      <div data-assistant-shell className="overflow-hidden rounded-xl border border-border/60 bg-card/30 shadow-sm">
        <AssistantLibraryToolbar
          copy={copy}
          counts={counts}
          filteredCount={filteredAssistants.length}
          query={query}
          filter={filter}
          creating={creating}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onToggleCreate={() => setCreating(current => !current)}
        />

        {creating ? (
          <div className="border-b border-border/55 bg-[var(--amber)]/[0.025] p-4">
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
          </div>
        ) : null}

        <div className="2xl:grid 2xl:min-h-[690px] 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <AssistantDirectory
            copy={copy}
            loading={loading}
            error={error}
            counts={counts}
            filteredCount={filteredAssistants.length}
            groupedAssistants={groupedAssistants}
            selectedId={selected?.id}
            onRetry={loadAssistants}
            hasQuery={query.trim().length > 0}
            onSelect={(assistantId) => {
              setSelectedId(assistantId);
              setSection('overview');
            }}
            runningAssistantId={runningAssistantId}
            deletingAssistantId={deletingAssistantId}
          />

          <main className="min-w-0 border-t border-border/55 bg-background/35 2xl:border-l 2xl:border-t-0">
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
    </div>
  );
}

function AssistantLibraryToolbar({
  copy,
  counts,
  filteredCount,
  query,
  filter,
  creating,
  onQueryChange,
  onFilterChange,
  onToggleCreate,
}: {
  copy: PresetsCopy;
  counts: AssistantCounts;
  filteredCount: number;
  query: string;
  filter: AssistantFilter;
  creating: boolean;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: AssistantFilter) => void;
  onToggleCreate: () => void;
}) {
  const filterOptions: Array<{ value: AssistantFilter; label: string; count: number }> = [
    { value: 'all', label: copy.filterAll ?? 'All assistants', count: counts.total },
    { value: 'builtin', label: copy.filterBuiltin ?? copy.builtinLabel ?? 'Built-in', count: counts.builtin },
    { value: 'custom', label: copy.filterCustom ?? copy.customLabel ?? 'Custom', count: counts.custom },
  ];

  return (
    <header
      data-assistant-command-center
      className="border-b border-border/55 bg-card/45 px-4 py-3.5 lg:px-5"
    >
      <div
        data-assistant-command-grid
        className="grid gap-3 2xl:grid-cols-[minmax(210px,0.72fr)_minmax(330px,0.95fr)_minmax(260px,1fr)] 2xl:items-center"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber)]">
            <FolderLock size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{copy.presetRail}</p>
              <span className="rounded-md bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                {filteredCount}/{counts.total}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--amber-text)]">
              {copy.localRoot ?? 'Local Assistant Library'}
            </p>
            <p className="sr-only">{copy.localRootHint}</p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter assistants"
          className="grid grid-cols-[1.55fr_1fr_1fr] gap-1 rounded-lg border border-border/55 bg-background/55 p-1"
        >
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

        <div
          data-assistant-command-actions
          className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] 2xl:justify-end"
        >
          <label className="relative min-w-0 2xl:w-[min(30vw,320px)]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/55" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label={copy.searchPlaceholder ?? 'Search assistants'}
              placeholder={copy.searchPlaceholder ?? 'Search assistants...'}
              className="h-9 w-full rounded-lg border border-border bg-background/75 pl-8 pr-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus-visible:border-[var(--amber)]/45 focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={12} />
              </button>
            ) : null}
          </label>

          <button
            type="button"
            onClick={onToggleCreate}
            aria-expanded={creating}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/[0.06] px-3 text-xs font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {creating ? <X size={13} /> : <Plus size={13} />}
            {copy.newAssistant ?? 'New Assistant'}
          </button>
        </div>
      </div>
      <p className="sr-only">{copy.libraryHint}</p>
    </header>
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
      className={`inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'bg-background text-[var(--amber-text)] shadow-sm'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
        active ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)]' : 'bg-muted/55 text-muted-foreground/75'
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
    <section data-assistant-create-composer className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/[0.04] p-4">
      <div
        data-assistant-create-fields
        className="grid gap-3 2xl:grid-cols-[minmax(160px,0.75fr)_minmax(200px,1fr)_minmax(240px,1.3fr)_auto] 2xl:items-end"
      >
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
  onRetry,
  hasQuery,
  onSelect,
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
  onRetry: () => void;
  hasQuery: boolean;
  onSelect: (assistantId: string) => void;
  runningAssistantId: string | null;
  deletingAssistantId: string | null;
}) {
  return (
    <aside data-assistant-command-column="library" className="min-w-0 bg-card/25">
      <div className="max-h-[calc(100vh-230px)] min-h-[420px] overflow-y-auto">
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
            hint={hasQuery ? copy.noMatchesHint ?? 'Try a different name, ID, skill, or MCP filter.' : copy.emptyHint ?? 'Create an Assistant profile to add one.'}
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
  runningAssistantId,
  deletingAssistantId,
}: {
  title: string;
  count: number;
  assistants: AssistantView[];
  copy: PresetsCopy;
  selectedId?: string;
  onSelect: (assistantId: string) => void;
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
            protectedLabel={copy.protectedLabel ?? 'Protected'}
            runningLabel={copy.runningLabel ?? 'Running'}
            deleting={deletingAssistantId === assistant.id}
            running={runningAssistantId === assistant.id}
            onClick={() => onSelect(assistant.id)}
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
  const permissionLabel = formatAssistantPermission(assistantPermissionMode(assistant), copy);

  return (
    <article data-assistant-command-column="workspace" className="min-h-full bg-background/30">
      <div className="border-b border-border/55 px-5 py-5 lg:px-6">
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-start">
          <div className="flex min-w-0 items-start gap-3.5">
            <AssistantAvatar assistant={assistant} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
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
              <p className="mt-2 max-w-[74ch] text-sm leading-6 text-muted-foreground">
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

          <AssistantDetailActions
            assistant={assistant}
            deleting={deleting}
            running={running}
            copy={copy}
            onRun={onRun}
            onDelete={onDelete}
          />
        </div>

        <div className="mt-5 grid gap-2 border-t border-border/45 pt-4 sm:grid-cols-2 2xl:grid-cols-4">
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
          <DetailMetaItem
            icon={<ShieldCheck size={13} />}
            label={copy.contractTitle}
            value={permissionLabel}
            tone={assistant.promptReady ? 'ready' : 'warn'}
          />
          <DetailMetaItem
            icon={<Database size={13} />}
            label={copy.outputTitle ?? 'Output'}
            value={copy.runOutputLabel ?? 'Chat / local run history'}
          />
        </div>
      </div>

      <nav className="border-b border-border/55 px-5 lg:px-6">
        <div className="flex min-w-0 gap-5 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={section === tab.id}
              data-assistant-section-tab={tab.id}
              onClick={() => onSectionChange(tab.id)}
              className={`relative inline-flex h-12 shrink-0 items-center justify-center gap-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                section === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
              <span
                className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full ${
                  section === tab.id ? 'bg-[var(--amber)]' : 'bg-transparent'
                }`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </nav>

      <div className="min-h-[500px] p-5 lg:p-6">
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

function AssistantDetailActions({
  assistant,
  deleting,
  running,
  copy,
  onRun,
  onDelete,
}: {
  assistant: AssistantView;
  deleting: boolean;
  running: boolean;
  copy: PresetsCopy;
  onRun: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-assistant-detail-actions={assistant.id}
      className="flex flex-wrap items-center gap-2 2xl:w-40 2xl:flex-col 2xl:items-stretch"
    >
      <button
        type="button"
        onClick={onRun}
        disabled={!assistant.promptReady || running}
        data-assistant-run={assistant.id}
        className="inline-flex h-10 min-w-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--amber)] px-4 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:w-full"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        {running ? copy.runningLabel ?? 'Running' : copy.launchTitle}
      </button>
      {assistant.deletable ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          data-assistant-delete={assistant.id}
          className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:w-full"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          {copy.deleteAssistant ?? 'Delete'}
        </button>
      ) : null}
    </div>
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
    <div className="min-w-0 rounded-lg border border-border/45 bg-background/45 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/58">
        <span className={iconClass}>{icon}</span>
        {label}
      </div>
      <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-foreground/85">{value}</p>
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
  protectedLabel,
  runningLabel,
  deleting,
  running,
  onClick,
}: {
  assistant: AssistantView;
  active: boolean;
  readyLabel: string;
  needsPromptLabel: string;
  sourceLabel: string;
  protectedLabel: string;
  runningLabel: string;
  deleting: boolean;
  running: boolean;
  onClick: () => void;
}) {
  const summary = assistant.sections.role || assistant.description || assistant.promptPreview;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-assistant-library-row={assistant.id}
      className={`group relative flex min-w-0 items-start gap-3 border-b border-border/45 px-4 py-3 text-left outline-none transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-[var(--amber-subtle)]/80' : ''
      }`}
    >
      <span
        className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-r-full transition-colors ${
          active ? 'bg-[var(--amber)]' : 'bg-transparent'
        }`}
        aria-hidden="true"
      />
      <AssistantAvatar assistant={assistant} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{assistant.name}</span>
          <ReadinessPill ready={assistant.promptReady} readyLabel={readyLabel} needsPromptLabel={needsPromptLabel} compact />
        </span>
        <span className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground/68">
          {summary}
        </span>
        <span className="mt-2 flex min-w-0 items-center gap-2 text-[10px] font-medium text-muted-foreground/50">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck size={10} />
            {sourceLabel}
          </span>
          {(running || deleting) ? (
            <span className="inline-flex items-center gap-1 text-[var(--amber-text)]">
              <Loader2 size={10} className="animate-spin" />
              {running ? runningLabel : protectedLabel}
            </span>
          ) : null}
        </span>
      </span>
    </button>
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

function AssistantDetailSkeleton() {
  return (
    <div className="space-y-4 p-5 animate-pulse" aria-busy="true">
      <div className="border-b border-border/55 pb-5">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-44 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-14 rounded-lg border border-border/45 bg-background/45" />
        <div className="h-14 rounded-lg border border-border/45 bg-background/45" />
        <div className="h-14 rounded-lg border border-border/45 bg-background/45" />
        <div className="h-14 rounded-lg border border-border/45 bg-background/45" />
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
      root: assistant.profilePath.endsWith('.md')
        ? assistant.profilePath.replace(/\/[^/]+\.md$/, '')
        : assistant.profilePath.replace(/\/profile\.json$/, ''),
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
  ]).has(assistantId);
}

function isMarkdownAssistant(assistant: AssistantView): boolean {
  return assistant.format === 'markdown'
    || (assistant.promptPath === assistant.profilePath && assistant.promptPath.endsWith('.md'));
}

function serializeAssistantMarkdownForSave(
  assistant: AssistantView,
  edit: ProfileEdit | null,
  promptBody: string,
): string {
  const profile = {
    name: edit?.name.trim() || assistant.name,
    description: edit?.description.trim() || assistant.description || assistant.promptPreview,
    version: assistant.version && Number.isInteger(assistant.version) && assistant.version > 0 ? assistant.version : 1,
    mode: assistant.mode === 'subagent' ? 'subagent' : 'subagent',
    runtime: normalizeRuntimeForSave(edit?.preferredAgent || assistant.runtime || assistant.preferredAgent || 'mindos'),
    model: assistant.model || 'default',
    permissionMode: normalizePermissionForSave(assistantPermissionMode(assistant)),
    hidden: Boolean(assistant.hidden),
    color: assistant.color || 'amber',
    steps: assistant.steps && Number.isInteger(assistant.steps) && assistant.steps > 0 ? assistant.steps : 12,
  };
  const lines = [
    ['name', profile.name],
    ['description', profile.description],
    ['version', profile.version],
    ['mode', profile.mode],
    ['runtime', profile.runtime],
    ['model', profile.model],
    ['permissionMode', profile.permissionMode],
    ['hidden', profile.hidden],
    ['color', profile.color],
    ['steps', profile.steps],
  ] as const;
  return `---\n${lines.map(([key, value]) => `${key}: ${formatFrontmatterScalar(value)}`).join('\n')}\n---\n\n${promptBody.trim()}\n`;
}

function normalizeRuntimeForSave(value: string): string {
  const normalized = value.trim() || 'mindos';
  if (normalized === 'mindos-agent') return 'mindos';
  if (normalized === 'claude') return 'claude-code';
  return normalized;
}

function runtimeToPreferredAgent(runtime: string): string {
  return normalizeRuntimeForSave(runtime) === 'mindos' ? 'mindos-agent' : normalizeRuntimeForSave(runtime);
}

function normalizePermissionForSave(value: string | undefined): string {
  return value === 'read' || value === 'ask' || value === 'auto' || value === 'full' ? value : 'ask';
}

function assistantPermissionMode(assistant: AssistantView): string {
  return normalizePermissionForSave(assistant.permissionMode ?? assistant.permission);
}

function formatFrontmatterScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value) && !/^(true|false|null)$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
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

function formatAssistantPermission(value: string | undefined, copy: PresetsCopy): string {
  const protectedLabel = copy.protectedLabel ?? 'Protected';
  switch (value) {
    case 'read':
      return `${protectedLabel} · readonly`;
    case 'auto':
      return `${copy.readyLabel ?? 'Ready'} · auto`;
    case 'full':
      return `${copy.readyLabel ?? 'Ready'} · full`;
    case 'ask':
    default:
      return `${protectedLabel} · ask`;
  }
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

async function runAssistantRun(assistant: AssistantView): Promise<string> {
  const requestBody = assistant.id === 'dreaming'
    ? {
      assistantId: assistant.id,
      trigger: 'manual',
    }
    : buildAssistantAgentTurnRequestBody({
      assistantId: assistant.id,
      permissionMode: 'read',
      messages: [{
        role: 'user',
        content: buildAssistantRunPrompt(assistant),
      }],
    });

  const res = await fetch('/api/assistant-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) throw new Error(`Assistant run failed (${res.status})`);
  return readAskTextResponse(res);
}

function buildAssistantRunPrompt(assistant: AssistantView): string {
  return `Run the local MindOS Assistant "${assistant.name}" (${assistant.id}) in read mode.

Use this assistant profile:
- preferredAgent: ${assistant.preferredAgent ?? 'mindos-agent'}
- skills: ${assistant.skills.length > 0 ? assistant.skills.join(', ') : 'none'}
- mcp: ${assistant.mcp.length > 0 ? assistant.mcp.join(', ') : 'none'}

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
        const event = JSON.parse(raw) as { type?: string; delta?: string; error?: string; message?: string };
        if (event.type === 'text_delta' && typeof event.delta === 'string') output += event.delta;
        if (event.type === 'error' && event.error) throw new Error(event.error);
        if (event.type === 'error' && event.message) throw new Error(event.message);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  return output.trim();
}

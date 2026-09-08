'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  Bot,
  AlertCircle,
  BriefcaseBusiness,
  ChevronDown,
  X,
  FolderOpen,
  Layers3,
  Loader2,
} from 'lucide-react';
import PathAutocompleteField from '@/components/shared/PathAutocompleteField';
import {
  addUniqueContextItem,
  contextChipLabel,
  contextItemIcon,
  contextPathLabel,
  ContextSelectionRow,
  type ContextSelectableItem,
} from '@/components/shared/ContextTokenPicker';
import type {
  ChatSession,
  ContextAssistantRef,
  ContextSpaceRef,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import {
  getEffectiveSessionContextSelection,
  getEffectiveSessionWorkDir,
  normalizeSessionContextSelectionForClient,
} from '@/lib/session-context';
import { openMindPathInFileManager } from '@/lib/open-in-file-manager';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

type SessionContextLabels = {
  title: string;
  workDir: string;
  spaces: string;
  assistants: string;
  mindRoot: string;
  none: string;
  locked: string;
  openRootInFileManager: string;
  openRootInFileManagerFailed: string;
  editWorkDir: string;
  workDirPlaceholder: string;
  workDirBrowse: string;
  workDirBrowseUnavailable: string;
  addSpace: string;
  addAssistant: string;
  searchSpaces: string;
  searchAssistants: string;
  noMatches: string;
  removeItem: (label: string) => string;
  spacePlaceholder: string;
  assistantPlaceholder: string;
  applyNextTurn: string;
  spacesCount: (n: number) => string;
  assistantsCount: (n: number) => string;
  loadingSpaces: string;
  loadSpacesFailed: string;
  retrySpaces: string;
  close: string;
};

type SessionContextDockProps = {
  session: ChatSession | null;
  labels?: Partial<SessionContextLabels>;
  workDirEditable: boolean;
  compact?: boolean;
  onSetWorkDir: (workDir: SessionWorkDir) => boolean;
  onSetContextSelection: (selection: SessionContextSelection) => boolean;
};

const DEFAULT_LABELS: SessionContextLabels = {
  title: 'Context',
  workDir: 'Root',
  spaces: 'Spaces',
  assistants: 'Assistants',
  mindRoot: 'Mind',
  none: 'None',
  locked: 'Locked after first message',
  openRootInFileManager: 'Open root in file manager',
  openRootInFileManagerFailed: 'Could not open root folder',
  editWorkDir: 'Set root',
  workDirPlaceholder: '/path/to/root',
  workDirBrowse: 'Choose root',
  workDirBrowseUnavailable: 'Folder picker is available in the desktop app',
  addSpace: 'Add Space',
  addAssistant: 'Add Assistant',
  searchSpaces: 'Search spaces',
  searchAssistants: 'Search assistants',
  noMatches: 'No matches',
  removeItem: (label) => `Remove ${label}`,
  spacePlaceholder: 'Space path',
  assistantPlaceholder: 'assistant-id',
  applyNextTurn: 'Changes apply to the next message.',
  spacesCount: (n) => `${n} space${n === 1 ? '' : 's'}`,
  assistantsCount: (n) => `${n} assistant${n === 1 ? '' : 's'}`,
  loadingSpaces: 'Loading spaces…',
  loadSpacesFailed: 'Could not load spaces. Try again.',
  retrySpaces: 'Retry loading spaces',
  close: 'Close context',
};

type PickerKind = 'spaces' | 'assistants';

type WorkspaceSpaceRecord = {
  name?: string;
  path: string;
  fileCount?: number;
  description?: string;
};

type SpaceCandidate = ContextSelectableItem & {
  spaceSource?: ContextSpaceRef['source'];
};

const BASE_ASSISTANT_CANDIDATES: ContextSelectableItem[] = [
  { id: 'inbox-organizer', label: 'Inbox Organizer', icon: 'I' },
  { id: 'dreaming', label: 'Dreaming', icon: 'D' },
];

function shortPath(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) ?? value;
}

function assistantToCandidate(assistant: ContextAssistantRef): ContextSelectableItem {
  const label = contextChipLabel(assistant) || assistant.id;
  return {
    id: assistant.id,
    label,
    icon: contextItemIcon(label),
  };
}

function isWorkspaceSpaceRecord(value: unknown): value is WorkspaceSpaceRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === 'string' && Boolean(record.path.trim())
    && (record.name === undefined || typeof record.name === 'string')
    && (record.description === undefined || typeof record.description === 'string');
}

function normalizeSpacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '').trim();
}

function workspaceSpaceToCandidate(space: WorkspaceSpaceRecord): SpaceCandidate | null {
  const spacePath = normalizeSpacePath(space.path);
  if (!spacePath) return null;
  const label = space.name?.trim() || contextPathLabel(spacePath);
  const description = space.description?.trim();
  return {
    id: spacePath,
    label,
    icon: contextItemIcon(label),
    spaceSource: 'filesystem',
    ...(description ? { description } : {}),
  };
}

function buildSpaceCandidates(workspaceSpaces: WorkspaceSpaceRecord[]): SpaceCandidate[] {
  const candidates = workspaceSpaces
    .map(workspaceSpaceToCandidate)
    .filter((item): item is SpaceCandidate => Boolean(item));
  return candidates.reduce<SpaceCandidate[]>(addUniqueContextItem, []);
}

function buildAssistantCandidates(selection: SessionContextSelection): ContextSelectableItem[] {
  return selection.assistants
    .map(assistantToCandidate)
    .reduce(addUniqueContextItem, BASE_ASSISTANT_CANDIDATES);
}

function addSpace(selection: SessionContextSelection, candidate: SpaceCandidate): SessionContextSelection {
  const path = candidate.id.trim().replace(/\\/g, '/');
  if (!path) return selection;
  return normalizeSessionContextSelectionForClient({
    ...selection,
    spaces: [
      ...selection.spaces,
      {
        path,
        label: candidate.label || contextPathLabel(path),
        icon: candidate.icon,
        source: candidate.spaceSource ?? 'manual',
      },
    ],
  });
}

function addAssistant(selection: SessionContextSelection, candidate: ContextSelectableItem): SessionContextSelection {
  const id = candidate.id.trim().toLowerCase();
  if (!id) return selection;
  return normalizeSessionContextSelectionForClient({
    ...selection,
    assistants: [
      ...selection.assistants,
      { id, name: candidate.label || id, kind: 'assistant', source: 'manual' },
    ],
  });
}

function workDirToDraftValue(workDir: SessionWorkDir | undefined): string {
  return workDir?.source === 'mind-root' ? '' : workDir?.path ?? '';
}

export default function SessionContextDock({
  session,
  labels,
  workDirEditable,
  compact = false,
  onSetWorkDir,
  onSetContextSelection,
}: SessionContextDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [workDirDraftState, setWorkDirDraftState] = useState({ key: '', value: '' });
  const [openPicker, setOpenPicker] = useState<PickerKind | null>(null);
  const [spaceQuery, setSpaceQuery] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const [workspaceSpaces, setWorkspaceSpaces] = useState<WorkspaceSpaceRecord[]>([]);
  const [spacesStatus, setSpacesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [spacesAttempt, setSpacesAttempt] = useState(0);
  const [isOpeningWorkDir, setIsOpeningWorkDir] = useState(false);
  const resolvedLabels = useMemo<SessionContextLabels>(() => ({
    ...DEFAULT_LABELS,
    ...labels,
  }), [labels]);

  const workDir = useMemo(() => session ? getEffectiveSessionWorkDir(session) : undefined, [session]);
  const selection = useMemo(() => session ? getEffectiveSessionContextSelection(session) : normalizeSessionContextSelectionForClient(null), [session]);
  const workDirDraftKey = `${session?.id ?? 'draft'}:${workDir?.source ?? 'mind-root'}:${workDir?.path ?? ''}`;
  const workDirDraft = workDirDraftState.key === workDirDraftKey
    ? workDirDraftState.value
    : workDirToDraftValue(workDir);
  const workDirDisplay = !workDir || workDir.source === 'mind-root'
    ? resolvedLabels.mindRoot
    : shortPath(workDir?.path, workDir?.label || resolvedLabels.mindRoot);
  const workDirInputPlaceholder = !workDir || workDir.source === 'mind-root'
    ? resolvedLabels.mindRoot
    : resolvedLabels.workDirPlaceholder;
  const spaceCandidates = useMemo(() => buildSpaceCandidates(workspaceSpaces), [workspaceSpaces]);
  const assistantCandidates = useMemo(() => buildAssistantCandidates(selection), [selection]);
  const spacesSummary = selection.spaces.length > 0
    ? selection.spaces.map((space) => contextChipLabel(space)).join(', ')
    : resolvedLabels.none;
  const assistantsSummary = selection.assistants.length > 0
    ? selection.assistants.map((assistant) => contextChipLabel(assistant)).join(', ')
    : resolvedLabels.none;

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const controller = new AbortController();
    setSpacesStatus('loading');

    async function loadWorkspaceSpaces() {
      try {
        const body = await apiFetch<{ spaces?: unknown }>('/api/file?op=list_spaces', { signal: controller.signal, timeout: 15_000 });
        if (cancelled) return;
        if (!Array.isArray(body.spaces) || !body.spaces.every(isWorkspaceSpaceRecord)) throw new Error('Invalid spaces response');
        setWorkspaceSpaces(body.spaces);
        setSpacesStatus('ready');
      } catch {
        if (!cancelled) setSpacesStatus('error');
      }
    }

    loadWorkspaceSpaces();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [expanded, spacesAttempt]);

  const setWorkDirDraft = (value: string) => {
    setWorkDirDraftState({ key: workDirDraftKey, value });
  };

  const commitWorkDir = (nextValue = workDirDraft) => {
    if (!workDirEditable) return;
    const trimmed = nextValue.trim();
    onSetWorkDir(trimmed
      ? {
        source: 'manual',
        path: trimmed,
        label: shortPath(trimmed, trimmed),
      }
      : {
        source: 'mind-root',
        label: resolvedLabels.mindRoot,
      });
  };

  const openCurrentWorkDir = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpeningWorkDir) return;

    setIsOpeningWorkDir(true);
    try {
      await openMindPathInFileManager(workDir?.source === 'manual' ? workDir.path : undefined);
    } catch {
      toast.error(resolvedLabels.openRootInFileManagerFailed, 4000);
    } finally {
      setIsOpeningWorkDir(false);
    }
  };

  const selectSpace = (candidate: ContextSelectableItem) => {
    const next = addSpace(selection, candidate);
    if (next !== selection && onSetContextSelection(next)) {
      setSpaceQuery('');
      setOpenPicker(null);
    }
  };

  const selectAssistant = (candidate: ContextSelectableItem) => {
    const next = addAssistant(selection, candidate);
    if (next !== selection && onSetContextSelection(next)) {
      setAssistantQuery('');
      setOpenPicker(null);
    }
  };

  const removeSpace = (path: string) => {
    onSetContextSelection({
      ...selection,
      spaces: selection.spaces.filter((space) => space.path !== path),
    });
  };

  const removeAssistant = (id: string) => {
    onSetContextSelection({
      ...selection,
      assistants: selection.assistants.filter((assistant) => assistant.id !== id),
    });
  };

  return (
    <div className="relative border-b border-border/30">
      <Popover.Root open={expanded} onOpenChange={open => { setExpanded(open); if (!open) setOpenPicker(null); }}>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} collisionAvoidance={{ side: 'shift', align: 'shift', fallbackAxisSide: 'none' }} className="z-50">
        <Popover.Popup
          className="flex w-[min(32rem,calc(100vw-1.5rem))] max-h-[var(--available-height)] flex-col overflow-hidden rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg focus-visible:outline-none"
        >
          <div className="mb-1 flex shrink-0 items-center justify-between gap-3 px-1">
            <Popover.Title className="text-sm font-medium">{resolvedLabels.title}</Popover.Title>
            <Popover.Close aria-label={resolvedLabels.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={16} /></Popover.Close>
          </div>
          <Popover.Description className="mb-3 shrink-0 px-1 text-xs leading-relaxed text-muted-foreground">{resolvedLabels.applyNextTurn}</Popover.Description>

          <div className="min-h-0 overflow-y-auto px-1 pb-1">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)_2.75rem] items-center gap-2 py-1">
            <div className="flex min-h-11 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <BriefcaseBusiness size={13} />
              <span>{resolvedLabels.workDir}</span>
            </div>
            <div className="min-w-0">
              {workDirEditable ? (
                <PathAutocompleteField
                  value={workDirDraft}
                  onChange={setWorkDirDraft}
                  onCommit={commitWorkDir}
                  commitOnSelect
                  placeholder={workDirInputPlaceholder}
                  ariaLabel={resolvedLabels.editWorkDir}
                  browseLabel={resolvedLabels.workDirBrowse}
                  browseUnavailableLabel={resolvedLabels.workDirBrowseUnavailable}
                  wrapperClassName="min-w-0"
                  inputClassName="h-11 rounded-lg border-border bg-background px-2.5 py-1 pr-11 text-sm"
                  browseButtonClassName="right-0 h-11 w-11 rounded-md"
                  suggestionsClassName="text-xs"
                  suggestionClassName="py-1.5 text-xs"
                />
              ) : (
                <div className="flex min-h-7 min-w-0 items-center gap-2 rounded-lg bg-muted/35 px-2 py-1">
                  <span className="truncate text-xs text-foreground" title={workDir?.path || workDirDisplay}>{workDirDisplay}</span>
                </div>
              )}
            </div>
            {workDirEditable ? (
                  <span aria-hidden="true" className="h-11 w-11 justify-self-end" />
            ) : (
              <button
                type="button"
                aria-label={resolvedLabels.openRootInFileManager}
                title={resolvedLabels.openRootInFileManager}
                disabled={isOpeningWorkDir}
                onClick={openCurrentWorkDir}
                className="inline-flex h-11 w-11 items-center justify-center justify-self-end rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              >
                {isOpeningWorkDir ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
              </button>
            )}
          </div>

          <ContextSelectionRow
            inlinePicker
            pickerFeedback={spacesStatus === 'loading' ? (
              <p role="status" className="px-2 py-3 text-xs text-muted-foreground">{resolvedLabels.loadingSpaces}</p>
            ) : spacesStatus === 'error' ? (
              <div className="px-2 py-2">
                <p role="alert" className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                  <AlertCircle size={14} className="shrink-0 text-error" aria-hidden />
                  <span>{resolvedLabels.loadSpacesFailed}</span>
                </p>
                <button type="button" aria-label={resolvedLabels.retrySpaces}
                  className="mt-1 min-h-11 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setSpacesStatus('loading'); setSpacesAttempt(value => value + 1); }}>
                  {resolvedLabels.retrySpaces}
                </button>
              </div>
            ) : undefined}
            kind="spaces"
            icon={<Layers3 size={13} />}
            label={resolvedLabels.spaces}
            addTitle={resolvedLabels.addSpace}
            emptyLabel={resolvedLabels.none}
            searchLabel={resolvedLabels.searchSpaces}
            noMatchesLabel={resolvedLabels.noMatches}
            query={spaceQuery}
            onQueryChange={setSpaceQuery}
            open={openPicker === 'spaces'}
            onOpenChange={(open) => setOpenPicker(open ? 'spaces' : null)}
            candidates={spaceCandidates}
            selectedIds={new Set(selection.spaces.map((space) => space.path))}
            onSelect={selectSpace}
            chips={selection.spaces.map((space) => ({
              id: space.path,
              label: contextChipLabel(space),
              icon: space.icon || contextItemIcon(contextChipLabel(space), 'S'),
              title: space.path,
              removeLabel: resolvedLabels.removeItem(contextChipLabel(space)),
              onRemove: () => removeSpace(space.path),
            }))}
          />

          <ContextSelectionRow
            inlinePicker
            kind="assistants"
            icon={<Bot size={13} />}
            label={resolvedLabels.assistants}
            addTitle={resolvedLabels.addAssistant}
            emptyLabel={resolvedLabels.none}
            searchLabel={resolvedLabels.searchAssistants}
            noMatchesLabel={resolvedLabels.noMatches}
            query={assistantQuery}
            onQueryChange={setAssistantQuery}
            open={openPicker === 'assistants'}
            onOpenChange={(open) => setOpenPicker(open ? 'assistants' : null)}
            candidates={assistantCandidates}
            selectedIds={new Set(selection.assistants.map((assistant) => assistant.id))}
            onSelect={selectAssistant}
            chips={selection.assistants.map((assistant) => ({
              id: assistant.id,
              label: contextChipLabel(assistant),
              icon: contextItemIcon(contextChipLabel(assistant), 'A'),
              title: assistant.id,
              removeLabel: resolvedLabels.removeItem(contextChipLabel(assistant)),
              onRemove: () => removeAssistant(assistant.id),
            }))}
          />
          </div>
        </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>

      <Popover.Trigger
        type="button"
        aria-label={resolvedLabels.title}
        aria-expanded={expanded}
        className={cn(
          'group flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact && 'px-2',
        )}
      >
        <span className="font-medium">{resolvedLabels.title}</span>
        <SummaryItem
          icon={<BriefcaseBusiness size={13} />}
          title={resolvedLabels.workDir}
          value={workDirDisplay}
          detail={workDir?.path}
          className="max-w-[46%] sm:max-w-[42%]"
        />
        {selection.spaces.length > 0 && <SummaryItem
          icon={<Layers3 size={13} />}
          title={resolvedLabels.spaces}
          value={resolvedLabels.spacesCount(selection.spaces.length)}
          detail={spacesSummary}
        />}
        {selection.assistants.length > 0 && <SummaryItem
          icon={<Bot size={13} />}
          title={resolvedLabels.assistants}
          value={resolvedLabels.assistantsCount(selection.assistants.length)}
          detail={assistantsSummary}
        />}
        <span className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground">
          <ChevronDown size={14} className={expanded ? 'rotate-180' : undefined} />
        </span>
      </Popover.Trigger>
      </Popover.Root>
    </div>
  );
}

function SummaryItem({
  icon,
  title,
  value,
  detail,
  className,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-muted-foreground transition-colors group-hover:border-border/35 group-hover:bg-background/35',
        className,
      )}
      title={detail || `${title}: ${value}`}
    >
      {icon}
      <span className="min-w-0 truncate font-normal text-foreground">
        {value}
      </span>
    </span>
  );
}

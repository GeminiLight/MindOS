'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  CircleHelp,
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
};

type PickerKind = 'spaces' | 'assistants';

type TrayPosition = {
  left: number;
  width: number;
  bottom: number;
  maxHeight: number;
};

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
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { path?: unknown }).path === 'string',
  );
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
  const rootRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [trayPosition, setTrayPosition] = useState<TrayPosition | null>(null);
  const [workDirDraftState, setWorkDirDraftState] = useState({ key: '', value: '' });
  const [openPicker, setOpenPicker] = useState<PickerKind | null>(null);
  const [spaceQuery, setSpaceQuery] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const [workspaceSpaces, setWorkspaceSpaces] = useState<WorkspaceSpaceRecord[]>([]);
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
    let cancelled = false;

    async function loadWorkspaceSpaces() {
      try {
        const response = await fetch('/api/file?op=list_spaces');
        if (!response.ok) return;
        const body = await response.json() as { spaces?: unknown };
        if (cancelled || !Array.isArray(body.spaces)) return;
        setWorkspaceSpaces(body.spaces.filter(isWorkspaceSpaceRecord));
      } catch {
        // Keep the built-in candidates available when the runtime cannot list spaces.
      }
    }

    loadWorkspaceSpaces();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (!expanded) return;

    const updateTrayPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || typeof window === 'undefined') return;

      const viewportPadding = 8;
      const gap = 8;
      const width = Math.min(rect.width, 720, window.innerWidth - viewportPadding * 2);
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - viewportPadding - width),
      );
      const bottom = Math.max(viewportPadding, window.innerHeight - rect.top + gap);
      const maxHeight = Math.max(120, rect.top - viewportPadding - gap);
      const next = { left, width, bottom, maxHeight };

      setTrayPosition((current) => (
        current
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.width - next.width) < 0.5
        && Math.abs(current.bottom - next.bottom) < 0.5
        && Math.abs(current.maxHeight - next.maxHeight) < 0.5
          ? current
          : next
      ));
    };

    updateTrayPosition();
    window.addEventListener('resize', updateTrayPosition);
    window.addEventListener('scroll', updateTrayPosition, true);
    return () => {
      window.removeEventListener('resize', updateTrayPosition);
      window.removeEventListener('scroll', updateTrayPosition, true);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || trayRef.current?.contains(target)) return;
      setOpenPicker(null);
      setExpanded(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [expanded]);

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

  const trayStyle: CSSProperties = trayPosition
    ? {
      left: trayPosition.left,
      width: trayPosition.width,
      bottom: trayPosition.bottom,
      maxHeight: trayPosition.maxHeight,
    }
    : { left: 0, width: 0, bottom: 0, visibility: 'hidden' };

  return (
    <div ref={rootRef} className="relative border-b border-border/30">
      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          ref={trayRef}
          className={cn(
            'fixed z-50 overflow-visible rounded-xl border border-border/45 bg-popover/95 p-2.5 text-popover-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/90',
            compact && 'p-2',
          )}
          style={trayStyle}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') return;
            if (openPicker) setOpenPicker(null);
            else setExpanded(false);
            event.stopPropagation();
          }}
        >
          <div className="mb-1 flex items-center justify-between gap-3 px-1">
            <div className="font-sans text-[11px] font-medium text-muted-foreground">{resolvedLabels.title}</div>
            <span
              role="img"
              aria-label={resolvedLabels.applyNextTurn}
              title={resolvedLabels.applyNextTurn}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/75"
            >
              <CircleHelp size={13} />
            </span>
          </div>

          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2 py-1">
            <div className="flex min-h-7 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
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
                  inputClassName="h-7 rounded-lg border-border/45 bg-background/70 px-2.5 py-1 pr-9 text-xs"
                  browseButtonClassName="right-1 h-6 w-6 rounded-md"
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
              <span aria-hidden="true" className="h-7 w-7 justify-self-end" />
            ) : (
              <button
                type="button"
                aria-label={resolvedLabels.openRootInFileManager}
                title={resolvedLabels.openRootInFileManager}
                disabled={isOpeningWorkDir}
                onClick={openCurrentWorkDir}
                className="inline-flex h-7 w-7 items-center justify-center justify-self-end rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              >
                {isOpeningWorkDir ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
              </button>
            )}
          </div>

          <ContextSelectionRow
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
        </div>,
        document.body,
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setExpanded(false);
        }}
        aria-label={resolvedLabels.title}
        aria-expanded={expanded}
        className={cn(
          'group flex min-h-9 w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact && 'px-2',
        )}
      >
        <SummaryItem
          icon={<BriefcaseBusiness size={13} />}
          title={resolvedLabels.workDir}
          value={workDirDisplay}
          detail={workDir?.path}
          className="max-w-[46%] sm:max-w-[42%]"
        />
        <SummaryItem
          icon={<Layers3 size={13} />}
          title={resolvedLabels.spaces}
          value={String(selection.spaces.length)}
          detail={spacesSummary}
        />
        <SummaryItem
          icon={<Bot size={13} />}
          title={resolvedLabels.assistants}
          value={String(selection.assistants.length)}
          detail={assistantsSummary}
        />
        <span className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground">
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
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
      <span className="hidden shrink-0 font-medium text-muted-foreground sm:inline">{title}</span>
      <span className="min-w-0 truncate font-normal text-foreground/90">
        {value}
      </span>
    </span>
  );
}

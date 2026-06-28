'use client';

import { Archive, GitFork, Pencil, Pin, PinOff } from 'lucide-react';
import type { MouseEvent } from 'react';
import { StableRowActionButton } from '@/components/shared/StableRowChrome';

export type SessionRowActionLabels = {
  pin?: string;
  unpin?: string;
  rename?: string;
  fork?: string;
  archive?: string;
};

type SessionRowActionsProps = {
  pinned?: boolean;
  labels?: SessionRowActionLabels;
  onTogglePin?: () => void;
  onRename?: () => void;
  onFork?: () => void;
  onArchive?: () => void;
  disabled?: boolean;
  archiveTone?: 'neutral' | 'danger';
};

function stopAndRun(event: MouseEvent<HTMLButtonElement>, action: (() => void) | undefined) {
  event.stopPropagation();
  action?.();
}

export function SessionRowActions({
  pinned = false,
  labels,
  onTogglePin,
  onRename,
  onFork,
  onArchive,
  disabled = false,
  archiveTone = 'neutral',
}: SessionRowActionsProps) {
  const pinLabel = pinned ? (labels?.unpin ?? 'Unpin') : (labels?.pin ?? 'Pin');
  const renameLabel = labels?.rename ?? 'Rename';
  const forkLabel = labels?.fork ?? 'Fork';
  const archiveLabel = labels?.archive ?? 'Archive';

  return (
    <>
      {onTogglePin && (
        <StableRowActionButton
          size="sm"
          tone="amber"
          active={pinned}
          disabled={disabled}
          onClick={(event) => stopAndRun(event, onTogglePin)}
          title={pinLabel}
          aria-label={pinLabel}
        >
          {pinned ? <PinOff size={11} aria-hidden="true" /> : <Pin size={11} aria-hidden="true" />}
        </StableRowActionButton>
      )}
      {onRename && (
        <StableRowActionButton
          size="sm"
          disabled={disabled}
          onClick={(event) => stopAndRun(event, onRename)}
          title={renameLabel}
          aria-label={renameLabel}
        >
          <Pencil size={11} aria-hidden="true" />
        </StableRowActionButton>
      )}
      {onFork && (
        <StableRowActionButton
          size="sm"
          disabled={disabled}
          onClick={(event) => stopAndRun(event, onFork)}
          title={forkLabel}
          aria-label={forkLabel}
        >
          <GitFork size={11} aria-hidden="true" />
        </StableRowActionButton>
      )}
      {onArchive && (
        <StableRowActionButton
          size="sm"
          tone={archiveTone}
          disabled={disabled}
          onClick={(event) => stopAndRun(event, onArchive)}
          title={archiveLabel}
          aria-label={archiveLabel}
        >
          <Archive size={11} aria-hidden="true" />
        </StableRowActionButton>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeAgentTaskDraft, type AgentTaskDraftInput } from '@/lib/agent-task-draft';
import {
  clearAgentTaskDraft,
  createEmptyAgentTaskDraft,
  loadAgentTaskDraft,
  saveAgentTaskDraft,
} from '@/lib/agent-task-draft-storage';

type AgentTaskDraftSaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

interface UseAgentTaskDraftOptions {
  saveDelayMs?: number;
}

export interface UseAgentTaskDraftResult {
  draft: AgentTaskDraftInput;
  loaded: boolean;
  saveStatus: AgentTaskDraftSaveStatus;
  saveError: string | null;
  updateDraft: (next: Partial<AgentTaskDraftInput>) => void;
  resetDraft: () => void;
}

export function useAgentTaskDraft(
  options: UseAgentTaskDraftOptions = {},
): UseAgentTaskDraftResult {
  const saveDelayMs = options.saveDelayMs ?? 350;
  const [draft, setDraft] = useState<AgentTaskDraftInput>(() => createEmptyAgentTaskDraft());
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<AgentTaskDraftSaveStatus>('loading');
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    let active = true;

    loadAgentTaskDraft()
      .then((storedDraft) => {
        if (!active) return;
        setDraft(storedDraft);
        lastPersistedSnapshotRef.current = snapshotDraft(storedDraft);
        setLoaded(true);
        setSaveStatus('saved');
        setSaveError(null);
      })
      .catch((error) => {
        if (!active) return;
        setLoaded(true);
        setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : 'Failed to load task draft');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const snapshot = snapshotDraft(draft);
    if (snapshot === lastPersistedSnapshotRef.current) return;

    setSaveStatus('saving');
    setSaveError(null);
    const saveSeq = ++saveSeqRef.current;
    const timer = setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current
        .catch(() => {})
        .then(() => saveAgentTaskDraft(draft));

      saveQueueRef.current
        .then(() => {
          if (!mountedRef.current || saveSeq !== saveSeqRef.current) return;
          lastPersistedSnapshotRef.current = snapshot;
          setSaveStatus('saved');
          setSaveError(null);
        })
        .catch((error) => {
          if (!mountedRef.current || saveSeq !== saveSeqRef.current) return;
          setSaveStatus('error');
          setSaveError(error instanceof Error ? error.message : 'Failed to save task draft');
        });
    }, saveDelayMs);

    return () => clearTimeout(timer);
  }, [draft, loaded, saveDelayMs]);

  const updateDraft = useCallback((next: Partial<AgentTaskDraftInput>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const resetDraft = useCallback(() => {
    const emptyDraft = createEmptyAgentTaskDraft();
    const emptySnapshot = snapshotDraft(emptyDraft);
    const saveSeq = ++saveSeqRef.current;
    lastPersistedSnapshotRef.current = emptySnapshot;
    setDraft(emptyDraft);
    setSaveStatus('saving');
    setSaveError(null);

    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => clearAgentTaskDraft());

    saveQueueRef.current
      .then(() => {
        if (!mountedRef.current || saveSeq !== saveSeqRef.current) return;
        setSaveStatus('saved');
        setSaveError(null);
      })
      .catch((error) => {
        if (!mountedRef.current || saveSeq !== saveSeqRef.current) return;
        setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : 'Failed to clear task draft');
      });
  }, []);

  return {
    draft,
    loaded,
    saveStatus,
    saveError,
    updateDraft,
    resetDraft,
  };
}

function snapshotDraft(draft: AgentTaskDraftInput): string {
  return JSON.stringify(normalizeAgentTaskDraft(draft));
}

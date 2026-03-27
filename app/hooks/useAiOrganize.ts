'use client';

import { useState, useCallback, useRef } from 'react';
import type { LocalAttachment, Message } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrganizePhase = 'idle' | 'organizing' | 'done' | 'error';

export interface OrganizeFileChange {
  action: 'create' | 'update' | 'unknown';
  path: string;
  toolCallId: string;
  /** Whether the tool call completed successfully */
  ok: boolean;
}

export interface AiOrganizeState {
  phase: OrganizePhase;
  changes: OrganizeFileChange[];
  /** Current tool being executed (for live progress display) */
  currentTool: { name: string; path: string } | null;
  /** AI's text summary of what it did */
  summary: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// SSE stream parser — extracts file operations from /api/ask stream
// ---------------------------------------------------------------------------

const FILE_WRITE_TOOLS = new Set([
  'create_file', 'write_file', 'batch_create_files',
  'append_to_file', 'insert_after_heading', 'update_section',
]);

function extractPathFromArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (typeof a.path === 'string') return a.path;
  if (toolName === 'batch_create_files' && Array.isArray(a.files)) {
    return (a.files as Array<{ path?: string }>)
      .map(f => f.path ?? '')
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

async function consumeOrganizeStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (state: Partial<AiOrganizeState>) => void,
  signal?: AbortSignal,
): Promise<{ changes: OrganizeFileChange[]; summary: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const changes: OrganizeFileChange[] = [];
  const pendingTools = new Map<string, { name: string; path: string; action: 'create' | 'update' | 'unknown' }>();
  let summary = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let event: Record<string, unknown>;
        try { event = JSON.parse(jsonStr); } catch { continue; }

        const type = event.type as string;

        switch (type) {
          case 'tool_start': {
            const toolName = event.toolName as string;
            const toolCallId = event.toolCallId as string;
            const args = event.args;
            if (FILE_WRITE_TOOLS.has(toolName)) {
              const path = extractPathFromArgs(toolName, args);
              const action = (toolName === 'create_file' || toolName === 'batch_create_files')
                ? 'create' as const : 'update' as const;
              pendingTools.set(toolCallId, { name: toolName, path, action });
              onProgress({ currentTool: { name: toolName, path } });
            }
            break;
          }

          case 'tool_end': {
            const toolCallId = event.toolCallId as string;
            const isError = !!event.isError;
            const pending = pendingTools.get(toolCallId);
            if (pending) {
              if (pending.name === 'batch_create_files') {
                for (const p of pending.path.split(', ').filter(Boolean)) {
                  changes.push({ action: pending.action, path: p, toolCallId, ok: !isError });
                }
              } else {
                changes.push({ action: pending.action, path: pending.path, toolCallId, ok: !isError });
              }
              pendingTools.delete(toolCallId);
              onProgress({ changes: [...changes], currentTool: null });
            }
            break;
          }

          case 'text_delta': {
            summary += (event.delta as string) ?? '';
            break;
          }

          case 'error': {
            throw new Error((event.message as string) || 'AI organize failed');
          }

          case 'done':
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { changes, summary };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAiOrganize() {
  const [phase, setPhase] = useState<OrganizePhase>('idle');
  const [changes, setChanges] = useState<OrganizeFileChange[]>([]);
  const [currentTool, setCurrentTool] = useState<{ name: string; path: string } | null>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (files: LocalAttachment[], prompt: string) => {
    setPhase('organizing');
    setChanges([]);
    setCurrentTool(null);
    setSummary('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const messages: Message[] = [{ role: 'user', content: prompt }];

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          uploadedFiles: files,
          maxSteps: 15,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMsg = `Request failed (${res.status})`;
        try {
          const errBody = await res.json() as { error?: { message?: string } | string; message?: string };
          if (typeof errBody?.error === 'string') errorMsg = errBody.error;
          else if (typeof errBody?.error === 'object' && errBody.error?.message) errorMsg = errBody.error.message;
          else if (errBody?.message) errorMsg = errBody.message as string;
        } catch {}
        throw new Error(errorMsg);
      }

      if (!res.body) throw new Error('No response body');

      const result = await consumeOrganizeStream(
        res.body,
        (partial) => {
          if (partial.changes) setChanges(partial.changes);
          if (partial.currentTool !== undefined) setCurrentTool(partial.currentTool);
        },
        controller.signal,
      );

      setChanges(result.changes);
      setSummary(result.summary);
      setCurrentTool(null);
      setPhase('done');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setPhase('idle');
      } else {
        setError((err as Error).message);
        setPhase('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const undoAll = useCallback(async (): Promise<number> => {
    const createdFiles = changes.filter(c => c.action === 'create' && c.ok);
    let reverted = 0;
    for (const file of createdFiles) {
      try {
        const res = await fetch('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'delete_file', path: file.path }),
        });
        if (res.ok) reverted++;
      } catch {}
    }
    return reverted;
  }, [changes]);

  const reset = useCallback(() => {
    setPhase('idle');
    setChanges([]);
    setCurrentTool(null);
    setSummary('');
    setError(null);
  }, []);

  return {
    phase,
    changes,
    currentTool,
    summary,
    error,
    start,
    abort,
    undoAll,
    reset,
  };
}

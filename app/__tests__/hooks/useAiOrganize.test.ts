import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the AI Organize SSE stream parser, helper functions,
 * and ImportModal title-selection logic.
 */

// Replicate pure functions from useAiOrganize for testability
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

interface OrganizeFileChange {
  action: 'create' | 'update' | 'unknown';
  path: string;
  toolCallId: string;
  ok: boolean;
}

/**
 * Parse a sequence of SSE events (as objects) into OrganizeFileChange[].
 * This simulates what consumeOrganizeStream does with the raw SSE data.
 */
function parseOrganizeEvents(
  events: Array<Record<string, unknown>>,
): { changes: OrganizeFileChange[]; summary: string } {
  const changes: OrganizeFileChange[] = [];
  const pendingTools = new Map<string, { name: string; path: string; action: 'create' | 'update' | 'unknown' }>();
  let summary = '';

  for (const event of events) {
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
        }
        break;
      }
      case 'text_delta': {
        summary += (event.delta as string) ?? '';
        break;
      }
    }
  }

  return { changes, summary };
}

// ---------------------------------------------------------------------------
// extractPathFromArgs
// ---------------------------------------------------------------------------

describe('extractPathFromArgs', () => {
  it('extracts path from create_file args', () => {
    expect(extractPathFromArgs('create_file', { path: 'notes/meeting.md', content: '...' }))
      .toBe('notes/meeting.md');
  });

  it('extracts path from write_file args', () => {
    expect(extractPathFromArgs('write_file', { path: 'daily/2024-01-01.md', content: '...' }))
      .toBe('daily/2024-01-01.md');
  });

  it('extracts multiple paths from batch_create_files args', () => {
    const args = {
      files: [
        { path: 'notes/a.md', content: '...' },
        { path: 'notes/b.md', content: '...' },
      ],
    };
    expect(extractPathFromArgs('batch_create_files', args))
      .toBe('notes/a.md, notes/b.md');
  });

  it('returns empty string for null args', () => {
    expect(extractPathFromArgs('create_file', null)).toBe('');
  });

  it('returns empty string for non-object args', () => {
    expect(extractPathFromArgs('create_file', 'string')).toBe('');
  });

  it('returns empty string when path is missing', () => {
    expect(extractPathFromArgs('create_file', { content: '...' })).toBe('');
  });

  it('returns empty string for batch_create_files with empty files array', () => {
    expect(extractPathFromArgs('batch_create_files', { files: [] })).toBe('');
  });

  it('handles batch_create_files files with missing path fields', () => {
    const args = {
      files: [
        { path: 'a.md', content: '...' },
        { content: '...' },
        { path: 'b.md', content: '...' },
      ],
    };
    expect(extractPathFromArgs('batch_create_files', args)).toBe('a.md, b.md');
  });
});

// ---------------------------------------------------------------------------
// parseOrganizeEvents (core stream parsing logic)
// ---------------------------------------------------------------------------

describe('parseOrganizeEvents', () => {
  it('tracks a single create_file operation', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'create_file', args: { path: 'notes/summary.md', content: '# Summary' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'created', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ action: 'create', path: 'notes/summary.md', toolCallId: 'tc1', ok: true });
  });

  it('tracks write_file as update action', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'write_file', args: { path: 'README.md', content: '...' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'written', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('update');
  });

  it('tracks batch_create_files with multiple paths', () => {
    const events = [
      {
        type: 'tool_start', toolCallId: 'tc1', toolName: 'batch_create_files',
        args: { files: [{ path: 'a.md', content: '...' }, { path: 'b.md', content: '...' }] },
      },
      { type: 'tool_end', toolCallId: 'tc1', output: 'created 2 files', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(2);
    expect(changes[0].path).toBe('a.md');
    expect(changes[1].path).toBe('b.md');
    expect(changes.every(c => c.action === 'create')).toBe(true);
  });

  it('marks failed tool calls with ok=false', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'create_file', args: { path: 'notes/fail.md', content: '...' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'error: permission denied', isError: true },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(1);
    expect(changes[0].ok).toBe(false);
  });

  it('ignores non-file-write tools (e.g. read_file, search)', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'read_file', args: { path: 'notes/existing.md' } },
      { type: 'tool_end', toolCallId: 'tc1', output: '# Content', isError: false },
      { type: 'tool_start', toolCallId: 'tc2', toolName: 'search', args: { query: 'test' } },
      { type: 'tool_end', toolCallId: 'tc2', output: '[]', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(0);
  });

  it('accumulates text_delta into summary', () => {
    const events = [
      { type: 'text_delta', delta: 'I organized ' },
      { type: 'text_delta', delta: 'your files.' },
    ];
    const { summary } = parseOrganizeEvents(events);
    expect(summary).toBe('I organized your files.');
  });

  it('handles mixed tool and text events', () => {
    const events = [
      { type: 'text_delta', delta: 'Let me organize ' },
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'create_file', args: { path: 'notes/a.md', content: '...' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'ok', isError: false },
      { type: 'text_delta', delta: 'your notes.' },
      { type: 'tool_start', toolCallId: 'tc2', toolName: 'update_section', args: { path: 'README.md' } },
      { type: 'tool_end', toolCallId: 'tc2', output: 'ok', isError: false },
      { type: 'done' },
    ];
    const { changes, summary } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ action: 'create', path: 'notes/a.md', ok: true });
    expect(changes[1]).toMatchObject({ action: 'update', path: 'README.md', ok: true });
    expect(summary).toBe('Let me organize your notes.');
  });

  it('handles empty event stream', () => {
    const { changes, summary } = parseOrganizeEvents([]);
    expect(changes).toHaveLength(0);
    expect(summary).toBe('');
  });

  it('handles tool_end without matching tool_start (no-op)', () => {
    const events = [
      { type: 'tool_end', toolCallId: 'orphan', output: 'ok', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes).toHaveLength(0);
  });

  it('handles append_to_file as update action', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'append_to_file', args: { path: 'log.md' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'ok', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes[0].action).toBe('update');
  });

  it('handles insert_after_heading as update action', () => {
    const events = [
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'insert_after_heading', args: { path: 'doc.md' } },
      { type: 'tool_end', toolCallId: 'tc1', output: 'ok', isError: false },
    ];
    const { changes } = parseOrganizeEvents(events);
    expect(changes[0].action).toBe('update');
  });
});

// ---------------------------------------------------------------------------
// ImportModal organize title selection logic
// ---------------------------------------------------------------------------

type OrganizePhase = 'idle' | 'organizing' | 'done' | 'error';
type ImportStep = 'select' | 'archive_config' | 'importing' | 'done' | 'organizing' | 'organize_review';

function resolveOrganizeTitle(
  step: ImportStep,
  organizePhase: OrganizePhase,
  titles: { organizing: string; reviewDone: string; reviewError: string; archiveConfig: string; default: string },
): string {
  const isOrganizing = step === 'organizing';
  const isOrganizeReview = step === 'organize_review';
  const isArchiveConfig = step === 'archive_config';

  if (isOrganizing) return titles.organizing;
  if (isOrganizeReview) {
    return organizePhase === 'error' ? titles.reviewError : titles.reviewDone;
  }
  if (isArchiveConfig) return titles.archiveConfig;
  return titles.default;
}

describe('ImportModal organize title selection', () => {
  const titles = {
    organizing: 'AI Organizing',
    reviewDone: 'Organization Complete',
    reviewError: 'Organization Failed',
    archiveConfig: 'Save to Knowledge Base',
    default: 'Import Files',
  };

  it('shows organizing title during AI processing', () => {
    expect(resolveOrganizeTitle('organizing', 'organizing', titles)).toBe('AI Organizing');
  });

  it('shows complete title when organize succeeds', () => {
    expect(resolveOrganizeTitle('organize_review', 'done', titles)).toBe('Organization Complete');
  });

  it('shows error title when organize fails — NOT "complete"', () => {
    expect(resolveOrganizeTitle('organize_review', 'error', titles)).toBe('Organization Failed');
  });

  it('shows archive config title for save step', () => {
    expect(resolveOrganizeTitle('archive_config', 'idle', titles)).toBe('Save to Knowledge Base');
  });

  it('shows default title for select step', () => {
    expect(resolveOrganizeTitle('select', 'idle', titles)).toBe('Import Files');
  });

  it('shows complete title for organize_review with idle phase (edge case)', () => {
    expect(resolveOrganizeTitle('organize_review', 'idle', titles)).toBe('Organization Complete');
  });

  it('shows complete title for organize_review with organizing phase (edge case)', () => {
    expect(resolveOrganizeTitle('organize_review', 'organizing', titles)).toBe('Organization Complete');
  });

  it('shows default title for importing step', () => {
    expect(resolveOrganizeTitle('importing', 'idle', titles)).toBe('Import Files');
  });

  it('shows default title for done step', () => {
    expect(resolveOrganizeTitle('done', 'idle', titles)).toBe('Import Files');
  });
});

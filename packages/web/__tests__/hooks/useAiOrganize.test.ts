import { describe, it, expect } from 'vitest';
import { stripThinkingTags, deriveStageHint, CLIENT_TRUNCATE_CHARS, type OrganizeStageHint } from '@/hooks/useAiOrganize';

/**
 * Unit tests for the AI Organize SSE stream parser, helper functions,
 * and ImportModal title-selection logic.
 */

// Replicate pure functions from useAiOrganize for testability
const FILE_WRITE_TOOLS = new Set([
  'create_file', 'write_file', 'batch_create_files',
  'append_to_file', 'insert_after_heading', 'update_section',
  'edit_lines', 'delete_file', 'rename_file', 'move_file', 'append_csv',
]);

function extractPathFromArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (typeof a.path === 'string') return a.path;
  if (typeof a.from_path === 'string') return a.from_path;
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

// ---------------------------------------------------------------------------
// stripThinkingTags
// ---------------------------------------------------------------------------

describe('stripThinkingTags', () => {
  it('strips a complete <thinking> block', () => {
    const input = '<thinking>Internal reasoning here</thinking>The actual summary.';
    expect(stripThinkingTags(input)).toBe('The actual summary.');
  });

  it('strips multiple <thinking> blocks', () => {
    const input = '<thinking>First thought</thinking>Hello <thinking>Second thought</thinking>World';
    expect(stripThinkingTags(input)).toBe('Hello World');
  });

  it('strips multiline <thinking> blocks', () => {
    const input = '<thinking>\nThe user wants me to read the PDF.\nLet me analyze.\n</thinking>\nI organized your files.';
    expect(stripThinkingTags(input)).toBe('I organized your files.');
  });

  it('strips unclosed trailing <thinking> tag', () => {
    const input = 'Summary text<thinking>Partial reasoning that got cut off';
    expect(stripThinkingTags(input)).toBe('Summary text');
  });

  it('returns empty string when entire content is thinking', () => {
    const input = '<thinking>All internal reasoning, no user-facing text</thinking>';
    expect(stripThinkingTags(input)).toBe('');
  });

  it('leaves normal text untouched', () => {
    const input = 'I created 3 files and organized your notes.';
    expect(stripThinkingTags(input)).toBe('I created 3 files and organized your notes.');
  });

  it('handles empty string', () => {
    expect(stripThinkingTags('')).toBe('');
  });

  it('is case-insensitive', () => {
    const input = '<Thinking>Internal</Thinking>Visible';
    expect(stripThinkingTags(input)).toBe('Visible');
  });

  it('handles the exact bug scenario from the screenshot', () => {
    const input = '<thinking>\nThe user wants me to read the uploaded PDF file and extract key information to store in the knowledge base. The PDF is already in the content as an uploaded file, but it\'s in binary format (PDF). Let me analyze what I can see from the truncated content.\n</thinking>\n\nThe file appears to be a CV (curr';
    const result = stripThinkingTags(input);
    expect(result).not.toContain('<thinking>');
    expect(result).not.toContain('The user wants me to read');
    expect(result).toBe('The file appears to be a CV (curr');
  });
});

// ---------------------------------------------------------------------------
// deriveStageHint — maps SSE event to user-facing stage
// ---------------------------------------------------------------------------

describe('deriveStageHint', () => {
  it('returns analyzing for text_delta events', () => {
    const hint = deriveStageHint('text_delta', undefined, undefined);
    expect(hint).toEqual({ stage: 'analyzing' });
  });

  it('returns reading with filename for read_file tool_start', () => {
    const hint = deriveStageHint('tool_start', 'read_file', { path: 'notes/meeting.md' });
    expect(hint).toEqual({ stage: 'reading', detail: 'notes/meeting.md' });
  });

  it('returns reading with filename for search tool_start', () => {
    const hint = deriveStageHint('tool_start', 'search', { query: 'test' });
    expect(hint).toEqual({ stage: 'reading', detail: undefined });
  });

  it('returns reading for list_files tool_start', () => {
    const hint = deriveStageHint('tool_start', 'list_files', { path: '/' });
    expect(hint).toEqual({ stage: 'reading', detail: '/' });
  });

  it('returns writing for create_file tool_start', () => {
    const hint = deriveStageHint('tool_start', 'create_file', { path: 'notes/new.md' });
    expect(hint).toEqual({ stage: 'writing', detail: 'notes/new.md' });
  });

  it('returns writing for write_file tool_start', () => {
    const hint = deriveStageHint('tool_start', 'write_file', { path: 'README.md' });
    expect(hint).toEqual({ stage: 'writing', detail: 'README.md' });
  });

  it('returns null for tool_end events', () => {
    const hint = deriveStageHint('tool_end', undefined, undefined);
    expect(hint).toBeNull();
  });

  it('returns null for done events', () => {
    const hint = deriveStageHint('done', undefined, undefined);
    expect(hint).toBeNull();
  });

  it('returns reading for read_lines tool_start', () => {
    const hint = deriveStageHint('tool_start', 'read_lines', { path: 'data.csv' });
    expect(hint).toEqual({ stage: 'reading', detail: 'data.csv' });
  });

  it('returns writing for batch_create_files', () => {
    const hint = deriveStageHint('tool_start', 'batch_create_files', {
      files: [{ path: 'a.md' }, { path: 'b.md' }],
    });
    expect(hint).toEqual({ stage: 'writing', detail: 'a.md, b.md' });
  });
});

// ---------------------------------------------------------------------------
// CLIENT_TRUNCATE_CHARS & truncation behavior
// ---------------------------------------------------------------------------

describe('CLIENT_TRUNCATE_CHARS', () => {
  it('is 20000', () => {
    expect(CLIENT_TRUNCATE_CHARS).toBe(20_000);
  });

  it('short content is not truncated', () => {
    const content = 'Hello world';
    const truncated = content.length > CLIENT_TRUNCATE_CHARS
      ? content.slice(0, CLIENT_TRUNCATE_CHARS) + '\n\n[...truncated to first ~20000 chars]'
      : content;
    expect(truncated).toBe('Hello world');
  });

  it('content exactly at limit is not truncated', () => {
    const content = 'a'.repeat(CLIENT_TRUNCATE_CHARS);
    const truncated = content.length > CLIENT_TRUNCATE_CHARS
      ? content.slice(0, CLIENT_TRUNCATE_CHARS) + '\n\n[...truncated to first ~20000 chars]'
      : content;
    expect(truncated).toBe(content);
    expect(truncated.length).toBe(CLIENT_TRUNCATE_CHARS);
  });

  it('content exceeding limit is truncated with marker', () => {
    const content = 'x'.repeat(CLIENT_TRUNCATE_CHARS + 5000);
    const truncated = content.length > CLIENT_TRUNCATE_CHARS
      ? content.slice(0, CLIENT_TRUNCATE_CHARS) + '\n\n[...truncated to first ~20000 chars]'
      : content;
    expect(truncated.length).toBeLessThan(content.length);
    expect(truncated).toContain('[...truncated');
    expect(truncated.startsWith('x'.repeat(100))).toBe(true);
  });

  it('5MB content is truncated to manageable size', () => {
    const content = 'y'.repeat(5 * 1024 * 1024);
    const truncated = content.length > CLIENT_TRUNCATE_CHARS
      ? content.slice(0, CLIENT_TRUNCATE_CHARS) + '\n\n[...truncated to first ~20000 chars]'
      : content;
    expect(truncated.length).toBeLessThan(25_000);
  });
});

describe('sanitizeToolArgs (server-side SSE safety)', () => {
  function sanitizeToolArgs(toolName: string, args: unknown): unknown {
    if (!args || typeof args !== 'object') return args;
    const a = args as Record<string, unknown>;
    if (toolName === 'batch_create_files' && Array.isArray(a.files)) {
      return {
        ...a,
        files: (a.files as Array<Record<string, unknown>>).map(f => ({
          path: f.path,
          ...(f.description ? { description: f.description } : {}),
        })),
      };
    }
    if (typeof a.content === 'string' && a.content.length > 200) {
      return { ...a, content: `[${a.content.length} chars]` };
    }
    if (typeof a.text === 'string' && a.text.length > 200) {
      return { ...a, text: `[${a.text.length} chars]` };
    }
    return args;
  }

  it('preserves small args unchanged', () => {
    const args = { path: 'notes/test.md', content: 'short' };
    expect(sanitizeToolArgs('create_file', args)).toBe(args);
  });

  it('truncates large content field', () => {
    const args = { path: 'notes/test.md', content: 'x'.repeat(5000) };
    const result = sanitizeToolArgs('create_file', args) as Record<string, unknown>;
    expect(result.path).toBe('notes/test.md');
    expect(result.content).toBe('[5000 chars]');
  });

  it('truncates large text field', () => {
    const args = { path: 'notes/test.md', text: 'y'.repeat(1000) };
    const result = sanitizeToolArgs('write_file', args) as Record<string, unknown>;
    expect(result.text).toBe('[1000 chars]');
  });

  it('strips content from batch_create_files', () => {
    const args = {
      files: [
        { path: 'a.md', content: 'x'.repeat(5000) },
        { path: 'b.md', content: 'y'.repeat(3000), description: 'desc' },
      ],
    };
    const result = sanitizeToolArgs('batch_create_files', args) as { files: Array<Record<string, unknown>> };
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({ path: 'a.md' });
    expect(result.files[1]).toEqual({ path: 'b.md', description: 'desc' });
  });

  it('handles null/undefined args', () => {
    expect(sanitizeToolArgs('create_file', null)).toBe(null);
    expect(sanitizeToolArgs('create_file', undefined)).toBe(undefined);
  });
});

describe('Extended FILE_WRITE_TOOLS coverage', () => {
  it('tracks delete_file as write tool', () => {
    expect(FILE_WRITE_TOOLS.has('delete_file')).toBe(true);
  });
  it('tracks rename_file as write tool', () => {
    expect(FILE_WRITE_TOOLS.has('rename_file')).toBe(true);
  });
  it('tracks move_file as write tool', () => {
    expect(FILE_WRITE_TOOLS.has('move_file')).toBe(true);
  });
  it('tracks append_csv as write tool', () => {
    expect(FILE_WRITE_TOOLS.has('append_csv')).toBe(true);
  });
  it('tracks edit_lines as write tool', () => {
    expect(FILE_WRITE_TOOLS.has('edit_lines')).toBe(true);
  });
});

describe('extractPathFromArgs extended', () => {
  it('extracts from_path for move/rename tools', () => {
    expect(extractPathFromArgs('move_file', { from_path: 'a.md', to_path: 'b.md' })).toBe('a.md');
    expect(extractPathFromArgs('rename_file', { from_path: 'old.md', new_name: 'new.md' })).toBe('old.md');
  });
  it('prefers path over from_path when both exist', () => {
    expect(extractPathFromArgs('write_file', { path: 'main.md', from_path: 'other.md' })).toBe('main.md');
  });
  it('returns empty for delete_file with no args', () => {
    expect(extractPathFromArgs('delete_file', undefined)).toBe('');
    expect(extractPathFromArgs('delete_file', null)).toBe('');
  });
});

describe('cleanSummaryForDisplay', () => {
  function cleanSummaryForDisplay(raw: string): string {
    return stripThinkingTags(raw)
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 500);
  }

  it('strips markdown headings', () => {
    expect(cleanSummaryForDisplay('## 写入结果\n内容')).toBe('写入结果\n内容');
    expect(cleanSummaryForDisplay('### 现有文件\n说明')).toBe('现有文件\n说明');
    expect(cleanSummaryForDisplay('# Title\n## Sub\nbody')).toBe('Title\nSub\nbody');
  });

  it('collapses excessive blank lines', () => {
    expect(cleanSummaryForDisplay('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('strips thinking tags', () => {
    expect(cleanSummaryForDisplay('<thinking>internal</thinking>result')).toBe('result');
  });

  it('trims whitespace', () => {
    expect(cleanSummaryForDisplay('  hello  ')).toBe('hello');
  });

  it('truncates to 500 chars', () => {
    const long = 'x'.repeat(600);
    expect(cleanSummaryForDisplay(long).length).toBe(500);
  });

  it('handles empty string', () => {
    expect(cleanSummaryForDisplay('')).toBe('');
  });

  it('handles real-world AI summary with mixed markdown', () => {
    const real = `已发现这份 CV 今天早些时候已有一次处理记录。

## ✅ 写入结果

### 现有文件（本次上传 = 同一份 CV，内容已完整录入）

| 文件 | 状态 | 说明 |
|------|------|------|
| 简历.md | ✅ 已有 | 个人信息 |`;
    const result = cleanSummaryForDisplay(real);
    expect(result).not.toContain('## ');
    expect(result).not.toContain('### ');
    expect(result).toContain('写入结果');
    expect(result).toContain('现有文件');
  });
});

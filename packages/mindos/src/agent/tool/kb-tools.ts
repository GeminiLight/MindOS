// Sunk from packages/web/lib/agent/tools.ts (Wave 3, spec-agent-core-consolidation).
// The MindOS knowledge-base tool set, host-injected: file IO, search, skills,
// lint/compile, and async diff are provided by the host (web app, headless CLI)
// through MindosKbToolsHost; write locks, run-ledger file events, permission
// filtering, and output shaping live here so every host gets identical tools.

import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  createMindosAgentPermissionPolicy,
  getMindosKbToolNameSet,
  MINDOS_CHAT_KB_TOOL_NAMES,
  MINDOS_ORGANIZE_KB_TOOL_NAMES,
  MINDOS_WRITE_TOOL_NAMES,
  type MindosAgentPermissionPolicy,
} from './permission-policy.js';
import { withAgentFileWriteLock, withAgentFileWriteLocks } from './file-write-lock.js';
import { getCurrentAgentRunContext } from '../agent-run-context.js';
import { appendAgentRunEvent } from '../run-ledger.js';
import { buildLineDiff, collapseDiffContext, type DiffLine } from './line-diff.js';
import { extractRelevantContent } from './paragraph-extract.js';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

export type MindosAgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (...args: any[]) => Promise<AgentToolResult<any>>;
};

/** Loose file-tree node shape — hosts cast their concrete tree type to this. */
export interface MindosKbFileTreeNode {
  name: string;
  type: string;
  children?: MindosKbFileTreeNode[];
}

export interface MindosKbSearchResult {
  path: string;
  score: number;
  snippet: string;
}

export interface MindosKbLintReport {
  healthScore: number;
  scope: string;
  stats: { totalFiles: number };
  orphans: Array<{ path: string }>;
  brokenLinks: Array<{ source: string; line: number; target: string }>;
  stale: Array<{ path: string; daysSinceUpdate: number }>;
  empty: string[];
}

export type MindosKbCompileResult =
  | { ok: true; stats: { spaceName: string; fileCount: number } }
  | { ok: false; message: string };

export interface MindosKbDreamingRunSummary {
  id: string;
  scope: string;
  lint: { healthScore: number; stats: { totalFiles: number } };
  proposals: Array<{ type: string; title: string }>;
  artifacts?: { reportMarkdown: string; pendingJson: string };
}

export interface MindosKbDreamingOptions {
  space?: string;
  writeArtifacts: boolean;
}

export interface MindosKbDreamingResult {
  run: MindosKbDreamingRunSummary;
  report: string;
}

/** Synchronous knowledge-base file operations the host must provide. */
export interface MindosKbFileHost {
  getMindRoot(): string;
  getFileTree(): MindosKbFileTreeNode[];
  getFileContent(filePath: string): string;
  getRecentlyModified(limit: number): Array<{ path: string; mtime: number | string | Date }>;
  saveFileContent(filePath: string, content: string): void;
  createFile(filePath: string, content: string): void;
  appendToFile(filePath: string, content: string): void;
  insertAfterHeading(filePath: string, heading: string, content: string): void;
  updateSection(filePath: string, heading: string, content: string): void;
  updateLines(mindRoot: string, filePath: string, startIndex: number, endIndex: number, lines: string[]): void | Promise<void>;
  moveToTrashFile(filePath: string): { id: string };
  renameFile(filePath: string, newName: string): string;
  moveFile(fromPath: string, toPath: string): { newPath: string; affectedFiles: string[] };
  findBacklinks(filePath: string): Array<{ source: string; line: number; context: string }>;
  gitLog(filePath: string, limit: number): Array<{ hash: string; date: string; message: string; author: string }>;
  gitShowFile(filePath: string, commit: string): string;
  appendCsvRow(filePath: string, row: string[]): { newRowCount: number };
}

export interface MindosKbToolsHost {
  files: MindosKbFileHost;
  hybridSearch(mindRoot: string, query: string): Promise<MindosKbSearchResult[]>;
  readSkillContent(name: string): string | null | Promise<string | null>;
  /** Optional: KB health check backend. The lint tool reports unavailability without it. */
  runLint?(mindRoot: string, space?: string): MindosKbLintReport | Promise<MindosKbLintReport>;
  /** Optional: conservative background maintenance pass. */
  runDreaming?(mindRoot: string, options: MindosKbDreamingOptions): MindosKbDreamingResult | Promise<MindosKbDreamingResult>;
  /** Optional: AI Space-overview backend. The compile tool reports unavailability without it. */
  compileSpaceOverview?(space: string): MindosKbCompileResult | Promise<MindosKbCompileResult>;
  /** Optional: off-thread diff for large files. Resolve null on timeout/unavailable. */
  computeDiffAsync?(before: string, after: string): Promise<DiffLine[] | null>;
  /** Optional: delegation tool sets appended per policy.toolScope. */
  delegationTools?: {
    a2a?: MindosAgentTool[];
    acp?: MindosAgentTool[];
  };
}

export function truncate(content: string, query?: string): string {
  const { result } = extractRelevantContent(content, MAX_FILE_CHARS, query);
  return result;
}

// ─── Helper: format tool error consistently ────────────────────────────────

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Helper: build a text-only AgentToolResult ──────────────────────────────

function textResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} as Record<string, never> };
}

/** Format DiffLine[] into a compact string */
function formatDiff(raw: DiffLine[]): string {
  const inserts = raw.filter(r => r.type === 'insert').length;
  const deletes = raw.filter(r => r.type === 'delete').length;
  const stats = `+${inserts} −${deletes}`;
  const collapsed = collapseDiffContext(raw, 2);
  const MAX_DIFF_LINES = 30;
  const lines: string[] = [];
  for (const row of collapsed) {
    if (lines.length >= MAX_DIFF_LINES) { lines.push('... (diff truncated)'); break; }
    if (row.type === 'gap') { lines.push(`  ... ${row.count} lines unchanged ...`); continue; }
    const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
    lines.push(`${prefix} ${row.text}`);
  }
  return `(${stats})\n\n--- changes ---\n${lines.join('\n')}`;
}

type FileChangedAction = 'created' | 'updated' | 'deleted' | 'renamed' | 'unknown';

function currentRunIdForToolEvent(): string | undefined {
  const context = getCurrentAgentRunContext();
  return context?.parentRunId ?? context?.rootRunId;
}

function appendFileChangedEvent(input: {
  path: string;
  action: FileChangedAction;
  summary: string;
  status?: 'completed' | 'failed';
}): void {
  const runId = currentRunIdForToolEvent();
  if (!runId) return;
  appendAgentRunEvent(runId, {
    type: 'file_changed',
    category: 'file',
    filePath: input.path,
    message: input.summary,
    data: {
      kind: 'file',
      path: input.path,
      action: input.action,
      status: input.status ?? 'completed',
      summary: input.summary,
    },
  });
}

/** Safe execute wrapper — catches all errors, returns error text (never throws) */
function safeExecute<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<any>> {
  return async (toolCallId, params, signal) => {
    try {
      return await fn(toolCallId, params, signal);
    } catch (e) {
      return textResult(`Error: ${formatToolError(e)}`);
    }
  };
}

// ─── TypeBox Schemas ────────────────────────────────────────────────────────

const ListFilesParams = Type.Object({
  path: Type.Optional(Type.String({ description: 'Optional subdirectory to list (e.g. "Projects/Products"). Omit to list everything.' })),
  depth: Type.Optional(Type.Number({ description: 'Max tree depth to expand (default 3). Directories deeper than this show item count only.', minimum: 1, maximum: 10 })),
});

const PathParam = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
});

const ReadFileChunkParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  start_line: Type.Number({ description: 'Line number to start reading from (1-indexed)' }),
  end_line: Type.Number({ description: 'Line number to stop reading at (1-indexed)' }),
});

const QueryParam = Type.Object({
  query: Type.String({ description: 'Search query (case-insensitive)' }),
});

const LimitParam = Type.Object({
  limit: Type.Optional(Type.Number({ description: 'Number of files to return (default 10)', minimum: 1, maximum: 50 })),
});

const WriteFileParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  content: Type.String({ description: 'New full content' }),
});

const CreateFileParams = Type.Object({
  path: Type.String({ description: 'Relative file path (must end in .md or .csv)' }),
  content: Type.Optional(Type.String({ description: 'Initial file content' })),
});

const BatchCreateFileParams = Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String({ description: 'Relative file path (must end in .md or .csv)' }),
    content: Type.String({ description: 'Initial file content' }),
  }), { description: 'List of files to create' }),
});

const AppendParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  content: Type.String({ description: 'Content to append' }),
});

const InsertHeadingParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  heading: Type.String({ description: 'Heading text to find (e.g. "## Tasks" or just "Tasks")' }),
  content: Type.String({ description: 'Content to insert after the heading' }),
});

const UpdateSectionParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  heading: Type.String({ description: 'Heading text to find (e.g. "## Status")' }),
  content: Type.String({ description: 'New content for the section' }),
});

const EditLinesParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  start_line: Type.Number({ description: '1-indexed line number to start replacing' }),
  end_line: Type.Number({ description: '1-indexed line number to stop replacing (inclusive)' }),
  content: Type.String({ description: 'New content to insert in place of those lines' }),
});

const RenameParams = Type.Object({
  path: Type.String({ description: 'Current relative file path' }),
  new_name: Type.String({ description: 'New filename (no path separators, e.g. "new-name.md")' }),
});

const MoveParams = Type.Object({
  from_path: Type.String({ description: 'Current relative file path' }),
  to_path: Type.String({ description: 'New relative file path' }),
});

const HistoryParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  limit: Type.Optional(Type.Number({ description: 'Number of commits to return (default 10)', minimum: 1, maximum: 50 })),
});

const FileAtVersionParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  commit: Type.String({ description: 'Git commit hash (full or abbreviated)' }),
});

const CsvAppendParams = Type.Object({
  path: Type.String({ description: 'Relative path to .csv file' }),
  row: Type.Array(Type.String(), { description: 'Array of cell values for the new row' }),
});

const DreamingParams = Type.Object({
  space: Type.Optional(Type.String({ description: 'Optional space name to scope the Dreaming run (e.g. "Projects"). Omit for full KB scan.' })),
  dryRun: Type.Optional(Type.Boolean({ description: 'When true, return proposals without writing .mindos/dreaming artifacts.' })),
});

const LoadSkillParams = Type.Object({
  name: Type.String({ description: 'Skill name, e.g. "mindos" or "context7"' }),
});

// ─── Tool name sets (shared across hosts) ────────────────────────────────────

// Write-operation tool names — used by beforeToolCall for write-protection
export const WRITE_TOOLS = new Set<string>(MINDOS_WRITE_TOOL_NAMES);

/** Tool names sufficient for the "organize uploaded files" task. */
export const ORGANIZE_TOOL_NAMES = new Set<string>(MINDOS_ORGANIZE_KB_TOOL_NAMES);

/**
 * Read-only tool set for Chat mode.
 *
 * Allows searching and reading the knowledge base + web access,
 * but blocks all write operations. Extensible: add tool names here
 * to grant more read-only capabilities to Chat mode.
 */
export const CHAT_TOOL_NAMES = new Set<string>(MINDOS_CHAT_KB_TOOL_NAMES);

// ─── Toolkit factory ─────────────────────────────────────────────────────────

export interface MindosKbToolkit {
  /** The full knowledge-base tool array (no policy filtering, no delegation tools). */
  knowledgeBaseTools: MindosAgentTool[];
  getToolsForPolicy(policy: MindosAgentPermissionPolicy): MindosAgentTool[];
  /** Lean tool set for organize mode — skips MCP discovery, history, backlinks, etc. */
  getOrganizeTools(): MindosAgentTool[];
  getChatTools(): MindosAgentTool[];
  getRequestScopedTools(): MindosAgentTool[];
}

export function createMindosKbToolkit(host: MindosKbToolsHost): MindosKbToolkit {
  const knowledgeBaseTools = buildMindosKnowledgeBaseTools(host);

  function getToolsForPolicy(policy: MindosAgentPermissionPolicy): MindosAgentTool[] {
    const kbToolNameSet = getMindosKbToolNameSet(policy);
    const baseTools = kbToolNameSet
      ? knowledgeBaseTools.filter(t => kbToolNameSet.has(t.name))
      : [...knowledgeBaseTools];

    if (policy.toolScope.a2aDelegation && host.delegationTools?.a2a) {
      baseTools.push(...host.delegationTools.a2a);
    }
    if (policy.toolScope.acpDelegation && host.delegationTools?.acp) {
      baseTools.push(...host.delegationTools.acp);
    }

    // IM tools are provided by the host's im extension via pi.registerTool().
    // MCP tools are provided by pi-mcp-adapter and included by the framework.

    return baseTools;
  }

  return {
    knowledgeBaseTools,
    getToolsForPolicy,
    getOrganizeTools: () => getToolsForPolicy(createMindosAgentPermissionPolicy('organize')),
    getChatTools: () => getToolsForPolicy(createMindosAgentPermissionPolicy('chat')),
    getRequestScopedTools: () => getToolsForPolicy(createMindosAgentPermissionPolicy('agent')),
  };
}

// ─── Tool Definitions (AgentTool interface) ─────────────────────────────────

export function buildMindosKnowledgeBaseTools(host: MindosKbToolsHost): MindosAgentTool[] {
  const { files } = host;

  /** Safe read — returns empty string if file doesn't exist */
  function safeReadContent(filePath: string): string {
    try { return files.getFileContent(filePath); } catch { return ''; }
  }

  function writeLock<T>(operation: string, filePath: string, fn: () => Promise<T> | T): Promise<T> {
    return withAgentFileWriteLock({ operation, filePath }, fn);
  }

  /** Build a compact diff summary for tool output. Max 30 diff lines to avoid bloating agent context. */
  async function buildDiffSummaryAsync(before: string, after: string): Promise<string> {
    if (before === after) return '';
    const beforeLines = before.split('\n').length;
    const afterLines = after.split('\n').length;
    // For very large files, skip sync LCS (O(n*m) would block) and offload to the host worker.
    if (beforeLines <= 2000 && afterLines <= 2000) {
      return formatDiff(buildLineDiff(before, after));
    }
    const raw = host.computeDiffAsync ? await host.computeDiffAsync(before, after) : null;
    if (!raw) {
      // Worker failed/timed out — fallback to line count summary
      const added = Math.max(0, afterLines - beforeLines);
      const removed = Math.max(0, beforeLines - afterLines);
      return `(~+${added} ~−${removed}, ${afterLines} lines total)\n\n--- changes ---\n  (diff timed out)`;
    }
    return formatDiff(raw);
  }

  return [
    {
      name: 'list_files',
      label: 'List Files',
      description: 'List files in the knowledge base as an indented tree. Directories beyond `depth` show "... (N items)". Pass `path` to list only a subdirectory, or `depth` to control how deep to expand (default 3).',
      parameters: ListFilesParams,
      execute: safeExecute(async (_id, params: Static<typeof ListFilesParams>) => {
        const { path: subdir, depth: maxDepth } = params;
        const tree = files.getFileTree();

        if (tree.length === 0 && !subdir) {
          const root = files.getMindRoot();
          return textResult(`(empty — no .md or .csv files found under mind_root: ${root})`);
        }

        const limit = maxDepth ?? 3;
        const lines: string[] = [];
        function walk(nodes: MindosKbFileTreeNode[], depth: number) {
          for (const n of nodes) {
            lines.push('  '.repeat(depth) + (n.type === 'directory' ? `${n.name}/` : n.name));
            if (n.type === 'directory' && Array.isArray(n.children)) {
              if (depth + 1 < limit) {
                walk(n.children, depth + 1);
              } else {
                lines.push('  '.repeat(depth + 1) + `... (${n.children.length} items)`);
              }
            }
          }
        }

        if (subdir) {
          const segments = subdir.replace(/[\\/]+$/, '').split(/[/\\]/).filter(Boolean);
          let current: MindosKbFileTreeNode[] = tree;
          for (const seg of segments) {
            const found = current.find(n => n.name === seg && n.type === 'directory');
            if (!found || !Array.isArray(found.children)) {
              return textResult(`Directory not found: ${subdir}`);
            }
            current = found.children;
          }
          walk(current, 0);
        } else {
          walk(tree, 0);
        }

        return textResult(lines.length > 0 ? lines.join('\n') : '(empty directory)');
      }),
    },

    {
      name: 'read_file',
      label: 'Read File',
      description: 'Read the content of a file by its relative path. Always read a file before modifying it. If the file is too large, it will be truncated. Use read_file_chunk to read specific parts of large files.',
      parameters: PathParam,
      execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
        return textResult(truncate(files.getFileContent(params.path)));
      }),
    },

    {
      name: 'read_file_chunk',
      label: 'Read File Chunk',
      description: 'Read a specific range of lines from a file. Highly recommended for reading large files that were truncated by read_file.',
      parameters: ReadFileChunkParams,
      execute: safeExecute(async (_id, params: Static<typeof ReadFileChunkParams>) => {
        const content = files.getFileContent(params.path);
        const lines = content.split('\n');
        const start = Math.max(1, params.start_line);
        const end = Math.min(lines.length, params.end_line);

        if (start > end) {
          return textResult(`Error: start_line (${start}) is greater than end_line (${end}) or file has fewer lines.`);
        }

        // Prefix each line with its line number (1-indexed)
        const pad = String(lines.length).length;
        const chunk = lines
          .slice(start - 1, end)
          .map((l, i) => `${String(start + i).padStart(pad, ' ')} | ${l}`)
          .join('\n');

        return textResult(`Showing lines ${start} to ${end} of ${lines.length}:\n\n${chunk}`);
      }),
    },

    {
      name: 'search',
      label: 'Search',
      description: 'Full-text search across all files in the knowledge base. Returns matching files with context snippets.',
      parameters: QueryParam,
      execute: safeExecute(async (_id, params: Static<typeof QueryParam>) => {
        const results = await host.hybridSearch(files.getMindRoot(), params.query);
        if (results.length === 0) return textResult('No results found.');
        return textResult(results.map(r => `- **${r.path}** (score: ${r.score.toFixed(1)}): ${r.snippet}`).join('\n'));
      }),
    },

    {
      name: 'load_skill',
      label: 'Load Skill',
      description: 'Load the full content of a specific skill by name. Available skills are listed in the system prompt under <available_skills>.',
      parameters: LoadSkillParams,
      execute: safeExecute(async (_id, params: Static<typeof LoadSkillParams>) => {
        const content = await host.readSkillContent(params.name);
        if (!content) return textResult(`Skill not found: ${params.name}`);
        return textResult(truncate(content));
      }),
    },

    // web_search and fetch_content are provided by the pi-web-access extension
    // (registered via additionalExtensionPaths in the host's route/headless wiring)

    {
      name: 'get_recent',
      label: 'Recent Files',
      description: 'Get the most recently modified files in the knowledge base.',
      parameters: LimitParam,
      execute: safeExecute(async (_id, params: Static<typeof LimitParam>) => {
        const recent = files.getRecentlyModified(params.limit ?? 10);
        return textResult(recent.map(f => `- ${f.path} (${new Date(f.mtime).toISOString()})`).join('\n'));
      }),
    },

    {
      name: 'write_file',
      label: 'Write File',
      description: 'Overwrite the entire content of an existing file. Use read_file first to see current content. Prefer update_section or insert_after_heading for partial edits.',
      parameters: WriteFileParams,
      execute: safeExecute(async (_id, params: Static<typeof WriteFileParams>) => {
        return writeLock('write_file', params.path, async () => {
          const before = safeReadContent(params.path);
          files.saveFileContent(params.path, params.content);
          const diff = await buildDiffSummaryAsync(before, params.content);
          appendFileChangedEvent({
            path: params.path,
            action: 'updated',
            summary: `Updated ${params.path}`,
          });
          return textResult(`File written: ${params.path}${diff ? ' ' + diff : ''}`);
        });
      }),
    },

    {
      name: 'create_file',
      label: 'Create File',
      description: 'Create a new file. Only .md and .csv files are allowed. Parent directories are created automatically. Does NOT create Space scaffolding (INSTRUCTION.md/README.md). Use create_space to create a Space.',
      parameters: CreateFileParams,
      execute: safeExecute(async (_id, params: Static<typeof CreateFileParams>) => {
        return writeLock('create_file', params.path, () => {
          const content = params.content ?? '';
          files.createFile(params.path, content);
          appendFileChangedEvent({
            path: params.path,
            action: 'created',
            summary: `Created ${params.path}`,
          });
          const lineCount = content.split('\n').length;
          return textResult(`File created: ${params.path} (+${lineCount})\n\n--- changes ---\n${content.split('\n').slice(0, 30).map(l => '+ ' + l).join('\n')}${lineCount > 30 ? '\n... (truncated)' : ''}`);
        });
      }),
    },

    {
      name: 'batch_create_files',
      label: 'Batch Create Files',
      description: 'Create multiple new files in a single operation. Highly recommended when scaffolding new features or projects.',
      parameters: BatchCreateFileParams,
      execute: safeExecute(async (_id, params: Static<typeof BatchCreateFileParams>) => {
        return withAgentFileWriteLocks(
          params.files.map((file) => ({ operation: 'batch_create_files', filePath: file.path })),
          () => {
            const created: string[] = [];
            const errors: string[] = [];
            for (const file of params.files) {
              try {
                files.createFile(file.path, file.content);
                created.push(file.path);
                appendFileChangedEvent({
                  path: file.path,
                  action: 'created',
                  summary: `Created ${file.path}`,
                });
              } catch (e) {
                errors.push(`${file.path}: ${formatToolError(e)}`);
              }
            }
            let msg = `Batch creation complete.\nCreated ${created.length} files: ${created.join(', ')}`;
            if (errors.length > 0) msg += `\n\nFailed to create ${errors.length} files:\n${errors.join('\n')}`;
            return textResult(msg);
          },
        );
      }),
    },

    {
      name: 'append_to_file',
      label: 'Append to File',
      description: 'Append text to the end of an existing file. A blank line separator is added automatically.',
      parameters: AppendParams,
      execute: safeExecute(async (_id, params: Static<typeof AppendParams>) => {
        return writeLock('append_to_file', params.path, async () => {
          const before = safeReadContent(params.path);
          files.appendToFile(params.path, params.content);
          const after = safeReadContent(params.path);
          const diff = await buildDiffSummaryAsync(before, after);
          appendFileChangedEvent({
            path: params.path,
            action: 'updated',
            summary: `Appended to ${params.path}`,
          });
          return textResult(`Content appended to: ${params.path}${diff ? ' ' + diff : ''}`);
        });
      }),
    },

    {
      name: 'insert_after_heading',
      label: 'Insert After Heading',
      description: 'Insert content right after a Markdown heading. Useful for adding items under a specific section. If heading matches fail, use edit_lines instead.',
      parameters: InsertHeadingParams,
      execute: safeExecute(async (_id, params: Static<typeof InsertHeadingParams>) => {
        return writeLock('insert_after_heading', params.path, async () => {
          const before = safeReadContent(params.path);
          files.insertAfterHeading(params.path, params.heading, params.content);
          const after = safeReadContent(params.path);
          const diff = await buildDiffSummaryAsync(before, after);
          appendFileChangedEvent({
            path: params.path,
            action: 'updated',
            summary: `Inserted content in ${params.path}`,
          });
          return textResult(`Content inserted after heading "${params.heading}" in ${params.path}${diff ? ' ' + diff : ''}`);
        });
      }),
    },

    {
      name: 'update_section',
      label: 'Update Section',
      description: 'Replace the content of a Markdown section identified by its heading. The section spans from the heading to the next heading of equal or higher level. If heading matches fail, use edit_lines instead.',
      parameters: UpdateSectionParams,
      execute: safeExecute(async (_id, params: Static<typeof UpdateSectionParams>) => {
        return writeLock('update_section', params.path, async () => {
          const before = safeReadContent(params.path);
          files.updateSection(params.path, params.heading, params.content);
          const after = safeReadContent(params.path);
          const diff = await buildDiffSummaryAsync(before, after);
          appendFileChangedEvent({
            path: params.path,
            action: 'updated',
            summary: `Updated section in ${params.path}`,
          });
          return textResult(`Section "${params.heading}" updated in ${params.path}${diff ? ' ' + diff : ''}`);
        });
      }),
    },

    {
      name: 'edit_lines',
      label: 'Edit Lines',
      description: 'Replace a specific range of lines with new content. Extremely reliable for precise edits. You must know the exact line numbers (use read_file_chunk to get them).',
      parameters: EditLinesParams,
      execute: safeExecute(async (_id, params: Static<typeof EditLinesParams>) => {
        const { path: fp, start_line, end_line, content } = params;
        const start = Math.max(0, start_line - 1);
        const end = Math.max(0, end_line - 1);
        return writeLock('edit_lines', fp, async () => {
          const before = safeReadContent(fp);
          const mindRoot = files.getMindRoot();
          await files.updateLines(mindRoot, fp, start, end, content.split('\n'));
          const after = safeReadContent(fp);
          const diff = await buildDiffSummaryAsync(before, after);
          appendFileChangedEvent({
            path: fp,
            action: 'updated',
            summary: `Edited lines ${start_line}-${end_line} in ${fp}`,
          });
          return textResult(`Lines ${start_line}-${end_line} replaced in ${fp}${diff ? ' ' + diff : ''}`);
        });
      }),
    },

    {
      name: 'delete_file',
      label: 'Delete File',
      description: 'Delete a file from the knowledge base. The file is moved to trash and can be recovered within 30 days.',
      parameters: PathParam,
      execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
        return writeLock('delete_file', params.path, () => {
          const meta = files.moveToTrashFile(params.path);
          appendFileChangedEvent({
            path: params.path,
            action: 'deleted',
            summary: `Moved ${params.path} to trash`,
          });
          return textResult(`Moved to trash: ${params.path} (recoverable for 30 days, trashId: ${meta.id})`);
        });
      }),
    },

    {
      name: 'rename_file',
      label: 'Rename File',
      description: 'Rename a file within its current directory. Only the filename changes, not the directory.',
      parameters: RenameParams,
      execute: safeExecute(async (_id, params: Static<typeof RenameParams>) => {
        return writeLock('rename_file', params.path, () => {
          const newPath = files.renameFile(params.path, params.new_name);
          appendFileChangedEvent({
            path: newPath,
            action: 'renamed',
            summary: `Renamed ${params.path} to ${newPath}`,
          });
          return textResult(`File renamed: ${params.path} → ${newPath}`);
        });
      }),
    },

    {
      name: 'move_file',
      label: 'Move File',
      description: 'Move a file to a new location. Also returns any files that had backlinks affected by the move.',
      parameters: MoveParams,
      execute: safeExecute(async (_id, params: Static<typeof MoveParams>) => {
        return withAgentFileWriteLocks([
          { operation: 'move_file', filePath: params.from_path },
          { operation: 'move_file', filePath: params.to_path },
        ], () => {
          const result = files.moveFile(params.from_path, params.to_path);
          const affected = result.affectedFiles.length > 0
            ? `\nAffected backlinks in: ${result.affectedFiles.join(', ')}`
            : '';
          appendFileChangedEvent({
            path: result.newPath,
            action: 'renamed',
            summary: `Moved ${params.from_path} to ${result.newPath}`,
          });
          return textResult(`File moved: ${params.from_path} → ${result.newPath}${affected}`);
        });
      }),
    },

    {
      name: 'get_backlinks',
      label: 'Backlinks',
      description: 'Find all files that reference a given file path. Useful for understanding connections between notes.',
      parameters: PathParam,
      execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
        const backlinks = files.findBacklinks(params.path);
        if (backlinks.length === 0) return textResult(`No backlinks found for: ${params.path}`);
        return textResult(backlinks.map(b => `- **${b.source}** (L${b.line}): ${b.context}`).join('\n'));
      }),
    },

    {
      name: 'get_history',
      label: 'History',
      description: 'Get git commit history for a file. Shows recent commits that modified this file.',
      parameters: HistoryParams,
      execute: safeExecute(async (_id, params: Static<typeof HistoryParams>) => {
        const commits = files.gitLog(params.path, params.limit ?? 10);
        if (commits.length === 0) return textResult(`No git history found for: ${params.path}`);
        return textResult(commits.map(c => `- \`${c.hash.slice(0, 7)}\` ${c.date} — ${c.message} (${c.author})`).join('\n'));
      }),
    },

    {
      name: 'get_file_at_version',
      label: 'File at Version',
      description: 'Read the content of a file at a specific git commit. Use get_history first to find commit hashes.',
      parameters: FileAtVersionParams,
      execute: safeExecute(async (_id, params: Static<typeof FileAtVersionParams>) => {
        return textResult(truncate(files.gitShowFile(params.path, params.commit)));
      }),
    },

    {
      name: 'append_csv',
      label: 'Append CSV Row',
      description: 'Append a row to a CSV file. Values are automatically escaped per RFC 4180.',
      parameters: CsvAppendParams,
      execute: safeExecute(async (_id, params: Static<typeof CsvAppendParams>) => {
        return writeLock('append_csv', params.path, () => {
          const result = files.appendCsvRow(params.path, params.row);
          appendFileChangedEvent({
            path: params.path,
            action: 'updated',
            summary: `Appended CSV row to ${params.path}`,
          });
          return textResult(`Row appended to ${params.path} (now ${result.newRowCount} rows)`);
        });
      }),
    },

    {
      name: 'lint',
      label: 'Knowledge Base Health Check',
      description: 'Run a health check on the knowledge base. Detects orphan files, stale files, broken links, and empty files. Returns a health score (0-100) and detailed issue lists.',
      parameters: Type.Object({
        space: Type.Optional(Type.String({ description: 'Optional space name to scope the analysis (e.g. "Projects"). Omit for full KB scan.' })),
      }),
      execute: safeExecute(async (_id, params: { space?: string }) => {
        if (!host.runLint) {
          return textResult('Error: the lint tool is not available in this host.');
        }
        const report = await host.runLint(files.getMindRoot(), params.space);
        const lines: string[] = [
          `## KB Health Check — Score: ${report.healthScore}/100`,
          `Scope: ${report.scope} | Files: ${report.stats.totalFiles}`,
          '',
        ];
        if (report.orphans.length > 0) {
          lines.push(`### Orphan Files (${report.orphans.length})`);
          for (const o of report.orphans.slice(0, 20)) lines.push(`- ${o.path}`);
          if (report.orphans.length > 20) lines.push(`... and ${report.orphans.length - 20} more`);
          lines.push('');
        }
        if (report.brokenLinks.length > 0) {
          lines.push(`### Broken Links (${report.brokenLinks.length})`);
          for (const b of report.brokenLinks.slice(0, 20)) lines.push(`- ${b.source}:${b.line} → [[${b.target}]]`);
          if (report.brokenLinks.length > 20) lines.push(`... and ${report.brokenLinks.length - 20} more`);
          lines.push('');
        }
        if (report.stale.length > 0) {
          lines.push(`### Stale Files (${report.stale.length})`);
          for (const s of report.stale.slice(0, 20)) lines.push(`- ${s.path} (${s.daysSinceUpdate}d ago)`);
          if (report.stale.length > 20) lines.push(`... and ${report.stale.length - 20} more`);
          lines.push('');
        }
        if (report.empty.length > 0) {
          lines.push(`### Empty Files (${report.empty.length})`);
          for (const e of report.empty.slice(0, 20)) lines.push(`- ${e}`);
          if (report.empty.length > 20) lines.push(`... and ${report.empty.length - 20} more`);
          lines.push('');
        }
        if (report.healthScore === 100) lines.push('All clear — your knowledge base is in great shape!');
        return textResult(lines.join('\n'));
      }),
    },

    {
      name: 'dreaming',
      label: 'Run Dreaming',
      description: 'Run a conservative background knowledge-maintenance pass. It captures local signals, groups them into maintenance themes, and writes review-first proposals under .mindos/dreaming without changing user notes.',
      parameters: DreamingParams,
      execute: safeExecute(async (_id, params: Static<typeof DreamingParams>) => {
        if (!host.runDreaming) {
          return textResult('Error: the dreaming tool is not available in this host.');
        }
        const result = await host.runDreaming(files.getMindRoot(), {
          space: params.space,
          writeArtifacts: params.dryRun !== true,
        });
        return textResult(result.report);
      }),
    },

    {
      name: 'compile',
      label: 'Compile Space Overview',
      description: 'Generate or regenerate a Space overview README using AI. Reads all files in the Space, analyzes their content, and produces a structured summary saved as README.md.',
      parameters: Type.Object({
        space: Type.String({ description: 'Space path to compile (e.g. "Research", "Projects/ML")' }),
      }),
      execute: safeExecute(async (_id, params: { space: string }) => {
        return writeLock('compile', path.posix.join(params.space, 'README.md'), async () => {
          if (!host.compileSpaceOverview) {
            return textResult('Error: the compile tool is not available in this host.');
          }
          const result = await host.compileSpaceOverview(params.space);
          if (!result.ok) {
            return textResult(`Error: ${result.message}`);
          }
          const readmePath = path.posix.join(params.space, 'README.md');
          appendFileChangedEvent({
            path: readmePath,
            action: 'updated',
            summary: `Generated overview ${readmePath}`,
          });
          return textResult(
            `Overview generated for "${result.stats.spaceName}" (${result.stats.fileCount} files analyzed).\n\nSaved to ${params.space}/README.md`
          );
        });
      }),
    },
  ];
}

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  searchFiles, getFileContent, getFileTree, getRecentlyModified,
  saveFileContent, createFile, appendToFile, insertAfterHeading, updateSection,
  deleteFile, renameFile, moveFile, findBacklinks, gitLog, gitShowFile, appendCsvRow,
  getMindRoot,
} from '@/lib/fs';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

export function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated — file is ${content.length} chars, showing first ${MAX_FILE_CHARS}]`;
}

// ─── Helper: format tool error consistently ────────────────────────────────

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Helper: build a text-only AgentToolResult ──────────────────────────────

function textResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} as Record<string, never> };
}

/** Safe execute wrapper — catches all errors, returns error text (never throws) */
function safeExecute<T>(
  fn: (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<any>>,
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

// ─── Tool Definitions (AgentTool interface) ─────────────────────────────────

// Write-operation tool names — used by beforeToolCall for write-protection
export const WRITE_TOOLS = new Set([
  'write_file', 'create_file', 'append_to_file', 'insert_after_heading',
  'update_section', 'delete_file', 'rename_file', 'move_file', 'append_csv',
]);

export const knowledgeBaseTools: AgentTool<any>[] = [
  {
    name: 'list_files',
    label: 'List Files',
    description: 'List files in the knowledge base as an indented tree. Directories beyond `depth` show "... (N items)". Pass `path` to list only a subdirectory, or `depth` to control how deep to expand (default 3).',
    parameters: ListFilesParams,
    execute: safeExecute(async (_id, params: Static<typeof ListFilesParams>) => {
      const { path: subdir, depth: maxDepth } = params;
      const tree = getFileTree();

      if (tree.length === 0 && !subdir) {
        const root = getMindRoot();
        return textResult(`(empty — no .md or .csv files found under mind_root: ${root})`);
      }

      const limit = maxDepth ?? 3;
      const lines: string[] = [];
      function walk(nodes: Array<{ name: string; type: string; children?: unknown[] }>, depth: number) {
        for (const n of nodes) {
          lines.push('  '.repeat(depth) + (n.type === 'directory' ? `${n.name}/` : n.name));
          if (n.type === 'directory' && Array.isArray(n.children)) {
            if (depth + 1 < limit) {
              walk(n.children as typeof nodes, depth + 1);
            } else {
              lines.push('  '.repeat(depth + 1) + `... (${n.children.length} items)`);
            }
          }
        }
      }

      if (subdir) {
        const segments = subdir.replace(/\/$/, '').split('/').filter(Boolean);
        let current: Array<{ name: string; type: string; path?: string; children?: unknown[] }> = tree as any;
        for (const seg of segments) {
          const found = current.find(n => n.name === seg && n.type === 'directory');
          if (!found || !Array.isArray(found.children)) {
            return textResult(`Directory not found: ${subdir}`);
          }
          current = found.children as typeof current;
        }
        walk(current as any, 0);
      } else {
        walk(tree as any, 0);
      }

      return textResult(lines.length > 0 ? lines.join('\n') : '(empty directory)');
    }),
  },

  {
    name: 'read_file',
    label: 'Read File',
    description: 'Read the content of a file by its relative path. Always read a file before modifying it.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      return textResult(truncate(getFileContent(params.path)));
    }),
  },

  {
    name: 'search',
    label: 'Search',
    description: 'Full-text search across all files in the knowledge base. Returns matching files with context snippets.',
    parameters: QueryParam,
    execute: safeExecute(async (_id, params: Static<typeof QueryParam>) => {
      const results = searchFiles(params.query);
      if (results.length === 0) return textResult('No results found.');
      return textResult(results.map(r => `- **${r.path}**: ${r.snippet}`).join('\n'));
    }),
  },

  {
    name: 'get_recent',
    label: 'Recent Files',
    description: 'Get the most recently modified files in the knowledge base.',
    parameters: LimitParam,
    execute: safeExecute(async (_id, params: Static<typeof LimitParam>) => {
      const files = getRecentlyModified(params.limit ?? 10);
      return textResult(files.map(f => `- ${f.path} (${new Date(f.mtime).toISOString()})`).join('\n'));
    }),
  },

  {
    name: 'write_file',
    label: 'Write File',
    description: 'Overwrite the entire content of an existing file. Use read_file first to see current content. Prefer update_section or insert_after_heading for partial edits.',
    parameters: WriteFileParams,
    execute: safeExecute(async (_id, params: Static<typeof WriteFileParams>) => {
      saveFileContent(params.path, params.content);
      return textResult(`File written: ${params.path}`);
    }),
  },

  {
    name: 'create_file',
    label: 'Create File',
    description: 'Create a new file. Only .md and .csv files are allowed. Parent directories are created automatically.',
    parameters: CreateFileParams,
    execute: safeExecute(async (_id, params: Static<typeof CreateFileParams>) => {
      createFile(params.path, params.content ?? '');
      return textResult(`File created: ${params.path}`);
    }),
  },

  {
    name: 'append_to_file',
    label: 'Append to File',
    description: 'Append text to the end of an existing file. A blank line separator is added automatically.',
    parameters: AppendParams,
    execute: safeExecute(async (_id, params: Static<typeof AppendParams>) => {
      appendToFile(params.path, params.content);
      return textResult(`Content appended to: ${params.path}`);
    }),
  },

  {
    name: 'insert_after_heading',
    label: 'Insert After Heading',
    description: 'Insert content right after a Markdown heading. Useful for adding items under a specific section.',
    parameters: InsertHeadingParams,
    execute: safeExecute(async (_id, params: Static<typeof InsertHeadingParams>) => {
      insertAfterHeading(params.path, params.heading, params.content);
      return textResult(`Content inserted after heading "${params.heading}" in ${params.path}`);
    }),
  },

  {
    name: 'update_section',
    label: 'Update Section',
    description: 'Replace the content of a Markdown section identified by its heading. The section spans from the heading to the next heading of equal or higher level.',
    parameters: UpdateSectionParams,
    execute: safeExecute(async (_id, params: Static<typeof UpdateSectionParams>) => {
      updateSection(params.path, params.heading, params.content);
      return textResult(`Section "${params.heading}" updated in ${params.path}`);
    }),
  },

  {
    name: 'delete_file',
    label: 'Delete File',
    description: 'Permanently delete a file from the knowledge base. This is destructive and cannot be undone.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      deleteFile(params.path);
      return textResult(`File deleted: ${params.path}`);
    }),
  },

  {
    name: 'rename_file',
    label: 'Rename File',
    description: 'Rename a file within its current directory. Only the filename changes, not the directory.',
    parameters: RenameParams,
    execute: safeExecute(async (_id, params: Static<typeof RenameParams>) => {
      const newPath = renameFile(params.path, params.new_name);
      return textResult(`File renamed: ${params.path} → ${newPath}`);
    }),
  },

  {
    name: 'move_file',
    label: 'Move File',
    description: 'Move a file to a new location. Also returns any files that had backlinks affected by the move.',
    parameters: MoveParams,
    execute: safeExecute(async (_id, params: Static<typeof MoveParams>) => {
      const result = moveFile(params.from_path, params.to_path);
      const affected = result.affectedFiles.length > 0
        ? `\nAffected backlinks in: ${result.affectedFiles.join(', ')}`
        : '';
      return textResult(`File moved: ${params.from_path} → ${result.newPath}${affected}`);
    }),
  },

  {
    name: 'get_backlinks',
    label: 'Backlinks',
    description: 'Find all files that reference a given file path. Useful for understanding connections between notes.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      const backlinks = findBacklinks(params.path);
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
      const commits = gitLog(params.path, params.limit ?? 10);
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
      return textResult(truncate(gitShowFile(params.path, params.commit)));
    }),
  },

  {
    name: 'append_csv',
    label: 'Append CSV Row',
    description: 'Append a row to a CSV file. Values are automatically escaped per RFC 4180.',
    parameters: CsvAppendParams,
    execute: safeExecute(async (_id, params: Static<typeof CsvAppendParams>) => {
      const result = appendCsvRow(params.path, params.row);
      return textResult(`Row appended to ${params.path} (now ${result.newRowCount} rows)`);
    }),
  },
];

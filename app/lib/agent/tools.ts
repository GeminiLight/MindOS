import { tool } from 'ai';
import { z } from 'zod';
import {
  searchFiles, getFileContent, getFileTree, getRecentlyModified,
  saveFileContent, createFile, appendToFile, insertAfterHeading, updateSection,
  deleteFile, renameFile, moveFile, findBacklinks, gitLog, gitShowFile, appendCsvRow,
} from '@/lib/fs';
import { assertNotProtected } from '@/lib/core';
import { logAgentOp } from './log';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

export function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated — file is ${content.length} chars, showing first ${MAX_FILE_CHARS}]`;
}

/** Checks write-protection using core's assertNotProtected */
export function assertWritable(filePath: string): void {
  assertNotProtected(filePath, 'modified by AI agent');
}

/** Helper: wrap a tool execute fn with agent-op logging */
function logged<P extends Record<string, unknown>>(
  toolName: string,
  fn: (params: P) => Promise<string>,
): (params: P) => Promise<string> {
  return async (params: P) => {
    const ts = new Date().toISOString();
    try {
      const result = await fn(params);
      const isError = result.startsWith('Error:');
      logAgentOp({ ts, tool: toolName, params, result: isError ? 'error' : 'ok', message: result.slice(0, 200) });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAgentOp({ ts, tool: toolName, params, result: 'error', message: msg.slice(0, 200) });
      throw e;
    }
  };
}

// ─── Knowledge base tools ─────────────────────────────────────────────────────

export const knowledgeBaseTools = {
  list_files: tool({
    description: 'List files in the knowledge base as an indented tree. Directories beyond `depth` show "... (N items)". Pass `path` to list only a subdirectory, or `depth` to control how deep to expand (default 3).',
    inputSchema: z.object({
      path: z.string().optional().describe('Optional subdirectory to list (e.g. "Projects/Products"). Omit to list everything.'),
      depth: z.number().min(1).max(10).optional().describe('Max tree depth to expand (default 3). Directories deeper than this show item count only.'),
    }),
    execute: logged('list_files', async ({ path: subdir, depth: maxDepth }) => {
      const tree = getFileTree();
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
            return `Directory not found: ${subdir}`;
          }
          current = found.children as typeof current;
        }
        walk(current as any, 0);
      } else {
        walk(tree as any, 0);
      }

      return lines.length > 0 ? lines.join('\n') : '(empty directory)';
    }),
  }),

  read_file: tool({
    description: 'Read the content of a file by its relative path. Always read a file before modifying it.',
    inputSchema: z.object({ path: z.string().describe('Relative file path, e.g. "Profile/👤 Identity.md"') }),
    execute: logged('read_file', async ({ path }) => {
      try {
        return truncate(getFileContent(path));
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  search: tool({
    description: 'Full-text search across all files in the knowledge base. Returns matching files with context snippets.',
    inputSchema: z.object({ query: z.string().describe('Search query (case-insensitive)') }),
    execute: logged('search', async ({ query }) => {
      const results = searchFiles(query);
      if (results.length === 0) return 'No results found.';
      return results.map(r => `- **${r.path}**: ${r.snippet}`).join('\n');
    }),
  }),

  get_recent: tool({
    description: 'Get the most recently modified files in the knowledge base.',
    inputSchema: z.object({ limit: z.number().min(1).max(50).default(10).describe('Number of files to return') }),
    execute: logged('get_recent', async ({ limit }) => {
      const files = getRecentlyModified(limit);
      return files.map(f => `- ${f.path} (${new Date(f.mtime).toISOString()})`).join('\n');
    }),
  }),

  write_file: tool({
    description: 'Overwrite the entire content of an existing file. Use read_file first to see current content. Prefer update_section or insert_after_heading for partial edits.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      content: z.string().describe('New full content'),
    }),
    execute: logged('write_file', async ({ path, content }) => {
      try {
        assertWritable(path);
        saveFileContent(path, content);
        return `File written: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  create_file: tool({
    description: 'Create a new file. Only .md and .csv files are allowed. Parent directories are created automatically.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path (must end in .md or .csv)'),
      content: z.string().default('').describe('Initial file content'),
    }),
    execute: logged('create_file', async ({ path, content }) => {
      try {
        assertWritable(path);
        createFile(path, content);
        return `File created: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  append_to_file: tool({
    description: 'Append text to the end of an existing file. A blank line separator is added automatically.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      content: z.string().describe('Content to append'),
    }),
    execute: logged('append_to_file', async ({ path, content }) => {
      try {
        assertWritable(path);
        appendToFile(path, content);
        return `Content appended to: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  insert_after_heading: tool({
    description: 'Insert content right after a Markdown heading. Useful for adding items under a specific section.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      heading: z.string().describe('Heading text to find (e.g. "## Tasks" or just "Tasks")'),
      content: z.string().describe('Content to insert after the heading'),
    }),
    execute: logged('insert_after_heading', async ({ path, heading, content }) => {
      try {
        assertWritable(path);
        insertAfterHeading(path, heading, content);
        return `Content inserted after heading "${heading}" in ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  update_section: tool({
    description: 'Replace the content of a Markdown section identified by its heading. The section spans from the heading to the next heading of equal or higher level.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      heading: z.string().describe('Heading text to find (e.g. "## Status")'),
      content: z.string().describe('New content for the section'),
    }),
    execute: logged('update_section', async ({ path, heading, content }) => {
      try {
        assertWritable(path);
        updateSection(path, heading, content);
        return `Section "${heading}" updated in ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  // ─── New tools (Phase 1a) ──────────────────────────────────────────────────

  delete_file: tool({
    description: 'Permanently delete a file from the knowledge base. This is destructive and cannot be undone.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path to delete'),
    }),
    execute: logged('delete_file', async ({ path }) => {
      try {
        assertWritable(path);
        deleteFile(path);
        return `File deleted: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  rename_file: tool({
    description: 'Rename a file within its current directory. Only the filename changes, not the directory.',
    inputSchema: z.object({
      path: z.string().describe('Current relative file path'),
      new_name: z.string().describe('New filename (no path separators, e.g. "new-name.md")'),
    }),
    execute: logged('rename_file', async ({ path, new_name }) => {
      try {
        assertWritable(path);
        const newPath = renameFile(path, new_name);
        return `File renamed: ${path} → ${newPath}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  move_file: tool({
    description: 'Move a file to a new location. Also returns any files that had backlinks affected by the move.',
    inputSchema: z.object({
      from_path: z.string().describe('Current relative file path'),
      to_path: z.string().describe('New relative file path'),
    }),
    execute: logged('move_file', async ({ from_path, to_path }) => {
      try {
        assertWritable(from_path);
        const result = moveFile(from_path, to_path);
        const affected = result.affectedFiles.length > 0
          ? `\nAffected backlinks in: ${result.affectedFiles.join(', ')}`
          : '';
        return `File moved: ${from_path} → ${result.newPath}${affected}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  get_backlinks: tool({
    description: 'Find all files that reference a given file path. Useful for understanding connections between notes.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path to find backlinks for'),
    }),
    execute: logged('get_backlinks', async ({ path }) => {
      try {
        const backlinks = findBacklinks(path);
        if (backlinks.length === 0) return `No backlinks found for: ${path}`;
        return backlinks.map(b => `- **${b.source}** (L${b.line}): ${b.context}`).join('\n');
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  get_history: tool({
    description: 'Get git commit history for a file. Shows recent commits that modified this file.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      limit: z.number().min(1).max(50).default(10).describe('Number of commits to return'),
    }),
    execute: logged('get_history', async ({ path, limit }) => {
      try {
        const commits = gitLog(path, limit);
        if (commits.length === 0) return `No git history found for: ${path}`;
        return commits.map(c => `- \`${c.hash.slice(0, 7)}\` ${c.date} — ${c.message} (${c.author})`).join('\n');
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  get_file_at_version: tool({
    description: 'Read the content of a file at a specific git commit. Use get_history first to find commit hashes.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      commit: z.string().describe('Git commit hash (full or abbreviated)'),
    }),
    execute: logged('get_file_at_version', async ({ path, commit }) => {
      try {
        const content = gitShowFile(path, commit);
        return truncate(content);
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),

  append_csv: tool({
    description: 'Append a row to a CSV file. Values are automatically escaped per RFC 4180.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to .csv file'),
      row: z.array(z.string()).describe('Array of cell values for the new row'),
    }),
    execute: logged('append_csv', async ({ path, row }) => {
      try {
        assertWritable(path);
        const result = appendCsvRow(path, row);
        return `Row appended to ${path} (now ${result.newRowCount} rows)`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  }),
};
